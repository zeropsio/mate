/**
 * Where an ended run's work goes on: a run a session's end cut carries on in its restart's
 * continuation, or, when its question was asked again by message (`askAgainByMessage`), in the
 * run its person's answer starts (`answerByMessage`, the answer's `bySend`); while that question
 * is open, it waits on their answer.
 *
 * @module engine/read/goesOn
 */
import type { RunEnd, RunId } from "@t3tools/contracts";

import { SESSION_ENDS } from "../domain/decide.carried.ts";

/** A question on the run that its person answers by message, as its record holds it, oldest first. */
export interface AskedByMessage {
  readonly state: string;
  /** The run whose message carries its answer, once answered; none while open or dismissed. */
  readonly bySend: RunId | null;
}

export type GoesOn = { readonly kind: "run"; readonly runId: RunId } | { readonly kind: "asked" };

/** Where the run's work goes on after its end; none when it goes on nowhere. */
export const goesOnIn = (end: RunEnd, asked: ReadonlyArray<AskedByMessage>): GoesOn | undefined => {
  if (end.kind === "cut-by-restart" && end.continuedBy !== null)
    return { kind: "run", runId: end.continuedBy };
  if (!SESSION_ENDS.has(end.kind)) return undefined;
  const carrier = asked.findLast((request) => request.state === "answered")?.bySend;
  if (carrier !== undefined && carrier !== null) return { kind: "run", runId: carrier };
  return asked.some((request) => request.state === "open") ? { kind: "asked" } : undefined;
};
