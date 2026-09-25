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
 *
 * Once a card's result has named its own appVersion or processes
 * (`AttributionInput.exact`), those ids replace the window: the frozen steps
 * and the build log then belong to exactly that operation.
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
  /**
   * The ids a settled card's result named (`ZeropsOperation.version.id`,
   * `ZeropsOperation.processIds`). When any is given they replace the
   * time + service heuristic outright: only a process carrying one of them is
   * attributed, and a read that holds none of them attributes nothing — the
   * heuristic's newest match would be a later operation on the same service.
   */
  readonly exact?: {
    readonly appVersionId?: string;
    readonly processIds?: ReadonlyArray<string>;
  };
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

/** The exact-key test when the card has one, else the time + service window. */
function matchesFor(input: AttributionInput): (process: ActivityProcess) => boolean {
  const appVersionId = input.exact?.appVersionId;
  const processIds = new Set(input.exact?.processIds);
  if (appVersionId !== undefined || processIds.size > 0) {
    return (process) =>
      processIds.has(process.id) ||
      (appVersionId !== undefined && process.appVersion?.id === appVersionId);
  }
  const serviceIds = new Set(input.serviceIds);
  const threshold = input.startedAtMs - ATTRIBUTION_LOOKBACK_MS;
  return (process) => {
    if (!process.serviceStackIds.some((id) => serviceIds.has(id))) {
      return false;
    }
    const createdAtMs = Date.parse(process.created);
    return !Number.isNaN(createdAtMs) && createdAtMs >= threshold;
  };
}

export function attributeActivity(input: AttributionInput): AttributionResult {
  if (
    input.processes.length > 0 &&
    input.processes.every((process) => process.projectId !== input.projectId)
  ) {
    return { chips: [], projectMismatch: true };
  }

  const matches = input.processes.filter(
    (process) => process.projectId === input.projectId && matchesFor(input)(process),
  );

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
