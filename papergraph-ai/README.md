# PaperGraph AI

PaperGraph AI turns uploaded research PDFs into an interactive knowledge graph.

## Requirements

- Node.js 20+
- npm
- A local Gemini API key

## Setup

From the repo root:

```powershell
cd papergraph-ai
npm install
```

## Environment

Create a local env file from the example:

```powershell
Copy-Item .env.example .env
```

Then set your local key in `papergraph-ai/.env`:

```env
GEMINI_API_KEY=
```

Notes:
- `.env` is ignored by Git
- `.env.example` is safe to commit
- if a real key was ever committed before, rotate it

## Run Locally

```powershell
npm run dev
```

Open:

```text
http://localhost:3000
```

## Useful Commands

Lint:

```powershell
npm run lint
```

Typecheck:

```powershell
npx tsc --noEmit
```

Production build:

```powershell
npm run build
```

## Secret Safety

This repo is set up so that:

- `.env` files are ignored
- common key/cert files are ignored

## Current Workflow

1. Upload 1-5 PDF papers.
2. Click `Extract With Gemini And Build Graph`.
3. Inspect nodes and edges in the graph.
4. Drag nodes to reposition them.
5. Use `Archive Current` to save the current graph into history and clear the workspace.

## Troubleshooting

If extraction fails:
- confirm `GEMINI_API_KEY` is set in `.env`
- make sure you uploaded PDFs, not other file types
- keep total upload size under the app limit

If a fresh clone does not block secrets on commit:
- confirm you are not committing any local `.env` or key/cert files
- verify ignored files with `git check-ignore -v papergraph-ai/.env`
