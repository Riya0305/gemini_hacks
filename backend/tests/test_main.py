import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import main


class BackendMainTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main.current_graph = main.mock_graph
        main.current_project_id = None
        main.current_graph_id = None

    def tearDown(self):
        main.current_graph = main.mock_graph
        main.current_project_id = None
        main.current_graph_id = None

    def test_persist_graph_clears_stale_graph_id_and_survives_pdf_text_failures(self):
        main.current_graph_id = "stale-graph-id"
        graph_json = json.dumps(
            {
                "nodes": [{"id": "Paper A", "type": "concept"}],
                "edges": [],
            }
        )

        with patch.object(main, "create_project", return_value="project-1"), patch.object(
            main, "extract_text_from_pdf_bytes", side_effect=ValueError("bad pdf")
        ), patch.object(main, "upload_file_to_storage", return_value="papers/path.pdf"), patch.object(
            main, "save_document"
        ) as save_document_mock, patch.object(
            main, "save_graph", side_effect=RuntimeError("db down")
        ):
            response = self.client.post(
                "/persist-graph",
                data={"graph_json": graph_json},
                files=[("files", ("paper.pdf", b"%PDF-1.4", "application/pdf"))],
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["project_id"], "project-1")
        self.assertEqual(main.current_project_id, "project-1")
        self.assertIsNone(main.current_graph_id)
        save_document_mock.assert_called_once_with(
            "project-1",
            "paper.pdf",
            "papers/path.pdf",
            "",
        )

    def test_upload_clears_stale_state_before_processing(self):
        main.current_project_id = "stale-project-id"
        main.current_graph_id = "stale-graph-id"
        graph_payload = main.GraphData(
            nodes=[main.GraphNode(id="Paper A", type="concept")],
            edges=[],
        )

        with patch.object(main, "create_project", side_effect=RuntimeError("no supabase")), patch.object(
            main, "extract_text_from_pdf_bytes", return_value="paper text"
        ), patch.object(
            main, "call_gemini_extract_graph", return_value=graph_payload
        ):
            response = self.client.post(
                "/upload",
                files=[("files", ("paper.pdf", b"%PDF-1.4", "application/pdf"))],
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), graph_payload.model_dump())
        self.assertIsNone(main.current_project_id)
        self.assertIsNone(main.current_graph_id)

    def test_ask_endpoint_returns_answer_and_logs_against_current_graph(self):
        main.current_graph_id = "graph-123"
        fake_response = SimpleNamespace(text="Grounded answer")
        fake_client = SimpleNamespace(
            models=SimpleNamespace(generate_content=lambda **_: fake_response)
        )

        with patch.object(main, "gemini_client", fake_client), patch.object(
            main, "save_qa_log"
        ) as save_qa_log_mock:
            response = self.client.post(
                "/ask",
                json={
                    "source": "Paper A",
                    "target": "Method B",
                    "relation": "uses",
                    "explanation": "Paper A uses Method B.",
                    "evidence": "Evidence",
                    "question": "Why?",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"answer": "Grounded answer"})
        save_qa_log_mock.assert_called_once_with(
            graph_id="graph-123",
            edge_source="Paper A",
            edge_target="Method B",
            question="Why?",
            answer="Grounded answer",
        )


if __name__ == "__main__":
    unittest.main()
