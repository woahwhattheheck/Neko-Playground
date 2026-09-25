/**
 * Redaction helpers for server-side logs (#318).
 *
 * Wallet addresses, session tokens, signed XDRs, and KYC identifiers must
 * never appear verbatim in log output.
 */

const WALLET_RE =
  /\b(G[A-Z0-9]{55}|0x[a-fA-F0-9]{40}|[a-f0-9]{64})\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const XDR_RE = /\b(?:AAAA|XDR)[A-Za-z0-9+/]{40,}={0,2}\b/g;

export const SENSITIVE_KEYS = new Set(
  [
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "apiKey",
    "api_key",
    "secret",
    "secretKey",
    "privateKey",
    "session",
    "sessionToken",
    "token",
    "accessToken",
    "refreshToken",
    "password",
    "signedXdr",
    "signed_xdr",
    "xdr",
    "customerId",
    "customer_id",
    "kycId",
    "kyc_id",
    "ssn",
    "taxId",
    "walletAddress",
    "wallet_address",
    "address",
    "publicKey",
    "public_key",
  ].map((k) => k.toLowerCase())
);

export function maskWallet(value: string): string {
  if (value.length <= 10) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function redactString(input: string): string {
  return input
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(JWT_RE, "[REDACTED_JWT]")
    .replace(XDR_RE, "[REDACTED_XDR]")
    .replace(WALLET_RE, (match) => maskWallet(match));
}

function redactKeyValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) {
    if (typeof value === "string") {
      if (
        key.toLowerCase().includes("wallet") ||
        key.toLowerCase() === "address" ||
        key.toLowerCase().includes("public")
      ) {
        return maskWallet(value);
      }
      return "[REDACTED]";
    }
    return "[REDACTED]";
  }
  return redactValue(value);
}

export function redactValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactKeyValue(k, v);
    }
    return out;
  }
  return String(value);
}

export function redactError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: redactString(err.message),
      stack: err.stack ? redactString(err.stack) : undefined,
    };
  }
  return { message: redactString(String(err)) };
}
