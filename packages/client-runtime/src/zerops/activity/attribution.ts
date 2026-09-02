/**
 * Which processes on a project's live activity read belong to one pending
 * `zerops_deploy` call — `../plans/mate-live-activity-2026-09-02.md` §3.
 *
 * A process is attributed iff it names the target service, belongs to the
 * right project, and was created no more than 5s before the tool call
 * started. Among the attributed processes, the newest whose action is a
 * deploy/build drives the pipeline steps; every other attributed process
 * (an older deploy/build, or a different action like a subdomain toggle or a
 * restart) is a secondary chip, never a step source.
 */
import type { ActivityProcess } from "./dto.ts";

/** §3.4 — the only actions a step source may come from. */
export const DEPLOY_ACTION_ALLOWLIST: ReadonlySet<string> = new Set([
  "stack.deploy",
  "stack.build",
]);

/** §3.3 — a process created before this window is "other activity", not attributed. */
const ATTRIBUTION_LOOKBACK_MS = 5_000;

export interface AttributionInput {
  readonly processes: ReadonlyArray<ActivityProcess>;
  readonly projectId: string;
  readonly targetServiceId: string;
  /** Server-stamped tool-call start time, in epoch ms — never the browser clock. */
  readonly toolStartedAtMs: number;
}

export interface AttributionResult {
  /** The newest attributed deploy/build process; drives the pipeline steps. */
  readonly stepSource?: ActivityProcess;
  /** Every other attributed process — older deploy/build calls and secondary actions. */
  readonly chips: ReadonlyArray<ActivityProcess>;
}

const EMPTY: AttributionResult = { chips: [] };

export function attributeActivity(input: AttributionInput): AttributionResult {
  const threshold = input.toolStartedAtMs - ATTRIBUTION_LOOKBACK_MS;
  const matches = input.processes.filter((process) => {
    if (process.projectId !== input.projectId) {
      return false;
    }
    if (!process.serviceStackIds.includes(input.targetServiceId)) {
      return false;
    }
    const createdAtMs = Date.parse(process.created);
    return !Number.isNaN(createdAtMs) && createdAtMs >= threshold;
  });

  if (matches.length === 0) {
    return EMPTY;
  }

  const deployish = matches
    .filter((process) => DEPLOY_ACTION_ALLOWLIST.has(process.actionName))
    .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));

  const stepSource = deployish[0];
  const chips = matches.filter((process) => process !== stepSource);

  return { ...(stepSource === undefined ? {} : { stepSource }), chips };
}
