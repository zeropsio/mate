/**
 * The hook a card calls for its live observation —
 * `../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §3
 * "Observation", §6. Resolves the operation's target service(s), attributes
 * the shared per-project process projection to them, and turns that into an
 * `ObservationState` plus the operation's remembered history.
 *
 * The decision logic (`deriveOperationObservation`) is a pure function of
 * its inputs, exported and tested directly — the hook itself is thin React
 * glue: it reads session/topology/activity through hooks and keeps its
 * cross-render observation memory inside the mounted card.
 */
import { useMemo, useRef } from "react";

import {
  type AttributionResult,
  type ObservedKind,
  attributeActivity,
} from "@t3tools/client-runtime/zerops/activity/attribution";
import {
  type Observation,
  type ObservationOffReason,
  type ObservationState,
  observe,
} from "@t3tools/client-runtime/zerops/activity/observe";
import type { EnvironmentId } from "@t3tools/contracts";

import { useZeropsSessionOptional } from "../ZeropsSessionProvider";
import { useZeropsTopology } from "../useZeropsFeeds";
import type { ProjectActivitySnapshot } from "./useProjectActivity.ts";
import { useBuildLog } from "./useBuildLog.ts";
import { useProjectActivity } from "./useProjectActivity.ts";

export const OPERATION_OBSERVATION_CEILING_MS = 30 * 60 * 1000;

export interface ObservationTarget {
  /** The operation key, stable for the card's life. */
  readonly key: string;
  readonly kind: ObservedKind;
  readonly hostnames: ReadonlyArray<string>;
  readonly startedAtMs: number;
  /** Operation phase === "running" — a BUILD_TRIGGERED result is still running. */
  readonly running: boolean;
}

export interface OperationObservation {
  readonly state: ObservationState;
  /** The last good observation, kept after `running` turns false. */
  readonly history: Observation | undefined;
  readonly buildLog: ReturnType<typeof useBuildLog>;
}

type LastRead = { readonly attribution: AttributionResult; readonly atMs: number };

/**
 * `ProjectActivitySnapshot.unavailableReason` carries a `ZeropsApiErrorKind`
 * uses transport/access vocabulary, not an `ObservationOffReason`.
 * The two happen to share the string `"not-found"`, but that is a
 * coincidence, not a contract — map explicitly rather than casting.
 */
function mapActivityUnavailableReason(
  reason: string | undefined,
): ObservationOffReason | undefined {
  switch (reason) {
    case undefined:
      return undefined;
    case "expired-session":
    case "forbidden":
      return "unauthorized";
    case "not-found":
      return "not-found";
    default:
      return "feed-error";
  }
}

export interface DeriveOperationObservationInput {
  readonly target: ObservationTarget | null;
  /** Session + target service id(s) resolved. */
  readonly attributable: boolean;
  /** Which `off` reason applies when `attributable` is false. */
  readonly notAttributableReason: "no-session" | "no-target";
  readonly serviceIds: ReadonlyArray<string>;
  readonly projectId: string | undefined;
  readonly snapshot: ProjectActivitySnapshot;
  readonly previousLastRead: LastRead | undefined;
  readonly previousHistory: Observation | undefined;
  readonly ceilingMs?: number;
}

export interface DeriveOperationObservationResult {
  readonly state: ObservationState;
  readonly lastRead: LastRead | undefined;
  readonly history: Observation | undefined;
  readonly wantsPoll: boolean;
}

/**
 * Pure: `(input, nowMs) → result`. Folds a fresh snapshot (when one is
 * present) into an attribution read, computes the observation state, keeps
 * `history` sticky (the last observation with non-empty steps, carried
 * forward otherwise), and decides whether the caller should keep activity demand —
 * `running`, not past the ceiling, and the pipeline outcome not yet settled.
 */
