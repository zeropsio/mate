/**
 * Whether a background job that never reported ever will: the one judgement
 * the run card's job lines and the band at the foot both read (review of
 * pass 39: the band kept a job lost to a restart "running" while its card
 * said it didn't report back, and one dead session's job read live for as
 * long as a newer session's job kept the thread busy).
 *
 * The server names the background tasks it holds live (`backgroundTaskIds`):
 * one that is not among them — its session ended, the server restarted —
 * never will report. A server from before that says only whether anything
 * lives (`backgroundLiveness`): with the thread idle and nothing live, every
 * unreported job is gone; else nothing is known.
 */

/** The jobs the server holds live, by task id; null when it says nothing that settles it. */
export interface LiveJobs {
  readonly ids: ReadonlySet<string>;
}

/** How long a job the server stopped naming still counts as live, while watched: its report may be on its way. */
export const LIVE_JOB_GRACE_MS = 3000;

/** What the thread's shell says of its background work, as `LiveJobs`. */
export function liveJobsOf(input: {
  readonly backgroundTaskIds: ReadonlyArray<string> | undefined;
  readonly backgroundLiveness: "working" | "monitoring" | null | undefined;
  readonly isWorking: boolean;
  /**
   * The conversation is the engine's: its record ends its work itself (`lost` once its session
   * goes), and the shell beside it is V1's, which runs nothing there, so nothing is judged from it.
   */
  readonly engine?: boolean;
}): LiveJobs | null {
  if (input.engine === true) return null;
  if (input.backgroundTaskIds !== undefined) return { ids: new Set(input.backgroundTaskIds) };
  return !input.isWorking && input.backgroundLiveness == null ? { ids: new Set() } : null;
}

/**
 * The live set as a watcher sees it: a job the server stops naming stays in
 * it `LIVE_JOB_GRACE_MS`, so its report, a moment behind, lands before it
 * could read lost; on first sight nothing lingers. `lingering` maps each
 * such id to when it left.
 */
export interface LingeringLiveJobs {
  /** What reads as live: what the server names, and what lingers. */
  readonly live: LiveJobs | null;
  /** What the server named last. */
  readonly named: ReadonlySet<string>;
  /** Each id it stopped naming, by when it did, while it lingers. */
  readonly lingering: ReadonlyMap<string, number>;
}

export function lingerLiveJobs(
  shown: LingeringLiveJobs | null,
  next: LiveJobs | null,
  at: number,
): LingeringLiveJobs {
  if (next === null) return { live: null, named: new Set(), lingering: new Map() };
  const lingering = new Map<string, number>();
  if (shown !== null) {
    for (const [id, left] of shown.lingering) {
      if (!next.ids.has(id) && at - left < LIVE_JOB_GRACE_MS) lingering.set(id, left);
    }
    for (const id of shown.named) {
      if (!next.ids.has(id) && !shown.lingering.has(id)) lingering.set(id, at);
    }
  }
  return { live: { ids: new Set([...next.ids, ...lingering.keys()]) }, named: next.ids, lingering };
}

/** When the next lingering id lets go, or null. */
export function lingerDue(shown: LingeringLiveJobs): number | null {
  const lefts = [...shown.lingering.values()];
  return lefts.length === 0 ? null : Math.min(...lefts) + LIVE_JOB_GRACE_MS;
}

/**
 * Whether an unreported job is lost: the server holds it no longer, and it
 * is no job of a turn still running (its start may be a moment behind).
 */
export function jobLost(
  job: { readonly id: string | undefined; readonly ofLiveTurn: boolean },
  live: LiveJobs | null,
): boolean {
  if (live === null || job.ofLiveTurn) return false;
  return job.id === undefined ? live.ids.size === 0 : !live.ids.has(job.id);
}
