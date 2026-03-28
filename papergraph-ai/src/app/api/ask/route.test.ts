import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphEdge } from "@/lib/types";

const mockAskGeminiAboutEdge = vi.fn();
const mockPersistQaEvent = vi.fn();

class MockRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RouteError";
    this.status = status;
  }
}

vi.mock("@/lib/server/gemini", () => ({
  askGeminiAboutEdge: mockAskGeminiAboutEdge,
  RouteError: MockRouteError,
}));

vi.mock("@/lib/server/backend-client", () => ({
  persistQaEvent: mockPersistQaEvent,
}));

const validEdge: GraphEdge = {
  source: "A",
  target: "B",
  relation: "supports",
  explanation: "A supports B.",
  evidence: "Evidence",
};

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/ask/route");
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/ask", () => {
  it("returns 400 for malformed JSON bodies", async () => {
    const { POST } = await loadRoute();
    const request = new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-valid-json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mockAskGeminiAboutEdge).not.toHaveBeenCalled();
  });

  it("returns 400 when question or context is missing", async () => {
    const { POST } = await loadRoute();
    const request = new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "", context: validEdge }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "question and context are required.",
    });
  });

  it("returns the Gemini answer and logs QA in the background", async () => {
    mockAskGeminiAboutEdge.mockResolvedValue({ answer: "Grounded answer" });
    mockPersistQaEvent.mockResolvedValue(undefined);

    const { POST } = await loadRoute();
    const request = new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Why?", context: validEdge }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ answer: "Grounded answer" });
    expect(mockAskGeminiAboutEdge).toHaveBeenCalledWith("Why?", validEdge);
    expect(mockPersistQaEvent).toHaveBeenCalledWith(
      validEdge,
      "Why?",
      "Grounded answer"
    );
  });

  it("propagates RouteError status codes", async () => {
    mockAskGeminiAboutEdge.mockRejectedValue(new MockRouteError(429, "Rate limited"));

    const { POST } = await loadRoute();
    const request = new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Why?", context: validEdge }),
    });

    const response = await POST(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "Rate limited" });
  });

  it("rejects non-local requests unless explicitly allowed", async () => {
    const { POST } = await loadRoute();
    const request = new Request("https://papergraph.example/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Why?", context: validEdge }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error:
        "This API route is restricted to localhost by default. Set APP_ORIGIN or ALLOWED_APP_ORIGINS only if you intentionally expose the app.",
    });
    expect(mockAskGeminiAboutEdge).not.toHaveBeenCalled();
  });
});
