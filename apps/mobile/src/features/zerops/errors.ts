import { ZeropsApiError } from "@t3tools/client-runtime/zerops";

export function zeropsErrorMessage(error: unknown): string {
  if (error instanceof ZeropsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong talking to Zerops.";
}
