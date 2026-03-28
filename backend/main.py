from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import fitz
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel

# Load backend/.env even when uvicorn is started from repo root.
load_dotenv(Path(__file__).with_name(".env"))

from .persistence import (
    create_project,
    upload_file_to_storage,
    save_document,
    save_graph,
    save_qa_log,
)

app = FastAPI(title="PaperGraph AI Backend")
gemini_api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
gemini_model = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")
gemini_client = genai.Client(api_key=gemini_api_key) if gemini_api_key else None

# CORS: default to localhost-only. Expand explicitly if you intentionally expose the app.
allowed_origins = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models — matches the frontend's GraphData shape exactly
# ---------------------------------------------------------------------------

class GraphNode(BaseModel):
    id: str
    type: str
    summary: Optional[str] = None
    evidence: Optional[str] = None
    paperLabel: Optional[str] = None
    displayLabel: Optional[str] = None
    paperTitle: Optional[str] = None
    themeLabel: Optional[str] = None
    themeDescription: Optional[str] = None
    colorHex: Optional[str] = None


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str
    explanation: str
    evidence: str


class GraphData(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]


class AskEdgeContext(BaseModel):
    source: str
    target: str
    relation: str
    explanation: str
    evidence: str


class AskRequest(BaseModel):
    """Accepts both flat format and nested {question, context} from the frontend."""
    source: Optional[str] = None
    target: Optional[str] = None
    relation: Optional[str] = None
    explanation: Optional[str] = None
    evidence: Optional[str] = None
    question: str
    context: Optional[AskEdgeContext] = None

    def resolved_source(self) -> str:
        return self.context.source if self.context else (self.source or "")

    def resolved_target(self) -> str:
        return self.context.target if self.context else (self.target or "")

    def resolved_relation(self) -> str:
        return self.context.relation if self.context else (self.relation or "")

    def resolved_explanation(self) -> str:
        return self.context.explanation if self.context else (self.explanation or "")

    def resolved_evidence(self) -> str:
        return self.context.evidence if self.context else (self.evidence or "")


class AskResponse(BaseModel):
    answer: str


class PersistQaRequest(BaseModel):
    edge_source: str
    edge_target: str
    relation: str
    question: str
    answer: str


# ---------------------------------------------------------------------------
# PDF helpers
# ---------------------------------------------------------------------------

def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = [page.get_text() for page in document]
    document.close()
    return "\n\n".join(pages)


# ---------------------------------------------------------------------------
# Gemini helpers
# ---------------------------------------------------------------------------

def _ensure_gemini_client():
    if gemini_client is None:
        raise RuntimeError("Gemini is not configured. Set GEMINI_API_KEY (or GOOGLE_API_KEY).")


PAPER_THEME_PALETTE = [
    "#22d3ee", "#34d399", "#f59e0b", "#f97316", "#a78bfa",
    "#60a5fa", "#f472b6", "#84cc16", "#2dd4bf", "#fb7185",
]

NODE_TYPE_COLORS = {
    "technology": "#22d3ee",
    "method": "#a78bfa",
    "author": "#fbbf24",
    "application": "#34d399",
    "concept": "#94a3b8",
}


def apply_theme_colors(graph: GraphData) -> GraphData:
    """Assign colorHex to every node so the frontend can render colors."""
    theme_color_map: Dict[str, str] = {}
    color_index = 0

    # paper nodes get colors by themeLabel
    for node in graph.nodes:
        if not node.paperLabel:
            continue
        theme = (node.themeLabel or "").strip().lower()
        if theme and theme not in theme_color_map:
            theme_color_map[theme] = PAPER_THEME_PALETTE[color_index % len(PAPER_THEME_PALETTE)]
            color_index += 1

    # papers without themeLabel get a color keyed by paperLabel
    for node in graph.nodes:
        if not node.paperLabel:
            continue
        theme = (node.themeLabel or "").strip().lower()
        if theme and theme in theme_color_map:
            continue
        fallback_key = f"__paper__{(node.paperLabel or '').strip().lower()}"
        if fallback_key not in theme_color_map:
            theme_color_map[fallback_key] = PAPER_THEME_PALETTE[color_index % len(PAPER_THEME_PALETTE)]
            color_index += 1

    # resolve paper node colors
    paper_node_colors: Dict[str, str] = {}
    for node in graph.nodes:
        if not node.paperLabel:
            continue
        theme = (node.themeLabel or "").strip().lower()
        if theme and theme in theme_color_map:
            paper_node_colors[node.id] = theme_color_map[theme]
        else:
            fallback_key = f"__paper__{(node.paperLabel or '').strip().lower()}"
            paper_node_colors[node.id] = theme_color_map.get(fallback_key, PAPER_THEME_PALETTE[0])

    # topic nodes inherit color from their parent paper via edges
    topic_color_map: Dict[str, str] = {}
    for edge in graph.edges:
        src_color = paper_node_colors.get(edge.source)
        tgt_color = paper_node_colors.get(edge.target)
        if src_color and edge.target not in paper_node_colors and edge.target not in topic_color_map:
            topic_color_map[edge.target] = src_color
        if tgt_color and edge.source not in paper_node_colors and edge.source not in topic_color_map:
            topic_color_map[edge.source] = tgt_color

    # apply colors
    for node in graph.nodes:
        if node.paperLabel and node.id in paper_node_colors:
            node.colorHex = paper_node_colors[node.id]
        elif node.id in topic_color_map:
            node.colorHex = topic_color_map[node.id]
        else:
            node.colorHex = NODE_TYPE_COLORS.get(node.type, "#94a3b8")

    return graph


