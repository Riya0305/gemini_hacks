import { NextResponse } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function getConfiguredAllowedOrigins(): Set<string> {
  const configured = [
    process.env.ALLOWED_APP_ORIGINS,
    process.env.APP_ORIGIN,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => value.split(","))
    .map(normalizeOrigin)
    .filter(Boolean);

  return new Set(configured);
}

function isLocalRequest(url: URL): boolean {
  return LOCAL_HOSTS.has(url.hostname);
}

function getRequestOrigins(request: Request): string[] {
  const origins: string[] = [];
  const originHeader = request.headers.get("origin");
  if (originHeader) {
    origins.push(normalizeOrigin(originHeader));
  }

  const refererHeader = request.headers.get("referer");
  if (refererHeader) {
    try {
      origins.push(normalizeOrigin(new URL(refererHeader).origin));
    } catch {
      // ignore malformed referers
    }
  }

  return Array.from(new Set(origins));
}

export function rejectIfRouteExposureRisk(request: Request): NextResponse | null {
  const url = new URL(request.url);
  if (isLocalRequest(url)) {
    return null;
  }

  const allowedOrigins = getConfiguredAllowedOrigins();
  const requestOrigins = getRequestOrigins(request);

  if (
    requestOrigins.length > 0 &&
    requestOrigins.some((origin) => allowedOrigins.has(origin))
  ) {
    return null;
  }

  return NextResponse.json(
    {
      error:
        "This API route is restricted to localhost by default. Set APP_ORIGIN or ALLOWED_APP_ORIGINS only if you intentionally expose the app.",
    },
    { status: 403 }
  );
}

export function jsonNoStore(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
