/**
 * The per-card platform-activity state machine —
 * `../plans/mate-live-activity-2026-09-02.md` §5.
 *
 * Pure and stateless across calls: everything renderable is recomputed each
 * time from one attribution read plus the pending entry's own facts, so a
 * reopened thread or a second client lands in the right state on its first
 * poll (§5's closing paragraph, §7 edge 10). The caller only has to remember
 * the last *good* observation (`ActivityObservationRecord`) to hand back in —
 * no other history.
 */
import type { ActivityProcess } from "./dto.ts";
import { type PipelineState, getPipelineState, pipelineTerminalOutcome } from "./pipelineState.ts";
import type { AttributionResult } from "./attribution.ts";

/**
 * §4's allowlisted exception: a *resolved* result whose status is on this list
 * may keep a platform overlay below its verdict. Anything not on it freezes
 * the moment a result lands — see `resolved.continuation` below.
 */
export const RESULT_STATUSES_WITH_PLATFORM_CONTINUATION: ReadonlySet<string> = new Set([
  "BUILD_TRIGGERED",
]);

/** How long a stale observation is still shown (dimmed) before going `unavailable`. */
const STALE_AFTER_MS = 10_000;
const UNAVAILABLE_AFTER_MS = 60_000;

export interface ActivityObservation {
  readonly pipeline: PipelineState;
  readonly chips: ReadonlyArray<ActivityProcess>;
  /** When this observation was read, epoch ms. */
  readonly atMs: number;
}

/** What the caller remembers between polls — the last successful attribution read. */
export interface ActivityObservationRecord {
  readonly attribution: AttributionResult;
  readonly atMs: number;
}

export type ActivityState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "resolved";
      /** Present only for an allowlisted result status with prior platform data (§4). */
      readonly continuation?: ActivityObservation;
    }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "searching"; readonly elapsedMs: number }
  | { readonly kind: "observed"; readonly observation: ActivityObservation }
  | {
      readonly kind: "settledOnPlatform";
      readonly observation: ActivityObservation;
      readonly outcome: "finished" | "failed" | "cancelled";
    }
  | { readonly kind: "stale"; readonly observation: ActivityObservation; readonly staleMs: number };

export interface ActivityReducerInput {
  /** The tool call's own result has landed (`zeropsResult.resultText` decoded). */
  readonly hasResult: boolean;
  /** The decoded result's `status` field, when `hasResult`. */
  readonly resultStatus?: string;
  /** False when there is no session, no resolvable hostname, or no topology — §5's `idle` guard. */
  readonly attributable: boolean;
  /** Server-stamped start time of the tool call, epoch ms. */
  readonly toolStartedAtMs: number;
  /** §6 per-call ceiling: 30 minutes since `toolStartedAtMs`. */
  readonly ceilingExceeded: boolean;
  /** Set when the poller itself reports the feed is off for this call/project (401/403/404/mismatch). */
  readonly unavailableReason?: string;
  /** The last successful attribution read, if any has ever landed. */
  readonly lastObservation?: ActivityObservationRecord | undefined;
}

function outcomeFor(process: ActivityProcess, pipeline: PipelineState) {
  if (process.status === "CANCELED") {
    return "cancelled" as const;
  }
  const fromPipeline = pipelineTerminalOutcome(pipeline);
  if (fromPipeline !== undefined) {
    return fromPipeline;
  }
  return process.status === "FAILED" ? ("failed" as const) : undefined;
}

/**
 * Computes the card's platform-activity state fresh from the given facts —
 * `(input, now) → state`. Precedence is: a landed result always wins (§0, §4);
 * then non-attributable / ceiling / feed-unavailable; then whatever the last
 * observation says, aged against `nowMs`.
 */
export function reduceActivityState(input: ActivityReducerInput, nowMs: number): ActivityState {
  if (input.hasResult) {
    const allowed =
      input.resultStatus !== undefined &&
      RESULT_STATUSES_WITH_PLATFORM_CONTINUATION.has(input.resultStatus);
    const stepSource = input.lastObservation?.attribution.stepSource;
    if (!allowed || input.lastObservation === undefined || stepSource === undefined) {
      return { kind: "resolved" };
    }
    const { attribution, atMs } = input.lastObservation;
    const pipeline = getPipelineState(stepSource.appVersion);
    return {
      kind: "resolved",
      continuation: { pipeline, chips: attribution.chips, atMs },
    };
  }

  if (!input.attributable) {
    return { kind: "idle" };
  }

  if (input.ceilingExceeded) {
    return { kind: "unavailable", reason: "ceiling" };
  }

  if (input.unavailableReason !== undefined) {
    return { kind: "unavailable", reason: input.unavailableReason };
  }

  const lastObservation = input.lastObservation;
  const stepSource = lastObservation?.attribution.stepSource;
  if (lastObservation === undefined || stepSource === undefined) {
    return { kind: "searching", elapsedMs: Math.max(0, nowMs - input.toolStartedAtMs) };
  }

  const { attribution, atMs } = lastObservation;
  const pipeline = getPipelineState(stepSource.appVersion);
  const observation: ActivityObservation = { pipeline, chips: attribution.chips, atMs };
  const ageMs = nowMs - atMs;

  if (ageMs > UNAVAILABLE_AFTER_MS) {
    return { kind: "unavailable", reason: "stale-timeout" };
  }
  if (ageMs > STALE_AFTER_MS) {
    return { kind: "stale", observation, staleMs: ageMs };
  }

  const outcome = outcomeFor(stepSource, pipeline);
  if (outcome !== undefined) {
    return { kind: "settledOnPlatform", observation, outcome };
  }
  return { kind: "observed", observation };
}
