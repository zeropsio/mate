/** The turn presentation of engine evidence. The decider remains the authority for RunEnd. */
import { isRefusedAttempt, type Run, type RunEnd, type RunTurnState } from "@t3tools/contracts";

/** How a run's end reads as a turn state; null only for an end kind this build does not know. */
export const turnStateOfEnd = (end: RunEnd) => {
  switch (end.kind) {
    case "completed":
      return "completed";
    case "stopped":
    case "cut-by-restart":
    case "usage-limit":
      return "interrupted";
    case "failed":
      // A refused attempt never ran: no turn of the conversation broke.
      return isRefusedAttempt(end) ? "interrupted" : "error";
    case "crashed":
      return "error";
    default:
      return null;
  }
};

export const turnStateOf = (run: Pick<Run, "state" | "end">): RunTurnState => {
  if (["admitted", "sending", "running", "waiting"].includes(run.state)) return "running";
  if (run.state !== "ended" || run.end === null) return null;
  return turnStateOfEnd(run.end);
};

/** Queued messages and background jobs are not the run a Stop ends. */
export const runStatusOf = (view: {
  readonly activeRun: Pick<Run, "id"> | null;
  readonly lastEnded: Pick<Run, "end"> | null;
}): "running" | "error" | "ready" => {
  if (view.activeRun !== null) return "running";
  const end = view.lastEnded?.end;
  return (end?.kind === "failed" && !isRefusedAttempt(end)) || end?.kind === "crashed"
    ? "error"
    : "ready";
};
