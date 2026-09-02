/**
 * The poll driver behind the platform-activity overlay —
 * `../../../../zcp/plans/mate-live-activity-2026-09-02.md` §6.
 *
 * One poller per project, shared by every pending card in the thread ("one
 * request per project per tick"). Deliberately not React: a plain class with
 * an injectable clock/timer/visibility so it can be driven directly with fake
 * timers in a test, with `useProjectActivity` as a thin `useSyncExternalStore`
 * wrapper around a per-project singleton.
 */
import { ZeropsApiError } from "@t3tools/client-runtime/zerops";
import {
  readProjectProcesses,
  type ActivityProcess,
} from "@t3tools/client-runtime/zerops/activity/dto";

export interface ProjectActivityApiClient {
  fetchProjectProcesses(projectId: string): Promise<unknown>;
}

export interface ProjectActivitySnapshot {
  /** The last successfully decoded read, or undefined before the first one lands. */
  readonly processes: ReadonlyArray<ActivityProcess> | undefined;
  readonly atMs: number | undefined;
  /** Set once the feed is off for this project — 401/403/404, or an undecodable document. */
  readonly unavailableReason?: string | undefined;
}

const BASE_INTERVAL_MS = 2_500;
const MAX_INTERVAL_MS = 15_000;

export interface ProjectActivityPollerOptions {
  readonly client: ProjectActivityApiClient;
  readonly projectId: string;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly isHidden?: () => boolean;
}

/**
 * Polls one project's process list on an interval and republishes the latest
 * snapshot to every subscriber. Ref-counted: the timer runs only while at
 * least one card is subscribed, and stops the instant the last one leaves.
 */
export class ProjectActivityPoller {
  readonly #client: ProjectActivityApiClient;
  readonly #projectId: string;
  readonly #now: () => number;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #isHidden: () => boolean;

  readonly #listeners = new Set<() => void>();
  #snapshot: ProjectActivitySnapshot = { processes: undefined, atMs: undefined };
  #intervalMs = BASE_INTERVAL_MS;
  #timerHandle: unknown = undefined;
  #inFlight = false;
  #disposed = false;

  constructor(options: ProjectActivityPollerOptions) {
    this.#client = options.client;
    this.#projectId = options.projectId;
    this.#now = options.now ?? (() => Date.now());
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as number));
    this.#isHidden = options.isHidden ?? (() => typeof document !== "undefined" && document.hidden);
  }

  getSnapshot(): ProjectActivitySnapshot {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      this.#start();
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#stop();
      }
    };
  }

  dispose(): void {
    this.#disposed = true;
    this.#stop();
    this.#listeners.clear();
  }

  #start(): void {
    this.#intervalMs = BASE_INTERVAL_MS;
    void this.#poll();
  }

  #stop(): void {
    if (this.#timerHandle !== undefined) {
      this.#clearTimer(this.#timerHandle);
      this.#timerHandle = undefined;
    }
  }

  #scheduleNext(delayMs: number = this.#intervalMs): void {
    if (this.#disposed || this.#listeners.size === 0) {
      return;
    }
    this.#timerHandle = this.#setTimer(() => void this.#poll(), delayMs);
  }

  #publish(next: ProjectActivitySnapshot): void {
    this.#snapshot = next;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  async #poll(): Promise<void> {
    if (this.#inFlight) {
      return;
    }
    if (this.#isHidden()) {
      this.#scheduleNext();
      return;
    }
    this.#inFlight = true;
    // The interval already in effect when this poll started — a failure
    // schedules its retry at THIS delay, then doubles for the round after.
    const delayBeforeThisTick = this.#intervalMs;
    let nextDelay = delayBeforeThisTick;
    try {
      const document = await this.#client.fetchProjectProcesses(this.#projectId);
      const processes = readProjectProcesses(document);
      this.#intervalMs = BASE_INTERVAL_MS;
      nextDelay = BASE_INTERVAL_MS;
      if (processes === undefined) {
        // An undecodable document is "no observation", not a hard failure —
        // keep retrying at the base interval rather than declaring the feed
        // unavailable over a shape we simply cannot read yet.
        this.#publish({ ...this.#snapshot, unavailableReason: undefined });
      } else {
        this.#publish({ processes, atMs: this.#now() });
      }
    } catch (cause) {
      if (cause instanceof ZeropsApiError && isPermanentlyUnavailable(cause)) {
        this.#publish({ ...this.#snapshot, unavailableReason: cause.kind });
        this.#inFlight = false;
        // A permanently unavailable project never recovers on its own — stop
        // polling until a new subscriber restarts the poller.
        this.#stop();
        return;
      }
      // Network error or a transient server failure: retry once at the delay
      // already in effect, then back off further from there — this is the
      // "stale" path, not "unavailable".
      this.#intervalMs = Math.min(delayBeforeThisTick * 2, MAX_INTERVAL_MS);
    } finally {
      this.#inFlight = false;
    }
    this.#scheduleNext(nextDelay);
  }
}

/**
 * 401 (expired session — never trigger a Zerops re-login for an indicator),
 * 403 (forbidden) and 404 (not found, e.g. a stale/deleted project) all mean
 * the feed is off for this project; the client's own `#request` already
 * handled any refresh attempt before this error surfaced.
 */
function isPermanentlyUnavailable(error: ZeropsApiError): boolean {
  return (
    error.kind === "expired-session" || error.kind === "forbidden" || error.kind === "not-found"
  );
}