def build_graph_extraction_prompt(paper_text: str) -> str:
    return (
        "You extract a clean knowledge graph from research paper text.\n"
        "Return ONLY a single valid JSON object matching this exact shape:\n"
        "{\n"
        '  "nodes": [\n'
        '    {\n'
        '      "id": "Entity Name or Paper Title",\n'
        '      "type": "technology|method|author|application|concept",\n'
        '      "displayLabel": "short readable label (2-4 words)",\n'
        '      "paperTitle": "full paper title (only for paper nodes)",\n'
        '      "themeLabel": "shared topic group (only for paper nodes)",\n'
        '      "themeDescription": "what that theme means (only for paper nodes)",\n'
        '      "summary": "short grounded summary of this entity",\n'
        '      "evidence": "quote or grounded excerpt from the paper",\n'
        '      "paperLabel": "Paper 1 (only for paper nodes, sequential)"\n'
        "    }\n"
        "  ],\n"
        '  "edges": [\n'
        '    {\n'
        '      "source": "Entity Name",\n'
        '      "target": "Other Entity Name",\n'
        '      "relation": "short verb phrase",\n'
        '      "explanation": "concise grounded explanation",\n'
        '      "evidence": "direct quote or grounded excerpt"\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "## Node types\n"
        "- **Paper nodes**: one per paper. Set id to the real paper title. "
        'Include displayLabel, paperTitle, themeLabel, themeDescription, summary, evidence, and paperLabel ("Paper 1", etc.).\n'
        "- **Topic nodes**: key concepts, methods, technologies, applications, or authors from each paper (4-8 per paper). "
        "Topic nodes do NOT have paperLabel set.\n\n"
        "## Rules for edges\n"
        "- Connect each paper to ALL its topic nodes.\n"
        "- Connect topic nodes to each other when related.\n"
        "- Aim for at least 2-3x more edges than nodes.\n"
        "- relation: short verb phrase (uses, proposes, studies, extends, enables, etc.)\n"
        "- explanation: concise and grounded.\n"
        "- evidence: direct quote when available.\n"
        "- Edges must only connect existing node ids.\n\n"
        "Allowed node types: technology, method, author, application, concept.\n"
        "No markdown, no code fences, no commentary. JSON only.\n\n"
        "Paper text:\n" + paper_text
    )


def extract_json_string(text: str) -> str:
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        return text[first : last + 1]
    return text


def parse_graph_data_from_text(json_text: str) -> GraphData:
    json_text = extract_json_string(json_text)
    data = json.loads(json_text)
    return GraphData.model_validate(data)


def call_gemini_extract_graph(paper_text: str) -> GraphData:
    _ensure_gemini_client()
    prompt = build_graph_extraction_prompt(paper_text)
    response = gemini_client.models.generate_content(
        model=gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.2,
            top_p=1,
            max_output_tokens=8192,
        ),
    )
    response_text = response.text or ""
    graph = parse_graph_data_from_text(response_text)
    return apply_theme_colors(graph)


def build_live_ask_prompt(request: AskRequest) -> str:
    return (
        "You are a helpful research assistant for academic research knowledge graphs. "
        "Use only the provided connection data and evidence to answer the user question clearly. "
        "Do not invent new relationships. Keep the answer concise and grounded.\n\n"
        "Connection:\n"
        f"Source: {request.resolved_source()}\n"
        f"Target: {request.resolved_target()}\n"
        f"Relation: {request.resolved_relation()}\n"
        f"Explanation: {request.resolved_explanation()}\n"
        f"Evidence: {request.resolved_evidence()}\n\n"
        f"User question: {request.question}\n"
        "Answer:"
    )


# ---------------------------------------------------------------------------
# In-memory state (for standalone mode when not fronted by Next.js)
# ---------------------------------------------------------------------------

mock_graph = GraphData(
    nodes=[
        GraphNode(
            id="Edge AI",
            type="technology",
            displayLabel="Edge AI",
            summary="Local inference at the edge for real-time processing.",
            colorHex="#22d3ee",
        ),
        GraphNode(
            id="Glucose Monitoring",
            type="application",
            displayLabel="Glucose Monitoring",
            summary="Continuous glucose monitoring using wearable sensors.",
            colorHex="#34d399",
        ),
    ],
    edges=[
        GraphEdge(
            source="Edge AI",
            target="Glucose Monitoring",
            relation="enables",
            explanation="Edge AI enables real-time glucose monitoring by processing sensor data locally.",
            evidence="A research paper shows Edge AI can analyze glucose sensor outputs with low latency.",
        )
    ],
)

