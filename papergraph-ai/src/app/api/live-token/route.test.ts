import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphData } from "@/lib/types";

const mockCreateLiveSessionToken = vi.fn();

class MockLiveRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LiveRouteError";
    this.status = status;
  }
}

vi.mock("@/lib/server/live", () => ({
  createLiveSessionToken: mockCreateLiveSessionToken,
  LiveRouteError: MockLiveRouteError,
}));

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/live-token/route");
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/live-token", () => {
  const graphData: GraphData = {
    nodes: [{ id: "Paper A", type: "concept", displayLabel: "Paper A" }],
    edges: [],
  };

  it("returns 400 for malformed JSON bodies", async () => {
    const { POST } = await loadRoute();
    const request = new Request("http://localhost/api/live-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-valid-json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mockCreateLiveSessionToken).not.toHaveBeenCalled();
  });

  it("returns 400 when graphData is malformed", async () => {
    const { POST } = await loadRoute();
    const request = new Request("http://localhost/api/live-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graphData: { nodes: "bad", edges: [] } }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "graphData must be a valid GraphData object.",
    });
    expect(mockCreateLiveSessionToken).not.toHaveBeenCalled();
  });

  it("returns a secure Live token payload", async () => {
    mockCreateLiveSessionToken.mockResolvedValue({
      token: "auth_tokens/example",
      model: "gemini-3.1-flash-live-preview",
      issuedAt: "2026-03-28T12:00:00.000Z",
      expiresAt: "2026-03-28T12:30:00.000Z",
      newSessionExpiresAt: "2026-03-28T12:01:00.000Z",
    });

    const { POST } = await loadRoute();
    const request = new Request("http://localhost/api/live-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graphData }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: "auth_tokens/example",
      model: "gemini-3.1-flash-live-preview",
      issuedAt: "2026-03-28T12:00:00.000Z",
      expiresAt: "2026-03-28T12:30:00.000Z",
      newSessionExpiresAt: "2026-03-28T12:01:00.000Z",
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mockCreateLiveSessionToken).toHaveBeenCalledWith(graphData);
  });

  it("rejects non-local requests unless explicitly allowed", async () => {
    const { POST } = await loadRoute();
    const request = new Request("https://papergraph.example/api/live-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graphData }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error:
        "This API route is restricted to localhost by default. Set APP_ORIGIN or ALLOWED_APP_ORIGINS only if you intentionally expose the app.",
    });
    expect(mockCreateLiveSessionToken).not.toHaveBeenCalled();
  });

  it("propagates LiveRouteError status codes", async () => {
    mockCreateLiveSessionToken.mockRejectedValue(
      new MockLiveRouteError(503, "Live token provisioning is unavailable.")
    );

    const { POST } = await loadRoute();
    const request = new Request("http://localhost/api/live-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graphData }),
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Live token provisioning is unavailable.",
    });
  });
});
