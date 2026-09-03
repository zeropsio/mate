/**
 * Which processes on a project's live activity read belong to one operation
 * (deploy, import, subdomain toggle, delete, scale, manage) —
 * `../plans/mate-live-activity-2026-09-02.md` §3,
 * `../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §3
 * "Observation".
 *
 * A process is attributed iff it names one of the target services, belongs
 * to the right project, and was created no more than 5s before the
 * operation started. Among the attributed processes, the newest whose
 * action belongs to the operation kind's action set drives the pipeline
 * steps; every other attributed process (an older matching action, or a
 * different action within the same window, e.g. a subdomain toggle beside a
 * deploy) is a secondary chip, never a step source.
 */
import type { ActivityProcess } from "./dto.ts";

export type ObservedKind = "deploy" | "import" | "subdomain" | "delete" | "scale" | "manage";

/** The processActionName values that can drive the step source for each operation kind. */
const ACTION_SETS: Record<ObservedKind, ReadonlySet<string>> = {
  deploy: new Set(["stack.deploy", "stack.build"]),
  import: new Set(["stack.create", "stack.deploy", "stack.build", "stack.enableSubdomainAccess"]),
  subdomain: new Set(["stack.enableSubdomainAccess", "stack.disableSubdomainAccess"]),
  delete: new Set(["stack.delete"]),
  scale: new Set(["stack.scale", "stack.updateUserData"]),
  manage: new Set(["stack.start", "stack.stop", "stack.restart", "stack.reload"]),
};

/** A process created before this window is "other activity", not attributed. */
const ATTRIBUTION_LOOKBACK_MS = 5_000;

export interface AttributionInput {
  readonly processes: ReadonlyArray<ActivityProcess>;
  readonly projectId: string;
  /** May name several services — an import creates several at once. */
  readonly serviceIds: ReadonlyArray<string>;
  /** Server-stamped operation start time, in epoch ms — never the browser clock. */
  readonly startedAtMs: number;
  readonly kind: ObservedKind;
}

export interface AttributionResult {
  /** The newest attributed process whose action matches `kind`; drives the pipeline steps. */
  readonly stepSource?: ActivityProcess;
  /** Every other attributed process — older matching actions and secondary actions. */
  readonly chips: ReadonlyArray<ActivityProcess>;
  /**
   * §3.2: the read came back with processes, but NONE belong to
   * `input.projectId` — wrong API host or wrong project entirely. The caller
   * must switch the overlay off for this project, not sit in `searching`
   * until the 30-minute ceiling: no process for the right project is ever
   * going to arrive from a read that is not even reading that project.
   */
  readonly projectMismatch: boolean;
}

const EMPTY: AttributionResult = { chips: [], projectMismatch: false };

export function attributeActivity(input: AttributionInput): AttributionResult {
  if (
    input.processes.length > 0 &&
    input.processes.every((process) => process.projectId !== input.projectId)
  ) {
    return { chips: [], projectMismatch: true };
  }

  const serviceIds = new Set(input.serviceIds);
  const threshold = input.startedAtMs - ATTRIBUTION_LOOKBACK_MS;
  const matches = input.processes.filter((process) => {
    if (process.projectId !== input.projectId) {
      return false;
    }
    if (!process.serviceStackIds.some((id) => serviceIds.has(id))) {
      return false;
    }
    const createdAtMs = Date.parse(process.created);
    return !Number.isNaN(createdAtMs) && createdAtMs >= threshold;
  });

  if (matches.length === 0) {
    return EMPTY;
  }

  const actionSet = ACTION_SETS[input.kind];
  const stepCandidates = matches
    .filter((process) => actionSet.has(process.actionName))
    .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));

  const stepSource = stepCandidates[0];
  const chips = matches.filter((process) => process !== stepSource);

  return { ...(stepSource === undefined ? {} : { stepSource }), chips, projectMismatch: false };
}
