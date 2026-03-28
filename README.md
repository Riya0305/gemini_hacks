# PaperGraph AI

Explainable Research Knowledge Graphs with Live Interaction.

## Project structure

- `/backend` — FastAPI backend with `/upload`, `/graph`, `/ask`
- `/frontend` — React + Vite frontend shell for graph UI
- `/sample-data` — mock graph JSON for quick frontend unblock

## User workflow

1. Upload 1–5 PDFs
2. Backend extracts nodes + edges with Gemini
3. Frontend renders graph
4. Click edge to view explanation + evidence
5. Ask follow-up question and receive live Gemini answer

## Getting started

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# then edit .env with real keys:
# GEMINI_API_KEY, SUPABASE_URL, SUPABASE_KEY
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

Frontend scaffolding is included in `/frontend`.

## Notes

This repo is intentionally structured around the winning workflow:
`Upload → Graph → Click → Ask → Understand`.
