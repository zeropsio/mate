/**
 * The client's one verdict on whether HQ ended the person's access, read by the HQ client and every
 * adapter and surface instead of comparing HQ's codes: the HQ session ended, or this scope is
 * denied to them, or neither. A code counts only on an answer HQ refused: one that passed through
 * an outage proves nothing about access.
 *
 * @module data/adapters/accessEnded
 */
import type { HqScopeFailure } from "@t3tools/shared/hqStream";

import type { HqError } from "../../zerops/hq/client.ts";
import type { StreamFault } from "../streamMachine.ts";

/** `session-ended`: HQ no longer takes the session. `scope-denied`: the person may not read this. */
export type AccessEnded = "session-ended" | "scope-denied";

/** What HQ answered, as each path holds it: a call's error, a scope's frame, a stream's fault. */
export type HqAnswer =
  | Pick<HqError, "kind" | "code">
  | Pick<HqScopeFailure, "disposition" | "code">
  | Pick<StreamFault, "outcome" | "code">;

/** What a person is told once HQ has refused the session the client just renewed. */
export const SESSION_REFUSED_WORDS =
  "HQ refused the renewed session. Try again, or sign in to Zerops again.";

const refused = (answer: HqAnswer): boolean =>
  "kind" in answer
    ? answer.kind === "refused"
    : "disposition" in answer
      ? answer.disposition === "refused"
      : answer.outcome !== "transient";

/** HQ's verdict in `answer`; `null` when it says nothing about the person's access. */
export function accessEnded(answer: HqAnswer): AccessEnded | null {
  if (!refused(answer)) return null;
  switch (answer.code) {
    case "session_required":
      return "session-ended";
    case "forbidden":
    case "chief_owner_required":
      return "scope-denied";
    default:
      return null;
  }
}
