import { ZeropsApiError } from "./api.ts";

/** Turns a caught rejection into copy a picker or a connect flow can show. */
export function zeropsErrorMessage(error: unknown): string {
  if (error instanceof ZeropsApiError) return error.message;
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "Something went wrong talking to Zerops.";
}

/**
 * A write the platform may have done anyway — its answer lost, a creation's confirmation never
 * read: asked again, it could be done twice. The client's own error or the data layer's.
 */
export function isUncertainZeropsFailure(cause: unknown): boolean {
  if (cause instanceof ZeropsApiError) return cause.kind === "uncertain";
  return false;
}
