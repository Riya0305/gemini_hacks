# PaperGraph AI

PaperGraph AI turns uploaded research PDFs into an interactive graph workspace and lets you save reusable snapshots for later comparison.

> Last updated: 2026-03-28

## Requirements

- Node.js 20+
- npm
- Gemini API access

Optional:

- FastAPI backend at `backend/` for persistence and QA logging

## Setup

From the repo root:

```powershell
cd papergraph-ai
npm install
```

## Environment

Create a local env file:

```powershell
Copy-Item .env.example .env.local
```

Set the values you actually use:

```env
GEMINI_API_KEY=
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
BACKEND_URL=http://localhost:8000
GEMINI_MODEL=gemini-3-flash-preview
```

Notes:

- `GEMINI_API_KEY`
  - used by Next.js server-side extract and ask routes
- `GEMINI_MODEL`
  - optional override, default is already `gemini-3-flash-preview`
- `GEMINI_LIVE_MODEL`
  - optional override for the secure Live session model
- `BACKEND_URL`
  - optional, only needed if you want FastAPI persistence/logging

## Run Locally

Frontend:

```powershell
npm run dev
```

Open:

```text
http://localhost:3000
```

Optional backend:

```powershell
cd ..\backend
python -m uvicorn backend.main:app --reload --port 8000
```

## Current Workflow

1. Upload 1-5 PDFs.
2. Extract with Gemini.
3. Explore the graph in `Workspace`.
4. Save the graph with `Save Snapshot`.
5. Reopen saved snapshots from `Saved`.
6. Open secure Gemini Live for voice, screen-context, and graph-aware analysis without exposing the long-lived API key to the browser.

Important:

- save is non-destructive
- saving no longer clears the current workspace graph

## Current Models

- extract / analyze PDFs: `gemini-3-flash-preview`
- edge Q&A: `gemini-3-flash-preview`
- secure Live: `gemini-3.1-flash-live-preview`

## Architecture

The current product path is frontend-first:

```text
Upload PDFs
  -> POST /api/extract
  -> src/lib/server/gemini.ts
  -> Gemini generateContent
  -> normalize graph
  -> heuristic paper-edge backfill
  -> graph shown in Workspace
  -> optional background persistence to FastAPI
```

Supporting routes:

- `/api/ask`
  - grounded Q&A against a selected edge
- `/api/live-token`
  - secure server-minted ephemeral token for Gemini Live

The optional `backend/` service persists uploads, graph JSON, and Q&A logs to Supabase and also exposes a simpler standalone `/upload` and `/ask` mode.

## Parsing Algorithm

The parsing pipeline in `src/lib/server/gemini.ts` currently works like this:

1. Validate PDF count, type, and total bytes.
2. Convert each PDF into one inline Gemini part.
3. Ask Gemini for a strict `GraphData` JSON payload.
4. If Gemini returns malformed JSON, run a repair pass.
5. Normalize node ids, aliases, labels, and edges.
6. Rebuild missing paper nodes if needed.
7. Derive paper analyses from the normalized graph.
8. Backfill missing paper-to-paper edges from shared themes and shared keywords.
9. Apply theme colors to paper nodes and inherited colors to topic nodes.

This is the current code path. Older notes about a separate title-analysis stage are no longer the authoritative description.

## Secure Gemini Live

Live no longer depends on a browser `NEXT_PUBLIC_*` key.

Current flow:

1. `LiveChat.tsx` posts the current graph to `/api/live-token`.
2. The server route validates the request and applies origin restrictions.
3. `src/lib/server/live.ts` reads `GEMINI_API_KEY` server-side.
4. The server mints a constrained ephemeral token with one use and explicit expiry windows.
5. The browser connects to Gemini Live with that short-lived token.
6. Live tool calls can add nodes, add edges, and highlight nodes in the current graph.

This keeps the long-lived Gemini key on the server only.

## Useful Commands

Lint:

```powershell
npm run lint
```

Tests:

```powershell
npm test
```

Typecheck:

```powershell
npx tsc --noEmit
```

Production build:

```powershell
npm run build
```

## Test Coverage

Current frontend tests cover:

- `/api/ask`
- `/api/extract`
- `/api/live-token`
- `src/lib/server/backend-client.ts`
- heuristic paper-edge generation in `src/lib/server/gemini.ts`

The backend also has Python unittest coverage for persistence and ask logging behavior.

## Important Learnings

- the extract pipeline is strongest when described as merged extraction plus normalize/repair/backfill, not as a multi-stage title pipeline
- the app reads better as a workspace + saved snapshots product than as a current/archive product
- secure Live now uses a server-issued ephemeral token instead of a browser API key

## Troubleshooting

If extract fails:

- confirm `GEMINI_API_KEY` is set in `.env.local`
- confirm PDFs are valid and under the app limits
- confirm you uploaded PDFs, not other file types

If persistence is not happening:

- confirm `BACKEND_URL` is set
- confirm FastAPI is running on that URL
- remember the frontend still works if the backend is offline
