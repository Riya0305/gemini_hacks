import json
import os
from datetime import datetime
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
    """Postgres: create a new project/session record."""
    _ensure_supabase()
    project_id = str(uuid4())
    payload = {
        "id": project_id,
        "title": title,
        "created_at": datetime.utcnow().isoformat(),
    }
    response = supabase.table("projects").insert(payload).execute()
    if response.error:
        raise RuntimeError(response.error)
    return project_id


def upload_file_to_storage(project_id: str, file_name: str, file_bytes: bytes) -> str:
    """Storage: store uploaded PDF bytes in Supabase Storage."""
    _ensure_supabase()
    storage_path = f"projects/{project_id}/{uuid4().hex}_{file_name}"
    response = supabase.storage.from_(SUPABASE_STORAGE_BUCKET).upload(storage_path, file_bytes)
    if response.error:
        raise RuntimeError(response.error)
    return storage_path


def save_document(project_id: str, file_name: str, storage_path: str, raw_text: str) -> str:
    """Postgres: save metadata for an uploaded document."""
    _ensure_supabase()
    document_id = str(uuid4())
    payload = {
        "id": document_id,
        "project_id": project_id,
        "file_name": file_name,
        "storage_path": storage_path,
        "raw_text": raw_text,
        "created_at": datetime.utcnow().isoformat(),
    }
    response = supabase.table("documents").insert(payload).execute()
    if response.error:
        raise RuntimeError(response.error)
    return document_id


def save_graph(project_id: str, graph_json: str, status: str = "ready") -> str:
    """Postgres: save generated graph JSON for a project."""
    _ensure_supabase()
    graph_id = str(uuid4())
    payload = {
        "id": graph_id,
        "project_id": project_id,
        "graph_json": json.loads(graph_json),
        "status": status,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    response = supabase.table("graphs").insert(payload).execute()
    if response.error:
        raise RuntimeError(response.error)
    return graph_id


def save_qa_log(
    graph_id: str,
    edge_source: str,
    edge_target: str,
    question: str,
    answer: str,
) -> str:
    """Postgres: save a live Q&A record for the current graph."""
    _ensure_supabase()
    qa_id = str(uuid4())
    payload = {
        "id": qa_id,
        "graph_id": graph_id,
        "edge_source": edge_source,
        "edge_target": edge_target,
        "question": question,
        "answer": answer,
        "created_at": datetime.utcnow().isoformat(),
    }
    response = supabase.table("qa_logs").insert(payload).execute()
    if response.error:
        raise RuntimeError(response.error)
    return qa_id