current_graph: GraphData = mock_graph
current_project_id: Optional[str] = None
current_graph_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Persistence endpoints — called by the Next.js API routes (fire-and-forget)
# ---------------------------------------------------------------------------

@app.post("/persist-graph")
async def persist_graph(
    files: List[UploadFile] = File(...),
    graph_json: str = Form(...),
):
    """
    Receives the PDFs + the already-extracted GraphData JSON from the
    Next.js pipeline. Persists everything to Supabase without re-running
    Gemini extraction.
    """
    global current_graph, current_project_id, current_graph_id

    # parse the graph that the frontend already extracted
    graph_data = GraphData.model_validate(json.loads(graph_json))
    current_graph = graph_data
    current_project_id = None
    current_graph_id = None

    project_title = f"PaperGraph upload {datetime.now(timezone.utc).isoformat()}"
    project_id: Optional[str] = None
    try:
        project_id = create_project(title=project_title)
        current_project_id = project_id
    except Exception as exc:
        print(f"Supabase project creation failed: {exc}")

    for file in files:
        contents = await file.read()
        try:
            raw_text = extract_text_from_pdf_bytes(contents)
        except Exception as exc:
            raw_text = ""
            print(f"PDF text extraction failed during persistence for {file.filename}: {exc}")

        if project_id:
            try:
                storage_path = upload_file_to_storage(project_id, file.filename, contents)
                save_document(project_id, file.filename, storage_path, raw_text)
            except Exception as exc:
                print(f"Supabase document persistence failed: {exc}")

    if project_id:
        try:
            current_graph_id = save_graph(
                project_id, graph_data.model_dump_json(), status="ready"
            )
        except Exception as exc:
            print(f"Supabase graph persistence failed: {exc}")

    return {"status": "persisted", "project_id": project_id}


@app.post("/persist-qa")
def persist_qa(request: PersistQaRequest):
    """
    Receives a Q&A event from the Next.js pipeline and logs it to Supabase.
    """
    if current_graph_id:
        try:
            save_qa_log(
                graph_id=current_graph_id,
                edge_source=request.edge_source,
                edge_target=request.edge_target,
                question=request.question,
                answer=request.answer,
            )
        except Exception as exc:
            print(f"Supabase QA persistence failed: {exc}")

    return {"status": "logged"}


# ---------------------------------------------------------------------------
# Standalone endpoints — for when the backend runs without Next.js
# ---------------------------------------------------------------------------

@app.post("/upload", response_model=GraphData)
async def upload_papers(files: List[UploadFile] = File(...)):
    global current_graph, current_project_id, current_graph_id

    current_project_id = None
    current_graph_id = None
    project_title = f"PaperGraph upload {datetime.now(timezone.utc).isoformat()}"
    project_id: Optional[str] = None
    try:
        project_id = create_project(title=project_title)
        current_project_id = project_id
    except Exception as exc:
        print(f"Supabase project creation failed: {exc}")

    raw_texts: List[str] = []
    for file in files:
        contents = await file.read()
        raw_text = extract_text_from_pdf_bytes(contents)
        raw_texts.append(raw_text)

        if project_id:
            try:
                storage_path = upload_file_to_storage(project_id, file.filename, contents)
                save_document(project_id, file.filename, storage_path, raw_text)
            except Exception as exc:
                print(f"Supabase document persistence failed: {exc}")

    raw_text = "\n\n".join(raw_texts)
    print(f"Extracted text from {len(files)} PDF(s), total length={len(raw_text)} characters")

    try:
        graph_data = call_gemini_extract_graph(raw_text)
        current_graph = graph_data
        if project_id:
            try:
                current_graph_id = save_graph(project_id, graph_data.model_dump_json(), status="ready")
            except Exception as exc:
                print(f"Supabase graph persistence failed: {exc}")
        return graph_data
    except Exception as exc:
        print(f"Gemini extraction failed: {exc}")
        current_graph = mock_graph
        if project_id:
            try:
                current_graph_id = save_graph(project_id, mock_graph.model_dump_json(), status="failed")
            except Exception as exc:
                print(f"Supabase fallback graph persistence failed: {exc}")
        return mock_graph


@app.get("/graph", response_model=GraphData)
def get_graph():
    return current_graph


@app.post("/ask", response_model=AskResponse)
def ask_question(request: AskRequest):
    _ensure_gemini_client()
    prompt = build_live_ask_prompt(request)
    response = gemini_client.models.generate_content(
        model=gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.0,
            top_p=1,
            max_output_tokens=512,
        ),
    )
    answer_text = (response.text or "").strip()

    if current_graph_id:
        try:
            save_qa_log(
                graph_id=current_graph_id,
                edge_source=request.resolved_source(),
                edge_target=request.resolved_target(),
                question=request.question,
                answer=answer_text,
            )
        except Exception as exc:
            print(f"Supabase QA persistence failed: {exc}")

    return AskResponse(answer=answer_text)
