import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphData } from "@/lib/types";

const mockExtractGraphFromPdfs = vi.fn();
const mockPersistExtraction = vi.fn();

class MockRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RouteError";
    this.status = status;
  }
}

vi.mock("@/lib/server/gemini", () => ({
  extractGraphFromPdfs: mockExtractGraphFromPdfs,
  RouteError: MockRouteError,
}));

vi.mock("@/lib/server/backend-client", () => ({
  persistExtraction: mockPersistExtraction,
}));

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/extract/route");
}

function buildRequest(files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  return new Request("http://localhost/api/extract", {
    method: "POST",
    body: formData,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/extract", () => {
  it("returns the extracted graph and schedules persistence", async () => {
    const graph: GraphData = {
      nodes: [{ id: "Paper A", type: "concept", displayLabel: "Paper A" }],
      edges: [],
    };
    const file = new File(["%PDF-1.4"], "paper-a.pdf", {
      type: "application/pdf",
    });
    mockExtractGraphFromPdfs.mockResolvedValue(graph);
    mockPersistExtraction.mockResolvedValue(undefined);

    const { POST } = await loadRoute();
    const response = await POST(buildRequest([file]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(graph);
    expect(mockExtractGraphFromPdfs).toHaveBeenCalledTimes(1);
    expect(
      mockExtractGraphFromPdfs.mock.calls[0]?.[0].map((item: File) => item.name)
    ).toEqual(["paper-a.pdf"]);
    expect(mockPersistExtraction).toHaveBeenCalledTimes(1);
    expect(
      mockPersistExtraction.mock.calls[0]?.[0].map((item: File) => item.name)
    ).toEqual(["paper-a.pdf"]);
    expect(mockPersistExtraction.mock.calls[0]?.[1]).toEqual(graph);
  });

  it("returns a fallback graph when Gemini returns malformed JSON", async () => {
    const files = [
      new File(["%PDF-1.4"], "alpha.pdf", { type: "application/pdf" }),
      new File(["%PDF-1.4"], "beta.pdf", { type: "application/pdf" }),
    ];
    mockExtractGraphFromPdfs.mockRejectedValue(new SyntaxError("bad json"));
    mockPersistExtraction.mockResolvedValue(undefined);

    const { POST } = await loadRoute();
    const response = await POST(buildRequest(files));
    const payload = (await response.json()) as GraphData;

    expect(response.status).toBe(200);
    expect(payload.edges).toEqual([]);
    expect(payload.nodes).toHaveLength(2);
    expect(payload.nodes[0]?.displayLabel).toBe("Paper 1");
    expect(payload.nodes[1]?.displayLabel).toBe("Paper 2");
    expect(mockPersistExtraction).toHaveBeenCalledTimes(1);
    expect(
      mockPersistExtraction.mock.calls[0]?.[0].map((item: File) => item.name)
    ).toEqual(["alpha.pdf", "beta.pdf"]);
    expect(mockPersistExtraction.mock.calls[0]?.[1]).toEqual(payload);
  });

  it("propagates RouteError status codes", async () => {
    const file = new File(["%PDF-1.4"], "paper-a.pdf", {
      type: "application/pdf",
    });
    mockExtractGraphFromPdfs.mockRejectedValue(new MockRouteError(413, "Too many files"));

    const { POST } = await loadRoute();
    const response = await POST(buildRequest([file]));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Too many files" });
    expect(mockPersistExtraction).not.toHaveBeenCalled();
  });

  it("rejects non-local requests unless explicitly allowed", async () => {
    const file = new File(["%PDF-1.4"], "paper-a.pdf", {
      type: "application/pdf",
    });

    const formData = new FormData();
    formData.append("files", file);

    const { POST } = await loadRoute();
    const response = await POST(
      new Request("https://papergraph.example/api/extract", {
        method: "POST",
        body: formData,
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error:
        "This API route is restricted to localhost by default. Set APP_ORIGIN or ALLOWED_APP_ORIGINS only if you intentionally expose the app.",
    });
    expect(mockExtractGraphFromPdfs).not.toHaveBeenCalled();
    expect(mockPersistExtraction).not.toHaveBeenCalled();
  });
});
