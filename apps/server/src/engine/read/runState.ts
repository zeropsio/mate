/** The turn presentation of engine evidence. The decider remains the authority for RunEnd. */
import type { Run, RunTurnState } from "@t3tools/contracts";

export const turnStateOf = (run: Pick<Run, "state" | "end">): RunTurnState => {
  if (["admitted", "sending", "running", "waiting"].includes(run.state)) return "running";
  if (run.state !== "ended") return null;
  switch (run.end?.kind) {
    case "completed":
      return "completed";
    case "stopped":
    case "cut-by-restart":
    case "usage-limit":
      return "interrupted";
    case "failed":
    case "crashed":
      return "error";
    default:
      return null;
  }
};

/** Queued messages and background jobs are not the run a Stop ends. */
export const runStatusOf = (view: {
  readonly activeRun: Pick<Run, "id"> | null;
  readonly lastEnded: Pick<Run, "end"> | null;
}): "running" | "error" | "ready" => {
  if (view.activeRun !== null) return "running";
  const end = view.lastEnded?.end;
  return end?.kind === "failed" || end?.kind === "crashed" ? "error" : "ready";
};
