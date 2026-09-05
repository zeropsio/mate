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
import { createElement, useRef, useState, type ReactElement } from "react";

import type { ObservedKind } from "@t3tools/client-runtime/zerops/activity/attribution";
import type { BuildLogQuery } from "@t3tools/client-runtime/zerops/activity/buildLog";
import type {
  Observation,
  ObservationState,
} from "@t3tools/client-runtime/zerops/activity/observe";
import type { ObservedStep } from "@t3tools/client-runtime/zerops/activity/observedSteps";
import { frameImageSrc } from "@t3tools/client-runtime/zerops/browserStream";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ZeropsOperation,
  ZeropsOperationKind,
  ZeropsOperationPhase,
  ZeropsOperationStep,
} from "@t3tools/client-runtime/zerops/model";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";

import { ZeropsBuildLog } from "../../components/zerops/ZeropsBuildLog";
import type {
  BrowserScreenshot,
  LiveBrowserFrame,
  ObservedRegion,
} from "../../components/zerops/ZeropsOperationCard";
import { useZeropsBrowserStream, useZeropsTopology } from "../useZeropsFeeds.ts";
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
    startedAtMs: Date.parse(operation.anchorAt),
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

/** `operation.kind === "browser"` only, resolved from the operation's own `screenshot` field — see `reduce.ts`'s `buildBrowserOperation`. */
export function browserScreenshotFor(operation: ZeropsOperation): BrowserScreenshot | undefined {
  return operation.kind === "browser" ? operation.screenshot : undefined;
}

/**
 * True exactly while THIS operation's own `zerops_browser` call is still
 * running — the card's live-viewport gate. An operation carries its own
 * `phase`, so this needs nothing from the thread's lifecycle feed: at most
 * one browser call is ever `running` in a thread at a time, which is what
 * keeps the feed subscription below to one per thread.
 */
export function isBrowserOperationLive(operation: ZeropsOperation): boolean {
  return operation.kind === "browser" && operation.phase === "running";
}

interface RememberedFrame {
  readonly key: string;
  readonly frame: LiveBrowserFrame | undefined;
}

/**
 * The browser card's live viewport: subscribes to the S8b feed
 * (`useZeropsBrowserStream`) only while `isBrowserOperationLive` — feeding
 * it `null` otherwise short-circuits to no subscription
 * (`useZeropsBrowserStream`'s own `EMPTY_ATOM` path), so a thread with many
 * completed browser cards never opens more than the one feed its
 * currently-running call needs. The last frame is remembered across the
 * running→done transition (a completed call without its own screenshot
 * still shows something) and reset whenever `operation.key` changes, so a
 * NEW browser card never inherits a stale frame from an old one.
 */
function useLiveBrowserFrame(
  operation: ZeropsOperation,
  environmentId: EnvironmentId | null,
): { readonly live: boolean; readonly liveFrame?: LiveBrowserFrame } {
  const live = isBrowserOperationLive(operation);
  const read = useZeropsBrowserStream(live ? environmentId : null);
  const rememberedRef = useRef<RememberedFrame>({ key: operation.key, frame: undefined });
  if (rememberedRef.current.key !== operation.key) {
    rememberedRef.current = { key: operation.key, frame: undefined };
  }
  const frame = read !== undefined && read !== "unavailable" ? read.frame : undefined;
  if (frame !== undefined) {
    rememberedRef.current = {
      key: operation.key,
      frame: { src: frameImageSrc(frame), width: frame.width, height: frame.height },
    };
  }
  return {
    live,
    ...(rememberedRef.current.frame === undefined
      ? {}
      : { liveFrame: rememberedRef.current.frame }),
  };
}

export interface OperationCardRegions {
  readonly observed?: ObservedRegion;
  readonly devServerUrl?: string;
  readonly browserScreenshot?: BrowserScreenshot;
  /** `browser` only: the call is currently in progress. */
  readonly live?: boolean;
  /** `browser` only: the latest live frame, kept across the running→done transition. */
  readonly liveFrame?: LiveBrowserFrame;
}

export function useOperationCard(
  operation: ZeropsOperation,
  environmentId: EnvironmentId | null,
): OperationCardRegions {
  const target = observationTargetFor(operation);
  const { state, history, buildLog } = useOperationObservation(target, environmentId);
  const topology = useZeropsTopology(environmentId);
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const { live, liveFrame } = useLiveBrowserFrame(operation, environmentId);

  const devServerUrl = devServerUrlFor(operation, topology);
  const devServerUrlField = devServerUrl === undefined ? {} : { devServerUrl };
  const browserScreenshot = browserScreenshotFor(operation);
  const browserScreenshotField = browserScreenshot === undefined ? {} : { browserScreenshot };
  const liveField =
    operation.kind === "browser" ? { live, ...(liveFrame === undefined ? {} : { liveFrame }) } : {};

  const region = deriveObservedStepsRegion(operation.phase, state, history, Date.now());
  if (region === undefined) {
    return { ...devServerUrlField, ...browserScreenshotField, ...liveField };
  }
  if (region.buildLogQuery === undefined) {
    return {
      observed: { steps: region.steps, provenance: region.provenance },
      ...devServerUrlField,
      ...browserScreenshotField,
      ...liveField,
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
    ...browserScreenshotField,
    ...liveField,
  };
}
