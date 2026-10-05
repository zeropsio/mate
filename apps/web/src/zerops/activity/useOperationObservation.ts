/**
 * The hook a card calls for its live observation —
 * `../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §3
 * "Observation", §6. Resolves the operation's target service(s), attributes
 * the shared per-project process projection to them, and turns that into an
 * `ObservationState` plus the operation's remembered history.
 *
 * The decision logic (`deriveOperationObservation`) is a pure function of
 * its inputs, exported and tested directly — the hook itself is thin React
 * glue: it reads session/topology/activity through hooks and holds the
 * project's newest process history while the card is drawn. It remembers
 * nothing: what was read stays in the account's store, through an outage
 * too, and a card drawn again for the same operation (a row plopped from the
 * live slot, a settled row opened after a reload or in another window) reads
 * it from the store again — by the ids its result named — never from the page.
 */
import { useMemo } from "react";

import {
  type ObservedKind,
  attributeActivity,
} from "@t3tools/client-runtime/zerops/activity/attribution";
import {
  type ObservationFeed,
  type ObservationOffReason,
  type ObservationState,
  observe,
  operationReadCeilingMs,
} from "@t3tools/client-runtime/zerops/activity/observe";
import type { BuildLogQuery } from "@t3tools/client-runtime/zerops/activity/buildLog";
import type { AttributionInput } from "@t3tools/client-runtime/zerops/activity/attribution";
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
  /** A batch deploy: its card follows the service the platform says is building. */
  readonly batch?: boolean;
}

/**
 * What a settled operation's card has read of it: the project's newest process history is still
 * on its way, read, or refused — then it says so, and nothing reads it again by itself.
 */
export type SettledRead = "pending" | "read" | "failed";

export interface OperationObservation {
  readonly state: ObservationState;
  readonly buildLog: ReturnType<typeof useBuildLog>;
  /** A settled one's: what was read of it — `failed` says so. */
  readonly settledRead: SettledRead;
}

/**
 * `ProjectActivitySnapshot.unavailableReason` uses the store's access vocabulary, not an
 * `ObservationOffReason`: map it explicitly rather than casting.
 */
function mapActivityUnavailableReason(
  reason: ProjectActivitySnapshot["unavailableReason"],
): ObservationOffReason | undefined {
  switch (reason) {
    case undefined:
      return undefined;
    case "expired-session":
    case "forbidden":
      return "unauthorized";
    default:
      return "feed-error";
  }
}

/** The feed as the store says it stands: live, first connecting, or catching up. */
function feedOf(snapshot: ProjectActivitySnapshot): ObservationFeed {
  if (snapshot.live) return "live";
  return snapshot.reconnecting === true ? "catching-up" : "connecting";
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
  readonly ceilingMs?: number;
}

export interface DeriveOperationObservationResult {
  readonly state: ObservationState;
  readonly settledRead: SettledRead;
  /** The build whose log the card shows. */
  readonly buildLogQuery?: BuildLogQuery;
}

/**
 * Pure: `(input, nowMs) → result`. Attributes what the store holds of the
 * project to the operation and computes its observation state from the
 * feed's own phase; the clock only bounds an operation known by its service
 * and start (its ceiling) and counts its elapsed time.
 */
export function deriveOperationObservation(
  input: DeriveOperationObservationInput,
  nowMs: number,
): DeriveOperationObservationResult {
  const { target, snapshot } = input;
  if (target === null) {
    return { state: { kind: "off", reason: "no-target" }, settledRead: "pending" };
  }

  let unavailableReason = mapActivityUnavailableReason(snapshot.unavailableReason);
  let attribution: Parameters<typeof observe>[0]["attribution"];
  if (input.attributable && input.projectId !== undefined && snapshot.processes !== undefined) {
    const attributed = attributeActivity({
      processes: snapshot.processes,
      projectId: input.projectId,
      serviceIds: input.serviceIds,
      startedAtMs: target.startedAtMs,
      kind: target.kind,
      ...(target.exact === undefined ? {} : { exact: target.exact }),
      ...(target.batch === true ? { batch: true } : {}),
    });
    if (attributed.projectMismatch) unavailableReason = "project-mismatch";
    else if (attributed.stepSource !== undefined || attributed.chips.length > 0)
      attribution = attributed;
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
      feed: feedOf(snapshot),
      ...(resolvedUnavailableReason === undefined
        ? {}
        : { unavailableReason: resolvedUnavailableReason }),
      ...(attribution === undefined ? {} : { attribution }),
    },
    nowMs,
  );
  const settledRead: SettledRead =
    input.attributable && unavailableReason !== undefined
      ? "failed"
      : snapshot.processHistory === "failed"
        ? "failed"
        : snapshot.processHistory === "read"
          ? "read"
          : "pending";
  const buildLogQuery = state.kind === "off" ? undefined : state.observation.buildLog;
  return {
    state,
    settledRead,
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
 * `nowMs` is the card's render clock (`useSecondsNowMs`): a running step's
 * duration counts on against it between pushes.
 */
export function useOperationObservation(
  target: ObservationTarget | null,
  environmentId: EnvironmentId | null,
  nowMs: number,
  /** Whether its build's log is read: not for a line that stands closed. */
  readsLog = true,
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

  // The project's newest history is held while the card is drawn: a settled
  // operation's process may have ended before this tab ever saw it run.
  const readsProject = target === null ? null : (projectId ?? null);
  useProjectActivityDemand(readsProject);
  const snapshot = useProjectActivityRead(readsProject);

  const result = deriveOperationObservation(
    {
      target,
      attributable,
      notAttributableReason: signedIn ? "no-target" : "no-session",
      serviceIds,
      projectId,
      snapshot,
    },
    nowMs,
  );

  const observationNow = result.state.kind === "off" ? undefined : result.state.observation;
  const buildLog = useBuildLog({
    projectId: projectId ?? null,
    query: readsLog ? (result.buildLogQuery ?? null) : null,
    live: target !== null && target.running && observationNow?.outcome === undefined,
  });

  return { state: result.state, buildLog, settledRead: result.settledRead };
}
