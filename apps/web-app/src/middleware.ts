import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const HEADER = "x-request-id";

/**
 * Ensure every /api response carries a correlation id (#318).
 * Generates one when the client did not send it, and forwards the same value
 * on both the request (for route handlers) and the response.
 */
export function middleware(request: NextRequest) {
  const incoming = request.headers.get(HEADER);
  const requestId =
    incoming && incoming.trim() ? incoming.trim().slice(0, 128) : crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(HEADER, requestId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(HEADER, requestId);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
