// Thin client for forwarding data to the FastAPI persistence backend.
// Every call is fire-and-forget with graceful degradation — if the backend
// is unreachable, the frontend keeps working normally.

import { GraphData, GraphEdge } from "@/lib/types";

function getBackendUrl(): string | null {
  const url = process.env.BACKEND_URL;
  if (!url) return null;
  // strip trailing slash so callers can just append paths
  return url.replace(/\/+$/, "");
}

async function backendFetch(
  path: string,
  init: RequestInit
): Promise<Response | null> {
  const base = getBackendUrl();
  if (!base) return null;

  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.warn(`Backend ${path} returned ${response.status}, skipping persistence.`);
      return null;
    }
    return response;
  } catch (error) {
    console.warn(`Backend ${path} unreachable, skipping persistence:`, error);
    return null;
  }
}

/**
 * Forward uploaded PDFs + the already-extracted graph to the backend
 * so it can persist to Supabase. Returns the backend response or null.
 */
export async function persistExtraction(
  files: File[],
  graph: GraphData
): Promise<void> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  formData.append("graph_json", JSON.stringify(graph));

  await backendFetch("/persist-graph", {
    method: "POST",
    body: formData,
  });
}

/**
 * Forward a Q&A event to the backend for logging.
 */
export async function persistQaEvent(
  edge: GraphEdge,
  question: string,
  answer: string
): Promise<void> {
  await backendFetch("/persist-qa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      edge_source: edge.source,
      edge_target: edge.target,
      relation: edge.relation,
      question,
      answer,
    }),
  });
}

/**
 * Simple health check — returns true if the backend responds within 3s.
 */
export async function isBackendHealthy(): Promise<boolean> {
  const base = getBackendUrl();
  if (!base) return false;

  try {
    const response = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
