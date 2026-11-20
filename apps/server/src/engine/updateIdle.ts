import {
  isAskedAgainByMessage,
  isRecordKeptAsk,
  type ConversationState,
  type OpenRequest,
  type RunRecord,
} from "./domain/state.ts";

type IdleRun = Pick<RunRecord, "end" | "state" | "admittedAt" | "startedAt" | "waitingOn">;
type IdleRequest = Pick<OpenRequest, "runId" | "dismissible" | "kind" | "asked" | "byHelper">;

/** Ready sessions and durable armed wakes are safe; accepted work and unsettled writes are not. */
type IdleState = Pick<
  ConversationState,
  "activeRunId" | "queue" | "closing" | "pausedUntil" | "wakes"
> & {
  readonly runs: Readonly<Record<string, IdleRun>>;
  readonly requests: Readonly<Record<string, IdleRequest>>;
  readonly answering: Readonly<Record<string, unknown>>;
  readonly effects: Readonly<Record<string, unknown>>;
};

/**
 * A run whose turn only waits on its person's answer to a question: a restart ends it cut and asks
 * the question again by message (`askAgainByMessage`), so it never holds an update, however long
 * the person takes.
 */
const waitsOnlyOnPerson = (state: IdleState, run: IdleRun | undefined): boolean => {
  if (run?.state !== "waiting" || run.waitingOn === null) return false;
  const request = state.requests[run.waitingOn];
  return request !== undefined && isAskedAgainByMessage(request);
};

const hasAcceptedRun = (state: IdleState): boolean => {
  const { queue, runs, pausedUntil, wakes } = state;
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
  return Object.entries(runs).some(
    ([id, run]) => run.end === null && !parkedIds.has(id) && !waitsOnlyOnPerson(state, run),
  );
};

export const engineStateBlockers = (state: IdleState): ReadonlyArray<string> => {
  const blockers: string[] = [];
  const active = state.activeRunId === null ? undefined : state.runs[state.activeRunId];
  if (state.activeRunId !== null && !waitsOnlyOnPerson(state, active)) blockers.push("active run");
  if (hasAcceptedRun(state)) blockers.push("accepted run");
  // An ask on a card and a question asked by message live in the record, not in the agent's
  // turn, and a question its waiting run's restart asks again by message: an update keeps them.
  const held = Object.values(state.requests).some(
    (request) =>
      !isRecordKeptAsk(request) &&
      !(isAskedAgainByMessage(request) && waitsOnlyOnPerson(state, state.runs[request.runId])),
  );
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
