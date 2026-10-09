/** Classifies source refusals separately from a lost Mate transport. */
import { EnvironmentAuthorizationError, ZeropsDataConsoleError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describeDataConsoleError } from "../../zerops/dataConsole.ts";
import type { StreamFault } from "../streamMachine.ts";

const isConsoleError = Schema.is(ZeropsDataConsoleError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);
const isFault = (value: unknown): value is StreamFault =>
  typeof value === "object" && value !== null && "outcome" in value && "message" in value;
export function classifyDatabaseFailure(error: unknown): StreamFault {
  if (isFault(error)) return error;
  if (isAuthorizationError(error))
    return { outcome: "authoritative-denial", message: error.message };
  if (isConsoleError(error) && error.code === "denied")
    return { outcome: "authoritative-denial", message: "Access denied.", code: "denied" };
  if (isConsoleError(error))
    return {
      outcome: ["unreachable", "upstream", "timeout", "internal", "session_unavailable"].includes(
        error.code,
      )
        ? "transient"
        : "definitive-refusal",
      message: describeDataConsoleError(error),
      code: error.code,
    };
  return { outcome: "transient", message: "Something went wrong." };
}
