export const DEFAULT_USER_ERROR_MESSAGE =
  "Something went wrong. Please try again.";

type ErrorLike = {
  message?: unknown;
  userMessage?: unknown;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * Convert internal/wallet/orchestrator failures into a short message that is
 * safe to show in UI. AdapterError already carries a curated userMessage, so
 * preserve it instead of exposing its diagnostic wrapper.
 */
export function getUserFacingErrorMessage(
  error: unknown,
  fallback: string = DEFAULT_USER_ERROR_MESSAGE
): string {
  if (error && typeof error === "object") {
    const explicit = nonEmptyString((error as ErrorLike).userMessage);
    if (explicit) return explicit;
  }

  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error && typeof error === "object"
          ? nonEmptyString((error as ErrorLike).message)
          : undefined;

  if (!raw) return fallback;

  const message = raw.toLowerCase();

  if (
    /user.*(reject|declin|cancel)|request.*(reject|declin|cancel)|rejected by user/.test(
      message
    )
  ) {
    return "The wallet request was rejected.";
  }

  if (/timeout|timed out|deadline exceeded/.test(message)) {
    return "The request timed out. Please try again.";
  }

  if (
    /failed to fetch|fetch failed|network|connection|socket|rpc unavailable/.test(
      message
    )
  ) {
    return "Unable to reach the network. Check your connection and try again.";
  }

  if (/insufficient|not enough/.test(message)) {
    return "There are not enough funds to complete this action.";
  }

  return fallback;
}

/**
 * Central diagnostic path for failures that may be recovered from locally.
 * Returns the normalized message so callers that own UI can surface it.
 */
export function reportAppError(
  context: string,
  error: unknown,
  fallback?: string
): string {
  console.error(`[${context}]`, error);
  return getUserFacingErrorMessage(error, fallback);
}
