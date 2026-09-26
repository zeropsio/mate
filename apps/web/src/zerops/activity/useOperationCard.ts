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
import {
  type ObservedStep,
  observedProcessStep,
  observedSteps,
  pipelineStepSlots,
} from "@t3tools/client-runtime/zerops/activity/observedSteps";
import { formatDuration } from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
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
import { browserPageUrl } from "../../components/zerops/operation/subject";
import type {
  BrowserScreenshot,
  LiveBrowserFrame,
  ObservedRegion,
} from "../../components/zerops/ZeropsOperationCard";
import { useSecondsNowMs } from "../useNowMs.ts";
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
 * (bootstrap, mount, verify, env, error) — those never get a region — and
 * for a batch deploy, whose per-target rows are its steps from birth to
 * settle.
 */
export function observationTargetFor(operation: ZeropsOperation): ObservationTarget | null {
  if (!isObservedKind(operation.kind) || operation.batch === true) {
    return null;
  }
  const appVersionId = operation.version?.id;
  const processIds = operation.processIds ?? [];
  return {
    key: operation.key,
    kind: operation.kind,
    hostnames: hostnamesFor(operation),
    startedAtMs: Date.parse(operation.anchorAt),
    running: operation.phase === "running",
    ...(appVersionId === undefined && processIds.length === 0
      ? {}
      : {
          exact: {
            ...(appVersionId === undefined ? {} : { appVersionId }),
            ...(processIds.length === 0 ? {} : { processIds }),
          },
        }),
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

/**
 * A browser check's subject chip: the hostname of the service one of whose
 * public routes answers the page's host — `undefined` before the URL or the
 * topology view arrives, for a host no service answers (the card then names
 * the URL's own host), and for any other kind.
 */
export function browserSubjectHostFor(
  operation: ZeropsOperation,
  topology: ZeropsTopologyView | undefined,
): string | undefined {
  const url = browserPageUrl(operation);
  if (url === undefined || topology === undefined) {
    return undefined;
  }
  return topology.services.find((service) =>
    service.routes.some((route) => URL.canParse(route.url) && new URL(route.url).host === url.host),
  )?.hostname;
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

export interface ObservedStepsRegion {
  readonly steps: ReadonlyArray<CardStep>;
  /** The observation's secondary processes, one compact row each. */
  readonly chips: ReadonlyArray<CardStep>;
  /** Empty while the feed observes; one quiet line once it is not answering. */
  readonly provenance: string;
  /** Present iff the observation names a build to show a log for. */
  readonly buildLogQuery?: BuildLogQuery;
}

/** The feed has gone silent, or failed — not a card that stopped looking (the ceiling, a settled result). */
function feedNotObserving(state: ObservationState): boolean {
  return (
    state.kind === "stale" ||
    (state.kind === "off" && (state.reason === "stale-timeout" || state.reason === "feed-error"))
  );
}

/** Nothing while the feed observes: a live card needs no word that it is live. */
function provenanceFor(state: ObservationState, source: Observation, nowMs: number): string {
  if (!feedNotObserving(state)) {
    return "";
  }
  const age = formatDuration(nowMs - source.readAtMs);
  return age === undefined
    ? "Zerops isn't answering"
    : `Zerops isn't answering · last update ${age} ago`;
}

/**
 * Pure: `(operation kind, phase, current state, remembered history, now) → region`.
 * A settled operation (`phase !== "running"`) always prefers its history —
 * the steps it last saw while running, kept under the result's verdict with
 * its build log in place — over whatever the current `state` happens to
 * compute, per the concept's "the result is the verdict" rule (§3). While
 * running, `state` drives the region once a read has produced a pipeline or
 * secondary processes; until then — and whenever the feed goes quiet or off
 * — the history holds what was already shown (steps, secondary processes,
 * build log), so nothing once on the card leaves it. The steps are read off
 * the pipeline against `nowMs`, the render clock, so a running step counts on
 * between reads. A deploy's observed steps fill the same five pipeline slots
 * (`pipelineStepSlots`) the operation itself holds from birth to settle, so
 * they fill in place instead of appearing.
 */
export function deriveObservedStepsRegion(
  kind: ZeropsOperationKind,
  phase: ZeropsOperationPhase,
  state: ObservationState,
  history: Observation | undefined,
  nowMs: number,
): ObservedStepsRegion | undefined {
  const regionOf = (observation: Observation, provenance: string): ObservedStepsRegion => {
    const steps =
      observation.pipeline === undefined
        ? []
        : observedSteps(observation.pipeline.appVersion, nowMs);
    return {
      steps: (kind === "deploy" ? pipelineStepSlots(steps) : steps).map(toCardStep),
      chips: observation.chips.map(observedProcessStep),
      provenance,
      ...(observation.buildLog === undefined ? {} : { buildLogQuery: observation.buildLog }),
    };
  };

  if (phase !== "running") {
    return history === undefined ? undefined : regionOf(history, "");
  }

  const current =
    state.kind === "off" ||
    (state.observation.pipeline === undefined && state.observation.chips.length === 0)
      ? undefined
      : state.observation;
  const source = current ?? history;
  if (source === undefined) {
    return undefined;
  }
  return regionOf(source, provenanceFor(state, source, nowMs));
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
  /** `browser` only: the hostname of the service whose route answers the page — `browserSubjectHostFor`. */
  readonly subjectHost?: string;
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
  const nowMs = useSecondsNowMs(operation.phase === "running");
  const { state, history, buildLog } = useOperationObservation(target, environmentId, nowMs);
  const topology = useZeropsTopology(environmentId);
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  // A log that opened itself while live stays open once it ends: closing it
  // at settle would shrink the card under the reader.
  const [wasLive, setWasLive] = useState(false);
  const logEverLive = wasLive || buildLog.status === "live";
  if (logEverLive && !wasLive) {
    setWasLive(true);
  }
  const { live, liveFrame } = useLiveBrowserFrame(operation, environmentId);

  const devServerUrl = devServerUrlFor(operation, topology);
  const browserScreenshot = browserScreenshotFor(operation);
  const subjectHost = browserSubjectHostFor(operation, topology);
  const fields = {
    ...(devServerUrl === undefined ? {} : { devServerUrl }),
    ...(browserScreenshot === undefined ? {} : { browserScreenshot }),
    ...(subjectHost === undefined ? {} : { subjectHost }),
    ...(operation.kind === "browser"
      ? { live, ...(liveFrame === undefined ? {} : { liveFrame }) }
      : {}),
  };

  const region = deriveObservedStepsRegion(operation.kind, operation.phase, state, history, nowMs);
  if (region === undefined) {
    return fields;
  }
  if (region.buildLogQuery === undefined) {
    return {
      observed: { steps: region.steps, chips: region.chips, provenance: region.provenance },
      ...fields,
    };
  }

  const open = manualOpen ?? logEverLive;
  const log: ReactElement = createElement(ZeropsBuildLog, {
    lines: buildLog.lines,
    onToggle: () => setManualOpen(!open),
    open,
    status: buildLog.status,
  });
  return {
    observed: { steps: region.steps, chips: region.chips, provenance: region.provenance, log },
    ...fields,
  };
}
