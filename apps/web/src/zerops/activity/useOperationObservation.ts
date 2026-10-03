/**
 * The hook a card calls for its live observation —
 * `../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §3
 * "Observation", §6. Resolves the operation's target service(s), attributes
 * the shared per-project process projection to them, and turns that into an
 * `ObservationState` plus the operation's remembered history.
 *
 * The decision logic (`deriveOperationObservation`) is a pure function of
 * its inputs, exported and tested directly — the hook itself is thin React
 * glue: it reads session/topology/activity through hooks, keeps its
 * cross-render observation memory inside the mounted card, and asks the
 * account store to read the operation only while the decision says so. A card
 * drawn again for the same operation (a row plopped from the live slot, a
 * settled row opened after a reload or in another window) reads it from the
 * store again — by the ids its result named — never from the page.
 */
import { useMemo, useRef } from "react";

import {
  type AttributionInput,
  type AttributionResult,
  type ObservedKind,
  attributeActivity,
} from "@t3tools/client-runtime/zerops/activity/attribution";
import {
  type Observation,
  type ObservationOffReason,
  type ObservationState,
  observe,
  operationReadCeilingMs,
  readsOperation,
} from "@t3tools/client-runtime/zerops/activity/observe";
import type { BuildLogQuery } from "@t3tools/client-runtime/zerops/activity/buildLog";
import type { EnvironmentId } from "@t3tools/contracts";

import { useZeropsSessionOptional } from "../ZeropsSessionProvider";
import { useZeropsTopology } from "../useZeropsFeeds";
import type { ProjectActivitySnapshot } from "./useProjectActivity.ts";
import { useBuildLog } from "./useBuildLog.ts";
import { useProjectActivityDemand, useProjectActivityRead } from "./useProjectActivity.ts";

export const OPERATION_OBSERVATION_CEILING_MS = 30 * 60 * 1000;

export interface ObservationTarget {
  /** The operation key, stable for the card's life. */
  readonly key: string;
  readonly kind: ObservedKind;
  readonly hostnames: ReadonlyArray<string>;
  readonly startedAtMs: number;
  /** Operation phase === "running" — a BUILD_TRIGGERED result is still running. */
  readonly running: boolean;
  /** The ids the result named (`AttributionInput.exact`) — present once it named any. */
  readonly exact?: AttributionInput["exact"];
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
  /** The build whose log the card shows: the current read's, else the remembered one's — so a log once shown never leaves. */
  readonly buildLogQuery?: BuildLogQuery;
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
      ...(target.exact === undefined ? {} : { exact: target.exact }),
    });
    if (attribution.projectMismatch) {
      unavailableReason = "project-mismatch";
    } else if (attribution.stepSource !== undefined || attribution.chips.length > 0) {
      // A successful observation that attributes nothing new for this target
      // (`processes` is `[]`, not `undefined`, once the runtime has established
      // the query) must not refresh the staleness clock; only a read that
      // actually found something for this target counts as fresh knowledge.
      // A live feed pushes every change, so what it holds is current now; one
      // that is not observing is as old as the later of its newest record and
      // the last moment it was seen live.
      const atMs = input.snapshot.live
        ? nowMs
        : Math.max(input.snapshot.atMs, lastRead?.atMs ?? Number.NEGATIVE_INFINITY);
      lastRead = { attribution, atMs };
    }
  }

  const ceilingMs = operationReadCeilingMs(
    { running: target.running, exact: target.exact !== undefined },
    input.ceilingMs ?? OPERATION_OBSERVATION_CEILING_MS,
  );
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
  const history = observationNow?.pipeline !== undefined ? observationNow : input.previousHistory;

  // `state.kind === "off"` covers every stop condition but the outcome —
  // not attributable, the ceiling, and any feed problem the activity feed or
  // attribution itself reports (including a project mismatch: no process for
  // the right project is ever going to arrive from a read that is not even
  // reading that project). Its call settling is none: it reads on until the
  // outcome is read (`readsOperation`).
  const wantsPoll = readsOperation(state);
  const buildLogQuery = observationNow?.buildLog ?? history?.buildLog;

  return {
    state,
    lastRead,
    history,
    wantsPoll,
    ...(buildLogQuery === undefined ? {} : { buildLogQuery }),
  };
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

/**
 * `nowMs` is the card's render clock (`useSecondsNowMs`): a live feed's
 * observation is current as of it, and a silent one ages against it.
 */
export function useOperationObservation(
  target: ObservationTarget | null,
  environmentId: EnvironmentId | null,
  nowMs: number,
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
  if (target === null || target.key !== keyRef.current) {
    keyRef.current = target?.key ?? null;
    lastReadRef.current = undefined;
    historyRef.current = undefined;
  }

  // What the account store holds of the project is read at once, whoever
  // asked it to read: a settled operation it holds draws on its first paint.
  const snapshot = useProjectActivityRead(target === null ? null : (projectId ?? null));

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
    nowMs,
  );

  lastReadRef.current = result.lastRead;
  historyRef.current = result.history;
  // The single source of truth for "should the store read it" is the
  // decision's own `wantsPoll`, from this render's snapshot.
  useProjectActivityDemand(result.wantsPoll ? (projectId ?? null) : null);

  const observationNow = result.state.kind === "off" ? undefined : result.state.observation;
  const buildLog = useBuildLog({
    projectId: projectId ?? null,
    query: result.buildLogQuery ?? null,
    live: target !== null && target.running && observationNow?.outcome === undefined,
  });

  return { state: result.state, history: result.history, buildLog };
}
