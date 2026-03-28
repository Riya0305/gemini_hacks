from datetime import datetime
import json
import os
from pathlib import Path
from typing import List, Optional

import fitz
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile
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
gemini_model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
gemini_client = genai.Client(api_key=gemini_api_key) if gemini_api_key else None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class GraphNode(BaseModel):
    id: str
    type: str

class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str
    explanation: str
    evidence: str

class GraphData(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]

class AskRequest(BaseModel):
    source: str
    target: str
    relation: str
    explanation: str
    evidence: str
    question: str

class AskResponse(BaseModel):
    answer: str

def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = [page.get_text() for page in document]
    document.close()
    return "\n\n".join(pages)

async def extract_text_from_files(files: List[UploadFile]) -> str:
    texts: List[str] = []
    for file in files:
        contents = await file.read()
        texts.append(extract_text_from_pdf_bytes(contents))
    return "\n\n".join(texts)


def build_graph_extraction_prompt(paper_text: str) -> str:
    return (
        "You are an assistant that extracts a concise knowledge graph from research paper text. "
        "Return only valid JSON using this schema:\n"
        "{\n  \"nodes\": [ { \"id\": \"...\", \"type\": \"technology|method|application|author\" } ],\n"
        "  \"edges\": [ { \"source\": \"...\", \"target\": \"...\", \"relation\": \"...\", "
        "\"explanation\": \"...\", \"evidence\": \"...\" } ]\n}\n"
        "Use types only from: technology, method, application, author."
        "Include at least one edge per relationship. If no relationships exist, return empty arrays."
        "For each evidence field, include a short quote or citation from the paper text.\n"
        "Paper text:\n" + paper_text
    )


def extract_json_string(text: str) -> str:
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        return text[first:last+1]
    return text


def _ensure_gemini_client():
    if gemini_client is None:
        raise RuntimeError("Gemini is not configured. Set GEMINI_API_KEY (or GOOGLE_API_KEY).")


def parse_graph_data_from_text(json_text: str) -> GraphData:
    json_text = extract_json_string(json_text)
    data = json.loads(json_text)
    return GraphData.parse_obj(data)


def call_gemini_extract_graph(paper_text: str) -> GraphData:
    _ensure_gemini_client()
    prompt = build_graph_extraction_prompt(paper_text)
    response = gemini_client.models.generate_content(
        model=gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.0,
            top_p=1,
            max_output_tokens=800,
        ),
    )
    response_text = response.text or ""
    return parse_graph_data_from_text(response_text)

mock_graph = GraphData(
    nodes=[
        GraphNode(id="Edge AI", type="technology"),
        GraphNode(id="Glucose Monitoring", type="application"),
    ],
    edges=[
        GraphEdge(
            source="Edge AI",
            target="Glucose Monitoring",
            relation="enables",
            explanation="Edge AI enables real-time glucose monitoring by processing sensor data locally.",
            evidence="A research paper shows Edge AI can analyze glucose sensor outputs with low latency."
        )
    ],
)

current_graph: GraphData = mock_graph
current_project_id: Optional[str] = None
current_graph_id: Optional[str] = None

@app.post("/upload", response_model=GraphData)
async def upload_papers(files: List[UploadFile] = File(...)):
    global current_graph, current_project_id, current_graph_id

    project_title = f"PaperGraph upload {datetime.utcnow().isoformat()}"
    project_id: Optional[str] = None
    try:
        # Postgres: create a new project/session record for this upload flow
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
                # Storage: upload the raw PDF file bytes to Supabase Storage
                storage_path = upload_file_to_storage(project_id, file.filename, contents)
                # Postgres: persist the uploaded document metadata and extracted raw text
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
                # Postgres: persist the generated graph JSON for later lookup
                current_graph_id = save_graph(project_id, graph_data.json(), status="ready")
            except Exception as exc:
                print(f"Supabase graph persistence failed: {exc}")
        return graph_data
    except Exception as exc:
        print(f"Gemini extraction failed: {exc}")
        current_graph = mock_graph
        if project_id:
            try:
                current_graph_id = save_graph(project_id, mock_graph.json(), status="failed")
            except Exception as exc:
                print(f"Supabase fallback graph persistence failed: {exc}")
        return mock_graph

@app.get("/graph", response_model=GraphData)
def get_graph():
    return current_graph

def build_live_ask_prompt(request: AskRequest) -> str:
    return (
        "You are a helpful research assistant for academic research knowledge graphs. "
        "Use only the provided connection data and evidence to answer the user question clearly. "
        "Do not invent new relationships. Keep the answer concise and grounded.\n\n"
        "Connection:\n"
        f"Source: {request.source}\n"
        f"Target: {request.target}\n"
        f"Relation: {request.relation}\n"
        f"Explanation: {request.explanation}\n"
        f"Evidence: {request.evidence}\n\n"
        f"User question: {request.question}\n"
        "Answer:")

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
            max_output_tokens=300,
        ),
    )
    answer_text = (response.text or "").strip()

    if current_graph_id:
        try:
            # Postgres: persist the live Q&A event for the current graph edge context
            save_qa_log(
                graph_id=current_graph_id,
                edge_source=request.source,
                edge_target=request.target,
                question=request.question,
                answer=answer_text,
            )
        except Exception as exc:
            print(f"Supabase QA persistence failed: {exc}")

    return AskResponse(answer=answer_text)
