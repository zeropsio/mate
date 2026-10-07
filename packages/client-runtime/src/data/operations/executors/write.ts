/**
 * A Zerops write as an operation's send: what its answer classifies as. A write whose answer may
 * have been lost — no answer, a dropped socket, a server error — may have applied: uncertain,
 * never sent again blindly. A write its admission refused before sending was not taken. A refusal
 * keeps what Zerops said.
 *
 * @module data/operations/executors/write
 */
import * as Effect from "effect/Effect";

import { ZeropsApiError, ZeropsWriteNotSent } from "../../../zerops/api.ts";
import { zeropsFault } from "../../../zerops/data/zeropsWire.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { UncertainAcceptance } from "../coordinator.ts";

function faultOf(cause: unknown): StreamFault | UncertainAcceptance {
  const message = cause instanceof Error ? cause.message : String(cause);
  // Refused before it was sent: final until the person changes the input or tries again.
  if (cause instanceof ZeropsWriteNotSent) return { outcome: "definitive-refusal", message };
  if (!(cause instanceof ZeropsApiError)) return { outcome: "uncertain-acceptance", message };
  if (
    cause.kind === "network" ||
    cause.kind === "uncertain" ||
    (cause.status !== null && cause.status >= 500)
  )
    return { outcome: "uncertain-acceptance", message };
  // What Zerops itself said, where it said anything; else the client's words for its status.
  return {
    ...zeropsFault(cause),
    message: cause.detail ?? message,
    ...(cause.code === null ? {} : { code: cause.code }),
  };
}

/** One Zerops write, its failure classified. */
export const verb = <A>(call: () => Promise<A>) => Effect.tryPromise({ try: call, catch: faultOf });
