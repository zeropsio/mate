import type { ConversationState } from "./domain/state.ts";

/** Ready sessions and durable armed wakes are safe; accepted work and unsettled writes are not. */
type IdleState = Pick<ConversationState, "activeRunId" | "queue" | "closing" | "history"> & {
  readonly runs: Readonly<Record<string, { readonly end: unknown | null }>>;
  readonly requests: Readonly<Record<string, { readonly kind?: string }>>;
  readonly answering: Readonly<Record<string, unknown>>;
  readonly effects: Readonly<Record<string, unknown>>;
};

export const engineStateBlockers = (state: IdleState): ReadonlyArray<string> => {
  const blockers: string[] = [];
  if (state.activeRunId !== null) blockers.push("active run");
  if (state.queue.length > 0 || Object.values(state.runs).some((run) => run.end === null))
    blockers.push("accepted run");
  // A value asked of the person lives in the record, not in the agent's turn: an update keeps it.
  const held = Object.values(state.requests).some((request) => request.kind !== "vault");
  if (held || Object.keys(state.answering).length > 0) blockers.push("open request");
  if (Object.keys(state.effects).length > 0) blockers.push("unsettled effect");
  if (state.closing !== null) blockers.push("session closing");
  // Its earlier record is still being copied in: a restart would requeue it mid-way (Sage).
  if (state.history?.state === "importing") blockers.push("history import");
  return blockers;
};
