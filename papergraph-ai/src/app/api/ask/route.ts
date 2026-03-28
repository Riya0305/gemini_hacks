import { NextResponse } from "next/server";
import { GraphEdge } from "@/lib/types";
import { askGeminiAboutEdge, RouteError } from "@/lib/server/gemini";

export const runtime = "nodejs";

function isRouteError(error: unknown): error is RouteError {
  return (
    error instanceof Error &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

type AskRequestBody = {
  question?: string;
  context?: GraphEdge;
};

function isGraphEdge(value: unknown): value is GraphEdge {
  const edge = value as GraphEdge;
  return (
    typeof edge?.source === "string" &&
    typeof edge?.target === "string" &&
    typeof edge?.relation === "string" &&
    typeof edge?.explanation === "string" &&
    typeof edge?.evidence === "string"
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AskRequestBody;
    if (!body.question || !isGraphEdge(body.context)) {
      return NextResponse.json(
        { error: "question and context are required." },
        { status: 400 }
      );
    }

    const answer = await askGeminiAboutEdge(body.question, body.context);
    return NextResponse.json(answer);
  } catch (error) {
    if (isRouteError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unexpected ask failure." },
      { status: 500 }
    );
  }
}
