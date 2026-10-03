import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ClientSafeError,
  errorResponse,
  resolveRequestId,
  REQUEST_ID_HEADER,
} from "../errorResponse";
import { configureLogger, resetLoggerForTests } from "../logger";
import { middleware } from "@/middleware";
import { GET as getInvest } from "@/app/api/vault/invest/route";
import { GET as getHistory } from "@/app/api/vault/history/route";
import { GET as getApy } from "@/app/api/vault/apy/route";
import { GET as getCandidates } from "@/app/api/automation/candidates/route";

vi.mock("@/lib/vault/investSteps", () => ({
  MIN_IDLE_THRESHOLD: 1n,
  getVaultManagerEnv: () => {
    throw new Error("fixture upstream unavailable");
  },
  buildVaultClient: vi.fn(),
}));
vi.mock("@/lib/vault/investLedger", () => ({
  runOrResumeVaultInvest: vi.fn(),
  getVaultInvestLedgerStatus: vi.fn(),
  listVaultRunHistory: async () => {
    throw new Error("fixture upstream unavailable");
  },
}));
vi.mock("@/features/automation/utils/netApy", () => ({
  calcNetApyBps: () => {
    throw new Error("fixture upstream unavailable");
  },
}));
vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    get VAULT_MANAGER_SECRET_KEY() {
      throw new Error("fixture upstream unavailable");
    },
  },
}));
vi.mock("@/lib/env.client", () => ({
  clientEnv: {
    rpcUrl: "http://localhost:8000",
    networkPassphrase: "Test SDF Network ; September 2015",
    stellarNetwork: "TESTNET",
  },
}));

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
    const res = errorResponse(
      new ClientSafeError("walletAddress is required", 400),
      {
        requestId: "req-2",
        route: "/api/test",
      }
    );
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

  const routes = [
    ["/api/vault/invest", getInvest],
    ["/api/vault/history", getHistory],
    ["/api/vault/apy", getApy],
    ["/api/automation/candidates", getCandidates],
  ] as const;

  describe.each(["client-id", undefined])(
    "GET failures with request id %s",
    (incomingId) => {
      it.each(routes)(
        "keeps %s correlated with the safe response and server log",
        async (path, handler) => {
          const request = new NextRequest(`http://localhost${path}`, {
            headers: incomingId ? { [REQUEST_ID_HEADER]: incomingId } : {},
          });
          const middlewareResponse = middleware(request);
          const requestId = middlewareResponse.headers.get(REQUEST_ID_HEADER);
          expect(requestId).toBeTruthy();

          // Next forwards the middleware's request headers to the route handler.
          request.headers.set(
            REQUEST_ID_HEADER,
            middlewareResponse.headers.get(
              `x-middleware-request-${REQUEST_ID_HEADER}`
            )!
          );
          const response = await handler(request);
          const body = await response.json();

          expect(response.status).toBe(500);
          expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
          expect(body.requestId).toBe(requestId);
          expect(body.error).toMatch(/unexpected error/i);
          expect(JSON.stringify(body)).not.toContain(
            "fixture upstream unavailable"
          );
          expect(lines).toHaveLength(1);
          expect(JSON.parse(lines[0])).toMatchObject({
            requestId,
            route: path,
            err: { message: "fixture upstream unavailable" },
          });
        }
      );
    }
  );
});
