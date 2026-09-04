import { ZeropsApiError } from "./api.ts";

/** Turns a caught rejection into copy a picker or a connect flow can show. */
export function zeropsErrorMessage(error: unknown): string {
  if (error instanceof ZeropsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong talking to Zerops.";
}
