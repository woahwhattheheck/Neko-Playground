import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ClientSafeError,
  errorResponse,
  resolveRequestId,
  REQUEST_ID_HEADER,
} from "../errorResponse";
import { configureLogger, resetLoggerForTests } from "../logger";

describe("errorResponse", () => {
  const lines: string[] = [];

  beforeEach(() => {
    lines.length = 0;
    configureLogger({
      sink: (line) => {
        lines.push(line);
      },
    });
  });

  afterEach(() => {
    resetLoggerForTests();
  });

  it("logs full error server-side and returns a safe client message", async () => {
    const stellar = "G" + "F".repeat(55);
    const res = errorResponse(new Error(`db boom near ${stellar}`), {
      requestId: "req-1",
      route: "/api/test",
      context: { walletAddress: stellar },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("req-1");
    const body = await res.json();
    expect(body.error).toMatch(/unexpected error/i);
    expect(body.requestId).toBe("req-1");
    expect(JSON.stringify(body)).not.toContain(stellar);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("api_route_error");
    expect(lines[0]).not.toContain(stellar);
    expect(lines[0]).toContain("req-1");
  });

  it("forwards client-safe error messages", async () => {
    const res = errorResponse(new ClientSafeError("walletAddress is required", 400), {
      requestId: "req-2",
      route: "/api/test",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("walletAddress is required");
  });

  it("reuses an incoming request id", () => {
    const req = new Request("http://localhost/api/x", {
      headers: { [REQUEST_ID_HEADER]: "client-id" },
    });
    expect(resolveRequestId(req)).toBe("client-id");
  });
});
