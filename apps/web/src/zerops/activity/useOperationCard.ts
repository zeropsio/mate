/**
 * The one place that maps the Observation layer onto the card's
 * presentational `ObservedRegion` prop —
 * `../../../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §3
 * "Observation", §5 (the running deploy card).
 *
 * `observationTargetFor` and `deriveObservedStepsRegion` are pure and tested
 * directly; the hook itself is thin glue, mirroring
 * `useOperationObservation.ts`'s own split — it reads the observation
 * through the hook, owns the build-log disclosure's open/closed state (the
 * one piece of state this layer needs that isn't derivable from props), and
 * attaches the `ZeropsBuildLog` node when there is a build to show one for.
 */
import { createElement, useState, type ReactElement } from "react";

import type { ObservedKind } from "@t3tools/client-runtime/zerops/activity/attribution";
import type { BuildLogQuery } from "@t3tools/client-runtime/zerops/activity/buildLog";
import type {
  Observation,
  ObservationState,
} from "@t3tools/client-runtime/zerops/activity/observe";
import type { ObservedStep } from "@t3tools/client-runtime/zerops/activity/observedSteps";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ZeropsOperation,
  ZeropsOperationKind,
  ZeropsOperationPhase,
  ZeropsOperationStep,
} from "@t3tools/client-runtime/zerops/operations";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";

import { ZeropsBuildLog } from "../../components/zerops/ZeropsBuildLog";
import type { ObservedRegion } from "../../components/zerops/ZeropsOperationCard";
import { useZeropsTopology } from "../useZeropsFeeds.ts";
import { useOperationObservation, type ObservationTarget } from "./useOperationObservation.ts";

const OBSERVED_KINDS: ReadonlySet<ZeropsOperationKind> = new Set<ZeropsOperationKind>([
  "deploy",
  "import",
  "subdomain",
  "delete",
  "scale",
  "manage",
]);

function isObservedKind(kind: ZeropsOperationKind): kind is ObservedKind {
  return OBSERVED_KINDS.has(kind);
}

/** Import may create several services at once; every other observed kind names exactly one. */
function hostnamesFor(operation: ZeropsOperation): ReadonlyArray<string> {
  if (operation.kind === "import") {
    return operation.subject.split(", ");
  }
  return operation.target === undefined ? [] : [operation.target.hostname];
}

/**
 * `null` for a kind the Observation layer has no attribution rules for
 * (bootstrap, mount, verify, env, error) — those never get a region.
 */
export function observationTargetFor(operation: ZeropsOperation): ObservationTarget | null {
  if (!isObservedKind(operation.kind)) {
    return null;
  }
  return {
    key: operation.key,
    kind: operation.kind,
    hostnames: hostnamesFor(operation),
    startedAtMs: Date.parse(operation.startedAt),
    running: operation.phase === "running",
  };
}

/**
 * The dev-server card's "Open" link, resolved from the client's own topology
 * view by hostname — never from the tool result (`reduce.ts`'s
 * `buildDevServerOperation` leaves `operation.links` empty on purpose; see
 * its doc note). `undefined` before the topology view has loaded, for any
 * other operation kind, when no service in the view matches the operation's
 * hostname, or when the matching service has no subdomain of its own.
 */
export function devServerUrlFor(
  operation: ZeropsOperation,
  topology: ZeropsTopologyView | undefined,
): string | undefined {
  if (operation.kind !== "devServer" || topology === undefined) {
    return undefined;
  }
  const hostname = operation.target?.hostname;
  if (hostname === undefined) {
    return undefined;
  }
  return topology.services.find((service) => service.hostname === hostname)?.subdomainUrl;
}

type CardStep = ZeropsOperationStep & { readonly durationMs?: number };

function toCardStep(step: ObservedStep): CardStep {
  return {
    id: step.id,
    label: step.label,
    state: step.state,
    stateLabel: step.stateLabel,
    ...(step.durationMs === undefined ? {} : { durationMs: step.durationMs }),
  };
}

function secondsAgo(readAtMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - readAtMs) / 1000));
}

export interface ObservedStepsRegion {
  readonly steps: ReadonlyArray<CardStep>;
  readonly provenance: string;
  /** Present iff the observation names a build to show a log for. */
  readonly buildLogQuery?: BuildLogQuery;
}

/**
 * Pure: `(operation phase, current state, remembered history, now) → region`.
 * A settled operation (`phase !== "running"`) always prefers its history —
 * the observed steps it last saw while running, frozen under the result's
 * verdict — over whatever the current `state` happens to compute, per the
 * concept's "the result is the verdict" rule (§3). Only while running does
 * `state` drive the region, and then only once the first read has produced
 * steps — an empty `observing` region is worse than none at all, since the
 * card already shows its own steps and elapsed clock.
 */
export function deriveObservedStepsRegion(
  phase: ZeropsOperationPhase,
  state: ObservationState,
  history: Observation | undefined,
  nowMs: number,
): ObservedStepsRegion | undefined {
  if (phase !== "running") {
    return history === undefined
      ? undefined
      : { steps: history.steps.map(toCardStep), provenance: "" };
  }

  if (state.kind === "off" || state.observation.steps.length === 0) {
    return undefined;
  }

  const provenanceLabel = state.kind === "stale" ? "last read" : "live from Zerops ·";
  return {
    steps: state.observation.steps.map(toCardStep),
    provenance: `${provenanceLabel} ${secondsAgo(state.observation.readAtMs, nowMs)} s ago`,
    ...(state.observation.buildLog === undefined
      ? {}
      : { buildLogQuery: state.observation.buildLog }),
  };
}

export interface OperationCardRegions {
  readonly observed?: ObservedRegion;
  readonly devServerUrl?: string;
}

export function useOperationCard(
  operation: ZeropsOperation,
  environmentId: EnvironmentId | null,
): OperationCardRegions {
  const target = observationTargetFor(operation);
  const { state, history, buildLog } = useOperationObservation(target, environmentId);
  const topology = useZeropsTopology(environmentId);
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);

  const devServerUrl = devServerUrlFor(operation, topology);
  const devServerUrlField = devServerUrl === undefined ? {} : { devServerUrl };

  const region = deriveObservedStepsRegion(operation.phase, state, history, Date.now());
  if (region === undefined) {
    return devServerUrlField;
  }
  if (region.buildLogQuery === undefined) {
    return {
      observed: { steps: region.steps, provenance: region.provenance },
      ...devServerUrlField,
    };
  }

  const open = manualOpen ?? buildLog.status === "live";
  const log: ReactElement = createElement(ZeropsBuildLog, {
    lines: buildLog.lines,
    onToggle: () => setManualOpen(!open),
    open,
    status: buildLog.status,
  });
  return {
    observed: { steps: region.steps, provenance: region.provenance, log },
    ...devServerUrlField,
  };
}
