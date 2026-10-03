import { Redis } from "@upstash/redis";
import { FAUCET_COOLDOWN_MS } from "@/lib/constants/faucet";

export type FaucetRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const memoryStore = new Map<string, number>();
let warnedInMemoryFallback = false;

function cooldownSeconds(): number {
  return Math.max(1, Math.ceil(FAUCET_COOLDOWN_MS / 1000));
}

function keyFor(address: string): string {
  return `faucet:rl:${address}`;
}

function isRateLimitDisabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.FAUCET_RATE_LIMIT_DISABLED === "true"
  );
}

/**
 * Prefer Upstash REST env; also accept Vercel KV REST vars (same shape).
 * Read at call time so tests can stub env without reloading the module.
 */
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Faucet rate limiting requires Redis configuration in production"
      );
    }
    return null;
  }
  return new Redis({ url, token });
}

function acquireInMemory(address: string): FaucetRateLimitResult {
  if (!warnedInMemoryFallback) {
    console.warn(
      "[faucet] Rate limit using in-memory Map (no Upstash/Vercel KV configured). " +
        "Not durable across serverless instances. Set UPSTASH_REDIS_REST_URL + " +
        "UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_*), or FAUCET_RATE_LIMIT_DISABLED=true for local tooling."
    );
    warnedInMemoryFallback = true;
  }

  const now = Date.now();
  const last = memoryStore.get(address);
  if (last !== undefined && now - last < FAUCET_COOLDOWN_MS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((FAUCET_COOLDOWN_MS - (now - last)) / 1000)
      ),
    };
  }

  // Check + set is synchronous (no await between), so two concurrent
  // requests on one Node process cannot both pass within a single tick.
  memoryStore.set(address, now);
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Atomically acquire a faucet mint slot for `address`.
 *
 * Production: Redis `SET key now NX EX <cooldownSeconds>` — shared across
 * cold starts and parallel instances. Missing configuration rejects the mint.
 * Outside production / no KV: in-memory Map + one-shot warn.
 * Local tooling: `FAUCET_RATE_LIMIT_DISABLED=true` only skips limiting outside
 * production; it never bypasses the shared production cooldown.
 */
export async function acquireFaucetRateLimit(
  address: string
): Promise<FaucetRateLimitResult> {
  if (isRateLimitDisabled()) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const redis = getRedis();
  if (!redis) {
    return acquireInMemory(address);
  }

  const key = keyFor(address);
  const ex = cooldownSeconds();
  const set = await redis.set(key, Date.now(), { nx: true, ex });

  if (set === "OK") {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const ttl = await redis.ttl(key);
  return {
    allowed: false,
    retryAfterSeconds: ttl > 0 ? ttl : ex,
  };
}

/**
 * Release a previously acquired slot (e.g. mint failed). Safe no-op when
 * limiting is disabled.
 */
export async function releaseFaucetRateLimit(address: string): Promise<void> {
  if (isRateLimitDisabled()) return;

  const redis = getRedis();
  if (!redis) {
    memoryStore.delete(address);
    return;
  }

  await redis.del(keyFor(address));
}

/** Test-only: clear in-memory state and the one-shot warn flag. */
export function __resetFaucetRateLimitForTests(): void {
  memoryStore.clear();
  warnedInMemoryFallback = false;
}
