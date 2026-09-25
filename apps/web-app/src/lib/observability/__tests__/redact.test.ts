import { describe, it, expect } from "vitest";
import { maskWallet, redactString, redactValue, redactError } from "../redact";

describe("redact", () => {
  it("masks stellar and evm wallets in strings", () => {
    const stellar = "G" + "A".repeat(55);
    const evm = "0x" + "ab".repeat(20);
    expect(redactString(`wallet=${stellar}`)).not.toContain(stellar);
    expect(redactString(`wallet=${stellar}`)).toContain("…");
    expect(redactString(evm)).toBe(maskWallet(evm));
  });

  it("redacts bearer tokens, JWTs, and XDR-like blobs", () => {
    const out = redactString(
      "Bearer super-secret-token-value eyJhbGciOiJIUzI1NiJ9.payload.signature AAAA" +
        "B".repeat(48) +
        "=="
    );
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("super-secret-token-value");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("redacts sensitive object keys without leaving wallet/token verbatim", () => {
    const stellar = "G" + "C".repeat(55);
    const input = {
      walletAddress: stellar,
      token: "session-secret",
      signedXdr: "AAAA" + "D".repeat(60),
      nested: { apiKey: "abc123", ok: true },
      safe: "hello",
    };
    const out = redactValue(input) as Record<string, unknown>;
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(stellar);
    expect(serialized).not.toContain("session-secret");
    expect(serialized).not.toContain("abc123");
    expect(out.safe).toBe("hello");
    expect((out.nested as { ok: boolean }).ok).toBe(true);
  });

  it("redacts error messages that embed wallets", () => {
    const stellar = "G" + "E".repeat(55);
    const err = redactError(new Error(`swap failed for ${stellar}`));
    expect(String(err.message)).not.toContain(stellar);
  });
});
