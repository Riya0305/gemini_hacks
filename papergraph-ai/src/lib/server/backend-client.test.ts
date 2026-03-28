import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphData, GraphEdge } from "@/lib/types";

const originalBackendUrl = process.env.BACKEND_URL;

const graph: GraphData = {
  nodes: [{ id: "Paper A", type: "concept" }],
  edges: [],
};

const edge: GraphEdge = {
  source: "Paper A",
  target: "Method B",
  relation: "uses",
  explanation: "Paper A uses Method B.",
  evidence: "Evidence",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  if (originalBackendUrl === undefined) {
    delete process.env.BACKEND_URL;
  } else {
    process.env.BACKEND_URL = originalBackendUrl;
  }
});

describe("backend-client", () => {
  it("does nothing when BACKEND_URL is not configured", async () => {
    delete process.env.BACKEND_URL;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { persistExtraction } = await import("@/lib/server/backend-client");

    await persistExtraction([], graph);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips persistence when the backend returns a non-ok response", async () => {
    process.env.BACKEND_URL = "http://localhost:8000/";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("fail", { status: 503, statusText: "Service Unavailable" })
    );
    const { persistQaEvent } = await import("@/lib/server/backend-client");

    await persistQaEvent(edge, "Why?", "Because");

    expect(warnSpy).toHaveBeenCalledWith(
      "Backend /persist-qa returned 503, skipping persistence."
    );
  });

  it("returns false from health checks when fetch throws", async () => {
    process.env.BACKEND_URL = "http://localhost:8000";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const { isBackendHealthy } = await import("@/lib/server/backend-client");

    await expect(isBackendHealthy()).resolves.toBe(false);
  });
});
