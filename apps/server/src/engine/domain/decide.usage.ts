/**
 * A usage limit: the pause, the probe wakes, and trying past it.
 *
 * @module engine/domain/decide.usage
 */
import { wakeId as deriveWakeId } from "@t3tools/contracts";

import type { ProviderUsageReport } from "./command.ts";
import { isUsageWake } from "./evolve.ts";
import type { ConversationState, RunRecord } from "./state.ts";
import type { StepBuilder } from "./decide.step.ts";
import { CONTINUE_TEXT, admitNext } from "./decide.runs.ts";
import { wakeFired } from "./decide.wakes.ts";

/** The first probe of a usage limit whose reset is unknown, and the longest a probe waits. */
export const USAGE_PROBE_FIRST_MS = 15 * 60_000;
export const USAGE_PROBE_MAX_MS = 60 * 60_000;

export const resetTime = (resetsAt: string): number | null => {
  if (resetsAt === "unknown") return null;
  const at = Date.parse(resetsAt);
  return Number.isNaN(at) ? null : at;
};

/**
 * A usage limit ended `run` and holds the queue. A known reset arms a resume that joins it at the
 * provider's reported reset; an
 * unknown one arms a probe that tries to resume it, waiting 15 minutes, then twice as long after
 * each probe the limit refuses, up to an hour. Only the probe's outcome ends anything; the
 * person can write sooner.
 */
export const limited = (b: StepBuilder, run: RunRecord, resetsAt: number | null): void => {
  // One limit at a time: the newest says when the queue may go on.
  cancelUsageWakes(b, "a newer usage limit");
  if (resetsAt === null) {
    const last = b.state.usageProbeMs;
    const delay = last === null ? USAGE_PROBE_FIRST_MS : Math.min(2 * last, USAGE_PROBE_MAX_MS);
    b.emit({
      _tag: "WakeArmed",
      wakeId: deriveWakeId(b.state.conversationId, "usage-probe", run.id),
      kind: "usage-probe",
      dueAt: b.now + delay,
      cron: null,
      principal: run.principal,
      joins: run.id,
      text: CONTINUE_TEXT,
    });
    return;
  }
  b.emit({
    _tag: "WakeArmed",
    wakeId: deriveWakeId(b.state.conversationId, "usage-resume", run.id),
    kind: "usage-resume",
    dueAt: resetsAt,
    cron: null,
    principal: run.principal,
    joins: run.id,
    text: CONTINUE_TEXT,
  });
};

/**
 * How far a window's reset may sit from a limit's reset and still be that limit's window: a
 * limit's words round its reset (Claude says "resets 1pm"), the window keeps its own instant.
 */
export const LIMIT_WINDOW_MATCH_MS = 60 * 60_000;

/**
 * Whether the provider's report shows the limit that pauses the conversation is gone: read after
 * the limit, every window with room, none that resets when the limit does. A limit belongs to the
 * credential that hit it: a changed credential gets one attempt even without windows.
 */
export const limitGone = (state: ConversationState, usage: ProviderUsageReport): boolean => {
  const pausedUntil = state.pausedUntil;
  const limit = state.usageLimit;
  if (pausedUntil === null || limit === null || usage.checkedAt <= limit.at) return false;
  if (
    limit.credentialFingerprint !== null &&
    usage.credentialFingerprint !== null &&
    limit.credentialFingerprint !== usage.credentialFingerprint
  )
    return true;
  if (usage.windows.length === 0) return false;
  return usage.windows.every(
    (window) =>
      window.usedPercent < 100 &&
      (pausedUntil === "unknown" ||
        window.resetsAt === null ||
        Math.abs(window.resetsAt - pausedUntil) > LIMIT_WINDOW_MATCH_MS),
  );
};

/**
 * The pause a usage limit holds lifts and the work tries the provider now: the held message first,
 * else the limited run's resume. A provider that still refuses ends that run as a usage limit
 * again, and the pause is back until the reset it names.
 */
export const tryPastLimit = (b: StepBuilder, reason: string): void => {
  if (b.state.pausedUntil === null) return;
  const wake = Object.values(b.state.wakes).find((candidate) => isUsageWake(candidate.kind));
  b.emit({ _tag: "UsagePauseLifted", reason });
  if (wake === undefined) return admitNext(b);
  wakeFired(b, wake.id, undefined);
};

export const cancelUsageWakes = (b: StepBuilder, reason: string): void => {
  for (const wake of Object.values(b.state.wakes)) {
    if (isUsageWake(wake.kind)) b.emit({ _tag: "WakeCancelled", wakeId: wake.id, reason });
  }
};