export function deriveOperationObservation(
  input: DeriveOperationObservationInput,
  nowMs: number,
): DeriveOperationObservationResult {
  const { target } = input;
  if (target === null) {
    return {
      state: { kind: "off", reason: "no-target" },
      lastRead: undefined,
      history: input.previousHistory,
      wantsPoll: false,
    };
  }

  let lastRead = input.previousLastRead;
  let unavailableReason = mapActivityUnavailableReason(input.snapshot.unavailableReason);

  if (
    input.attributable &&
    input.projectId !== undefined &&
    input.snapshot.processes !== undefined &&
    input.snapshot.atMs !== undefined
  ) {
    const attribution = attributeActivity({
      processes: input.snapshot.processes,
      projectId: input.projectId,
      serviceIds: input.serviceIds,
      startedAtMs: target.startedAtMs,
      kind: target.kind,
    });
    if (attribution.projectMismatch) {
      unavailableReason = "project-mismatch";
    } else if (attribution.stepSource !== undefined || attribution.chips.length > 0) {
      // A successful observation that attributes nothing new for this target
      // (`processes` is `[]`, not `undefined`, once the runtime has established
      // the query) must not refresh the staleness clock; only a read that
      // actually found something for this target counts as fresh knowledge.
      lastRead = { attribution, atMs: input.snapshot.atMs };
    }
  }

  const ceilingMs = input.ceilingMs ?? OPERATION_OBSERVATION_CEILING_MS;
  const resolvedUnavailableReason = input.attributable
    ? unavailableReason
    : input.notAttributableReason;
  const state = observe(
    {
      attributable: input.attributable,
      startedAtMs: target.startedAtMs,
      ceilingMs,
      ...(resolvedUnavailableReason === undefined
        ? {}
        : { unavailableReason: resolvedUnavailableReason }),
      ...(lastRead === undefined ? {} : { lastRead }),
    },
    nowMs,
  );

  const observationNow = state.kind === "off" ? undefined : state.observation;
  const history =
    observationNow !== undefined && observationNow.steps.length > 0
      ? observationNow
      : input.previousHistory;

  // `state.kind === "off"` already covers every stop condition but
  // `running`/outcome — not attributable, the ceiling, and any feed
  // problem the activity feed or attribution itself reports (including a
  // project mismatch: no process for the right project is ever going to
  // arrive from a read that is not even reading that project).
  const outcomeSettled = observationNow?.outcome !== undefined;
  const wantsPoll = target.running && state.kind !== "off" && !outcomeSettled;

  return { state, lastRead, history, wantsPoll };
}

function serviceIdsFor(
  target: ObservationTarget | null,
  services: ReadonlyArray<{ readonly hostname: string; readonly serviceId: string }> | undefined,
): ReadonlyArray<string> {
  if (target === null) {
    return [];
  }
  const ids = new Set<string>();
  for (const hostname of target.hostnames) {
    const id = services?.find((service) => service.hostname === hostname)?.serviceId;
    if (id !== undefined) {
      ids.add(id);
    }
  }
  return [...ids];
}

export function useOperationObservation(
  target: ObservationTarget | null,
  environmentId: EnvironmentId | null,
): OperationObservation {
  const session = useZeropsSessionOptional();
  const topology = useZeropsTopology(environmentId);

  const serviceIds = useMemo(() => serviceIdsFor(target, topology?.services), [target, topology]);

  const projectId = topology?.project.id;
  const signedIn = session !== null && session.status === "signed-in";
  const attributable =
    signedIn &&
    topology !== undefined &&
    target !== null &&
    serviceIds.length > 0 &&
    projectId !== undefined;

  const keyRef = useRef<string | null>(null);
  const lastReadRef = useRef<LastRead | undefined>(undefined);
  const historyRef = useRef<Observation | undefined>(undefined);
  // The single source of truth for "should we retain activity demand" is
  // `deriveOperationObservation`'s own `wantsPoll` — reused here as the
  // guess driving *this* render's `useProjectActivity` lease
  // (necessarily one render behind its own verdict, since that verdict is
  // computed from this render's snapshot) rather than a second,
  // independently re-derived formula that can drift out of sync with it,
  // as it once did for `project-mismatch`.
  const wantsPollRef = useRef(target !== null && target.running);
  if (target === null || target.key !== keyRef.current) {
    keyRef.current = target?.key ?? null;
    lastReadRef.current = undefined;
    historyRef.current = undefined;
    wantsPollRef.current = target !== null && target.running;
  }

  const snapshot = useProjectActivity(
    wantsPollRef.current && projectId !== undefined ? projectId : null,
  );

  const previousHistory = historyRef.current;

  const result = deriveOperationObservation(
    {
      target,
      attributable,
      notAttributableReason: signedIn ? "no-target" : "no-session",
      serviceIds,
      projectId,
      snapshot,
      previousLastRead: lastReadRef.current,
      previousHistory,
    },
    Date.now(),
  );

  lastReadRef.current = result.lastRead;
  wantsPollRef.current = result.wantsPoll;
  historyRef.current = result.history;

  const observationNow = result.state.kind === "off" ? undefined : result.state.observation;
  const buildLog = useBuildLog({
    projectId: projectId ?? null,
    query: observationNow?.buildLog ?? null,
    live: target !== null && target.running && observationNow?.outcome === undefined,
  });

  return { state: result.state, history: result.history, buildLog };
}
