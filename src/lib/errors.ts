export interface AppError {
  code: string;
  message: string;
  details?: string;
}

export function toAppError(error: unknown, fallback = "Unexpected error"): AppError {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") {
      return {
        code: typeof record.code === "string" ? record.code : "UNKNOWN",
        message: record.message,
        details: typeof record.details === "string" ? record.details : undefined,
      };
    }
  }

  if (typeof error === "string") {
    return { code: "UNKNOWN", message: error };
  }

  return { code: "UNKNOWN", message: fallback, details: String(error) };
}
