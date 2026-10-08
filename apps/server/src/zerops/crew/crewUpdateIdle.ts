import type { CrewOperation, CrewRunState, CrewTaskState } from "@t3tools/contracts";

/** Durable crew work and requests remain work between native turns. */
export const crewUpdateBlockers = (input: {
  readonly active: number;
  readonly run: CrewRunState | undefined;
  readonly tasks: ReadonlyArray<{ readonly state: CrewTaskState }>;
  readonly operations: ReadonlyArray<Pick<CrewOperation, "status">>;
}): ReadonlyArray<string> => {
  const blockers: string[] = [];
  if (input.active > 0) blockers.push("crew process or callback");
  if (input.run === "running" || input.run === "finishing") blockers.push("active crew run");
  const work = new Set<CrewTaskState>([
    "queued",
    "working",
    "rework",
    "merging",
    "checking",
    "landing",
  ]);
  const request = new Set<CrewTaskState>(["blocked", "review", "waiting-on-you", "proposed"]);
  if (input.tasks.some((task) => work.has(task.state))) blockers.push("accepted crew task");
  if (input.tasks.some((task) => request.has(task.state))) blockers.push("open crew request");
  if (input.operations.some((operation) => operation.status === "running"))
    blockers.push("crew operation running");
  return blockers;
};
