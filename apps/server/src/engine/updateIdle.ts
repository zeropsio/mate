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
 * The conversation's active run only waits on its person's answer to a question: the restart's
 * recovery, which takes the active run alone, ends it cut by the restart and asks its questions
 * again by message (`recovered`, `endRun`), so it never holds an update, however long the person
 * takes. The update's idle close leaves its session to that restart, where the close would end
 * the run as a crash; an update called off after the close leaves the run waiting as it was.
 */
export const leftToRestart = (
  state: Pick<IdleState, "activeRunId" | "runs" | "requests">,
): boolean => {
  const run = state.activeRunId === null ? undefined : state.runs[state.activeRunId];
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
  if (state.activeRunId !== null && leftToRestart(state)) parkedIds.add(state.activeRunId);
  return Object.entries(runs).some(([id, run]) => run.end === null && !parkedIds.has(id));
};

export const engineStateBlockers = (state: IdleState): ReadonlyArray<string> => {
  const blockers: string[] = [];
  const left = leftToRestart(state);
  if (state.activeRunId !== null && !left) blockers.push("active run");
  if (hasAcceptedRun(state)) blockers.push("accepted run");
  // An ask on a card and a question asked by message live in the record, not in the agent's
  // turn, and the restart asks every question of the run it is left again by message (`endRun`):
  // an update keeps them.
  const held = Object.values(state.requests).some(
    (request) =>
      !isRecordKeptAsk(request) &&
      !(left && request.runId === state.activeRunId && isAskedAgainByMessage(request)),
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
