import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FAUCET_COOLDOWN_MS } from "@/lib/constants/faucet";

const redisState = vi.hoisted(() => {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    store,
    set: vi.fn(
      async (
        key: string,
        value: unknown,
        opts?: { nx?: boolean; ex?: number }
      ) => {
        const now = Date.now();
        const existing = store.get(key);
        if (existing && existing.expiresAt > now) {
          if (opts?.nx) return null;
        }
        const ex = opts?.ex ?? 300;
        store.set(key, { value, expiresAt: now + ex * 1000 });
        return "OK";
      }
    ),
    ttl: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return -2;
      const remainingMs = entry.expiresAt - Date.now();
      if (remainingMs <= 0) {
        store.delete(key);
        return -2;
      }
      return Math.ceil(remainingMs / 1000);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    clear() {
      store.clear();
    },
  };
});

vi.mock("@upstash/redis", () => {
  class Redis {
    set = redisState.set;
    ttl = redisState.ttl;
    del = redisState.del;
  }
  return { Redis };
});

import {
  acquireFaucetRateLimit,
  releaseFaucetRateLimit,
  __resetFaucetRateLimitForTests,
} from "@/lib/faucetRateLimit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  redisState.clear();
  redisState.set.mockClear();
  redisState.ttl.mockClear();
  redisState.del.mockClear();
  __resetFaucetRateLimitForTests();
  vi.unstubAllEnvs();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.FAUCET_RATE_LIMIT_DISABLED;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  __resetFaucetRateLimitForTests();
});

describe("acquireFaucetRateLimit (in-memory fallback)", () => {
  it("allows the first request and blocks a second within cooldown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const first = await acquireFaucetRateLimit("GABC");
    expect(first).toEqual({ allowed: true, retryAfterSeconds: 0 });

    const second = await acquireFaucetRateLimit("GABC");
    expect(second.allowed).toBe(false);
    expect(second.retryAfterSeconds).toBe(Math.ceil(FAUCET_COOLDOWN_MS / 1000));

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("allows again after FAUCET_COOLDOWN_MS elapses", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await acquireFaucetRateLimit("GABC");
    vi.advanceTimersByTime(FAUCET_COOLDOWN_MS + 1);

    const again = await acquireFaucetRateLimit("GABC");
    expect(again).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("release frees the in-memory slot", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await acquireFaucetRateLimit("GABC");
    await releaseFaucetRateLimit("GABC");

    const again = await acquireFaucetRateLimit("GABC");
    expect(again.allowed).toBe(true);
  });

  it("FAUCET_RATE_LIMIT_DISABLED skips limiting", async () => {
    vi.stubEnv("FAUCET_RATE_LIMIT_DISABLED", "true");

    const a = await acquireFaucetRateLimit("GABC");
    const b = await acquireFaucetRateLimit("GABC");
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(redisState.set).not.toHaveBeenCalled();
  });
});

describe("acquireFaucetRateLimit (Upstash Redis NX)", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
  });

  it("uses SET NX EX and reports TTL on conflict", async () => {
    const first = await acquireFaucetRateLimit("GADDR");
    expect(first.allowed).toBe(true);
    expect(redisState.set).toHaveBeenCalledWith(
      "faucet:rl:GADDR",
      expect.any(Number),
      { nx: true, ex: Math.ceil(FAUCET_COOLDOWN_MS / 1000) }
    );

    const second = await acquireFaucetRateLimit("GADDR");
    expect(second.allowed).toBe(false);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
    expect(redisState.ttl).toHaveBeenCalledWith("faucet:rl:GADDR");
  });

  it("two parallel acquires produce a single winner", async () => {
    const [a, b] = await Promise.all([
      acquireFaucetRateLimit("GPARALLEL"),
      acquireFaucetRateLimit("GPARALLEL"),
    ]);
    const allowed = [a, b].filter((r) => r.allowed);
    const blocked = [a, b].filter((r) => !r.allowed);
    expect(allowed).toHaveLength(1);
    expect(blocked).toHaveLength(1);
  });

  it("accepts Vercel KV_REST_API_* env aliases", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "https://kv.vercel.com");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");

    const result = await acquireFaucetRateLimit("GKV");
    expect(result.allowed).toBe(true);
    expect(redisState.set).toHaveBeenCalled();
  });

  it("release deletes the Redis key", async () => {
    await acquireFaucetRateLimit("GREL");
    await releaseFaucetRateLimit("GREL");
    expect(redisState.del).toHaveBeenCalledWith("faucet:rl:GREL");

    const again = await acquireFaucetRateLimit("GREL");
    expect(again.allowed).toBe(true);
  });
});

describe("acquireFaucetRateLimit (production)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  it.each([
    ["missing configuration", {}],
    [
      "Upstash URL only",
      { UPSTASH_REDIS_REST_URL: "https://example.upstash.io" },
    ],
    ["Upstash token only", { UPSTASH_REDIS_REST_TOKEN: "token" }],
    ["Vercel KV URL only", { KV_REST_API_URL: "https://kv.vercel.com" }],
    ["Vercel KV token only", { KV_REST_API_TOKEN: "kv-token" }],
  ])("rejects %s instead of using instance-local state", async (_, config) => {
    for (const [key, value] of Object.entries(config)) {
      vi.stubEnv(key, value);
    }

    await expect(acquireFaucetRateLimit("GPROD")).rejects.toThrow(
      "Faucet rate limiting requires Redis configuration in production"
    );
    expect(redisState.set).not.toHaveBeenCalled();
  });

  it("cannot bypass missing shared storage with the local disable flag", async () => {
    vi.stubEnv("FAUCET_RATE_LIMIT_DISABLED", "true");

    await expect(acquireFaucetRateLimit("GPROD")).rejects.toThrow(
      "Faucet rate limiting requires Redis configuration in production"
    );
  });

  it("keeps the shared cooldown across local state resets even with the disable flag", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    vi.stubEnv("FAUCET_RATE_LIMIT_DISABLED", "true");

    expect((await acquireFaucetRateLimit("GPROD")).allowed).toBe(true);
    __resetFaucetRateLimitForTests();
    vi.advanceTimersByTime(1_000);

    expect(await acquireFaucetRateLimit("GPROD")).toEqual({
      allowed: false,
      retryAfterSeconds: Math.ceil(FAUCET_COOLDOWN_MS / 1000) - 1,
    });

    await releaseFaucetRateLimit("GPROD");
    expect(redisState.del).toHaveBeenCalledWith("faucet:rl:GPROD");
  });

  it("propagates Redis failures instead of allowing a local fallback", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    redisState.set.mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(acquireFaucetRateLimit("GPROD")).rejects.toThrow(
      "Redis unavailable"
    );
  });
});
