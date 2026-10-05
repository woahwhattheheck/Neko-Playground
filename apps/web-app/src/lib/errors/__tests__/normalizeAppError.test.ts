import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_USER_ERROR_MESSAGE,
  getUserFacingErrorMessage,
  reportAppError,
} from "../normalizeAppError";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getUserFacingErrorMessage", () => {
  it("preserves an AdapterError-style curated userMessage", () => {
    expect(
      getUserFacingErrorMessage({
        message: "[blend] deposit failed: internal rpc detail",
        userMessage: "Transaction simulation failed.",
      })
    ).toBe("Transaction simulation failed.");
  });

  it("normalizes common wallet rejection and network failures", () => {
    expect(getUserFacingErrorMessage(new Error("User rejected request"))).toBe(
      "The wallet request was rejected."
    );
    expect(getUserFacingErrorMessage(new Error("Failed to fetch RPC"))).toBe(
      "Unable to reach the network. Check your connection and try again."
    );
  });

  it("does not expose arbitrary internal error text", () => {
    expect(
      getUserFacingErrorMessage(new Error("postgres password=secret"))
    ).toBe(DEFAULT_USER_ERROR_MESSAGE);
  });

  it("uses a caller-specific fallback when provided", () => {
    expect(
      getUserFacingErrorMessage(new Error("opaque failure"), "Wallet unavailable.")
    ).toBe("Wallet unavailable.");
  });
});

describe("reportAppError", () => {
  it("logs diagnostics while returning only the normalized UI message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("deadline exceeded");

    expect(reportAppError("wallet.refresh", error)).toBe(
      "The request timed out. Please try again."
    );
    expect(spy).toHaveBeenCalledWith("[wallet.refresh]", error);
  });
});
