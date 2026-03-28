import json
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).with_name(".env"))

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
SUPABASE_STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "papers")

supabase = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def _ensure_supabase():
    if supabase is None:
        raise RuntimeError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY to enable persistence."
        )


def create_project(title: str) -> str:
    """Create a new project/session record."""
    _ensure_supabase()
    project_id = str(uuid4())
    payload = {
        "id": project_id,
        "title": title,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase.table("projects").insert(payload).execute()
    return project_id


def upload_file_to_storage(project_id: str, file_name: str, file_bytes: bytes) -> str:
    """Store uploaded PDF bytes in Supabase Storage."""
    _ensure_supabase()
    storage_path = f"projects/{project_id}/{uuid4().hex}_{file_name}"
    supabase.storage.from_(SUPABASE_STORAGE_BUCKET).upload(storage_path, file_bytes)
    return storage_path


def save_document(project_id: str, file_name: str, storage_path: str, raw_text: str) -> str:
    """Save metadata for an uploaded document."""
    _ensure_supabase()
    document_id = str(uuid4())
    payload = {
        "id": document_id,
        "project_id": project_id,
        "file_name": file_name,
        "storage_path": storage_path,
        "raw_text": raw_text,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase.table("documents").insert(payload).execute()
    return document_id


def save_graph(project_id: str, graph_json: str, status: str = "ready") -> str:
    """Save generated graph JSON for a project."""
    _ensure_supabase()
    graph_id = str(uuid4())
    payload = {
        "id": graph_id,
        "project_id": project_id,
        "graph_json": json.loads(graph_json),
        "status": status,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase.table("graphs").insert(payload).execute()
    return graph_id


def save_qa_log(
    graph_id: str,
    edge_source: str,
    edge_target: str,
    question: str,
    answer: str,
) -> str:
    """Save a live Q&A record for the current graph."""
    _ensure_supabase()
    qa_id = str(uuid4())
    payload = {
        "id": qa_id,
        "graph_id": graph_id,
        "edge_source": edge_source,
        "edge_target": edge_target,
        "question": question,
        "answer": answer,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase.table("qa_logs").insert(payload).execute()
    return qa_id
