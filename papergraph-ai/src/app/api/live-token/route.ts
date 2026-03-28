import { createLiveSessionToken, LiveRouteError } from "@/lib/server/live";
import { jsonNoStore, rejectIfRouteExposureRisk } from "@/lib/server/request-guard";
import type { GraphData } from "@/lib/types";

export const runtime = "nodejs";

type LiveTokenRequestBody = {
  graphData?: GraphData;
};

function isRouteError(error: unknown): error is LiveRouteError {
  return (
    error instanceof Error &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

function isGraphData(value: unknown): value is GraphData {
  const graph = value as GraphData;
  return Array.isArray(graph?.nodes) && Array.isArray(graph?.edges);
}

export async function POST(request: Request) {
  try {
    const rejection = rejectIfRouteExposureRisk(request);
    if (rejection) return rejection;

    const body = (await request.json()) as LiveTokenRequestBody;

    if (body.graphData !== undefined && !isGraphData(body.graphData)) {
      return jsonNoStore(
        { error: "graphData must be a valid GraphData object." },
        { status: 400 }
      );
    }

    const graphData = body.graphData ?? { nodes: [], edges: [] };
    const token = await createLiveSessionToken(graphData);

    return jsonNoStore(token);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonNoStore(
        { error: "Request body must be valid JSON." },
        { status: 400 }
      );
    }

    if (isRouteError(error)) {
      return jsonNoStore({ error: error.message }, { status: error.status });
    }

    return jsonNoStore(
      { error: "Unexpected live token failure." },
      { status: 500 }
    );
  }
}
