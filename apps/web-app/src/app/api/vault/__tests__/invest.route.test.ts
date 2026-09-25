import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env.client", () => ({
  clientEnv: {
    stellarNetwork: "TESTNET",
    rpcUrl: "http://rpc.local",
    horizonUrl: "http://horizon.local",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
}));

const {
  runOrResumeMock,
  ledgerStatusMock,
  getVaultManagerEnvMock,
  buildVaultClientMock,
} = vi.hoisted(() => ({
  runOrResumeMock: vi.fn(),
  ledgerStatusMock: vi.fn(),
  getVaultManagerEnvMock: vi.fn(() => ({
    secretKey: "S",
    rpcUrl: "http://rpc",
    networkPassphrase: "Test",
  })),
  buildVaultClientMock: vi.fn(() => ({
    client: {
      fetch_total_managed_funds: vi.fn(async () => ({
        result: [
          { idle_amount: 0n, total_amount: 0n, strategy_allocations: [] },
        ],
      })),
    },
  })),
}));

vi.mock("@/lib/vault/investLedger", () => ({
  runOrResumeVaultInvest: runOrResumeMock,
  getVaultInvestLedgerStatus: ledgerStatusMock,
}));

vi.mock("@/lib/vault/investSteps", () => ({
  MIN_IDLE_THRESHOLD: 10_000_000n,
  getVaultManagerEnv: getVaultManagerEnvMock,
  buildVaultClient: buildVaultClientMock,
}));

import { POST } from "../invest/route";
import { LeaseNotAcquiredError } from "@/lib/jobs/errors";

const CRON_SECRET = "test-cron-secret";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function postRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/vault/invest", {
    method: "POST",
    headers,
  });
}

function completedRun() {
  return {
    job: { status: "completed" },
    steps: [
      { kind: "harvest-aquarius", result: { hash: "h1", status: "SUCCESS" } },
      {
        kind: "invest-idle",
        result: { invested: false, results: [], idleAmount: 0 },
      },
      { kind: "collect-fees", result: { results: [], feesCollected: true } },
    ],
  };
}

describe("POST /api/vault/invest", () => {
  it("returns 401 when Authorization is missing", async () => {
    const res = await POST(postRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(runOrResumeMock).not.toHaveBeenCalled();
    expect(ledgerStatusMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the Bearer token is wrong", async () => {
    const res = await POST(
      postRequest({ Authorization: "Bearer wrong-secret" })
    );
    expect(res.status).toBe(401);
    expect(runOrResumeMock).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is unset even with a Bearer header", async () => {
    vi.stubEnv("CRON_SECRET", "");
    delete process.env.CRON_SECRET;

    const res = await POST(
      postRequest({ Authorization: `Bearer ${CRON_SECRET}` })
    );
    expect(res.status).toBe(401);
    expect(runOrResumeMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a spoofed x-vercel-cron header without Bearer auth", async () => {
    ledgerStatusMock.mockResolvedValue({
      canInvest: false,
      cooldownRemaining: 42,
    });
    runOrResumeMock.mockResolvedValue(completedRun());

    const res = await POST(postRequest({ "x-vercel-cron": "1" }));
    expect(res.status).toBe(401);
    expect(runOrResumeMock).not.toHaveBeenCalled();
  });

  it("returns 401 when x-vercel-cron is set alongside an invalid Bearer", async () => {
    const res = await POST(
      postRequest({
        "x-vercel-cron": "1",
        Authorization: "Bearer not-the-secret",
      })
    );
    expect(res.status).toBe(401);
    expect(runOrResumeMock).not.toHaveBeenCalled();
  });

  it("returns 429 when authenticated but the cooldown hasn't elapsed", async () => {
    ledgerStatusMock.mockResolvedValue({
      canInvest: false,
      cooldownRemaining: 42,
    });
    const res = await POST(
      postRequest({ Authorization: `Bearer ${CRON_SECRET}` })
    );
    expect(res.status).toBe(429);
    expect(runOrResumeMock).not.toHaveBeenCalled();
  });

  it("runs the invest flow with a valid Bearer CRON_SECRET", async () => {
    ledgerStatusMock.mockResolvedValue({
      canInvest: true,
      cooldownRemaining: 0,
    });
    runOrResumeMock.mockResolvedValue(completedRun());

    const res = await POST(
      postRequest({ Authorization: `Bearer ${CRON_SECRET}` })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(runOrResumeMock).toHaveBeenCalledTimes(1);
    // Response must not leak secret key material
    expect(JSON.stringify(body)).not.toContain(CRON_SECRET);
    expect(JSON.stringify(body)).not.toMatch(/S[A-Z0-9]{50,}/);
  });

  it("does not bypass cooldown when x-vercel-cron is present with valid Bearer", async () => {
    ledgerStatusMock.mockResolvedValue({
      canInvest: false,
      cooldownRemaining: 17,
    });

    const res = await POST(
      postRequest({
        "x-vercel-cron": "1",
        Authorization: `Bearer ${CRON_SECRET}`,
      })
    );
    expect(res.status).toBe(429);
    expect(runOrResumeMock).not.toHaveBeenCalled();
  });

  it("returns 409 when an overlapping invocation already holds the lease", async () => {
    ledgerStatusMock.mockResolvedValue({
      canInvest: true,
      cooldownRemaining: 0,
    });
    runOrResumeMock.mockRejectedValue(
      new LeaseNotAcquiredError("vault-invest", "singleton")
    );

    const res = await POST(
      postRequest({ Authorization: `Bearer ${CRON_SECRET}` })
    );
    expect(res.status).toBe(409);
  });
});
