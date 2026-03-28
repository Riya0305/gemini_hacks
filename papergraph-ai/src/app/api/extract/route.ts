import { NextResponse } from "next/server";
import { GraphData } from "@/lib/types";
import { extractGraphFromPdfs, RouteError } from "@/lib/server/gemini";
import { persistExtraction } from "@/lib/server/backend-client";
import { rejectIfRouteExposureRisk } from "@/lib/server/request-guard";

export const runtime = "nodejs";

function isRouteError(error: unknown): error is RouteError {
  return (
    error instanceof Error &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

function buildFallbackGraph(files: File[]): GraphData {
  const nodes = files.map((file, index) => {
    return {
      id: `Paper ${index + 1} (analysis unavailable)`,
      type: "concept" as const,
      displayLabel: `Paper ${index + 1}`,
      paperTitle: `Paper ${index + 1} (analysis unavailable)`,
      themeLabel: "Needs reprocessing",
      themeDescription:
        "This upload needs to be reprocessed before a reliable paper theme can be assigned.",
      colorHex: "#94a3b8",
      summary:
        "Paper content was uploaded, but Gemini returned malformed graph JSON. Re-upload to regenerate structured analysis.",
      evidence: `Uploaded file mapped internally as Paper ${index + 1}.`,
      paperLabel: `Paper ${index + 1}`,
    };
  });

  if (nodes.length === 0) {
    nodes.push({
      id: "Uploaded article",
      type: "concept",
      displayLabel: "Uploaded article",
      paperTitle: "Uploaded article",
      themeLabel: "Unavailable",
      themeDescription: "No valid papers were available to derive a theme legend.",
      colorHex: "#94a3b8",
      summary:
        "No valid PDFs were detected for fallback graph construction.",
      evidence: "No source files available.",
      paperLabel: "Paper 1",
    });
  }

  return {
    nodes,
    edges: [],
  };
}

export async function POST(request: Request) {
  let files: File[] = [];

  try {
    const rejection = rejectIfRouteExposureRisk(request);
    if (rejection) return rejection;

    const formData = await request.formData();
    files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    const graph = await extractGraphFromPdfs(files);

    console.log(
      `[extract] Graph result: ${graph.nodes.length} nodes, ${graph.edges.length} edges`
    );

    // fire-and-forget: persist to backend (Supabase) without blocking the response
    persistExtraction(files, graph).catch((err) =>
      console.warn("Background persistence failed:", err)
    );

    return NextResponse.json(graph);
  } catch (error) {
    if (isRouteError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof SyntaxError) {
      const fallback = buildFallbackGraph(files);

      persistExtraction(files, fallback).catch((err) =>
        console.warn("Background fallback persistence failed:", err)
      );

      return NextResponse.json(fallback);
    }

    return NextResponse.json(
      { error: "Unexpected extract failure." },
      { status: 500 }
    );
  }
}
