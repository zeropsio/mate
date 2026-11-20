import { isRecordKeptAsk, type ConversationState, type RunRecord } from "./domain/state.ts";

/** Ready sessions and durable armed wakes are safe; accepted work and unsettled writes are not. */
type IdleState = Pick<
  ConversationState,
  "activeRunId" | "queue" | "closing" | "pausedUntil" | "wakes"
> & {
  readonly runs: Readonly<
    Record<string, Pick<RunRecord, "end" | "state" | "admittedAt" | "startedAt">>
  >;
  readonly requests: Readonly<Record<string, Parameters<typeof isRecordKeptAsk>[0]>>;
  readonly answering: Readonly<Record<string, unknown>>;
  readonly effects: Readonly<Record<string, unknown>>;
};

const hasAcceptedRun = ({ queue, runs, pausedUntil, wakes }: IdleState): boolean => {
  if (queue.length > 0) {
    // The armed wake survives the admission fence, even if its reset comes due during the update.
    const parked =
      pausedUntil !== null &&
      Object.values(wakes).some((wake) =>
        pausedUntil === "unknown"
          ? wake.kind === "usage-probe"
          : wake.kind === "usage-resume" && wake.dueAt === pausedUntil,
      );
    if (!parked) return true;
    for (const id of queue) {
      const run = runs[id];
      if (
        run?.state !== "queued" ||
        run.admittedAt !== null ||
        run.startedAt !== null ||
        run.end !== null
      )
        return true;
    }
  }
  const parkedIds = new Set<string>(queue);
  return Object.entries(runs).some(([id, run]) => run.end === null && !parkedIds.has(id));
};

export const engineStateBlockers = (state: IdleState): ReadonlyArray<string> => {
  const blockers: string[] = [];
  if (state.activeRunId !== null) blockers.push("active run");
  if (hasAcceptedRun(state)) blockers.push("accepted run");
  // An ask on a card and a question asked by message live in the record, not in the agent's
  // turn: an update keeps them.
  const held = Object.values(state.requests).some((request) => !isRecordKeptAsk(request));
  if (held || Object.keys(state.answering).length > 0) blockers.push("open request");
  if (Object.keys(state.effects).length > 0) blockers.push("unsettled effect");
  if (state.closing !== null) blockers.push("session closing");
  return blockers;
};

/** When the conversation's latest run ended: the state keeps the last ended one. */
export const lastRunEndedAt = (state: Pick<ConversationState, "runs">): number | undefined => {
  let latest: number | undefined;
  for (const run of Object.values(state.runs))
    if (run.endedAt !== null && (latest === undefined || run.endedAt > latest))
      latest = run.endedAt;
  return latest;
};
