/**
 * The builds' logs a screen shows, one window per build shared by every card drawn for it: a
 * backfilled page, then, while a card follows it, its own stream — reopened from the newest line
 * when the platform closes it. Each window is read only while a card holds it (and a moment after,
 * for the next card drawn for the same build), and erased once the account's store withholds or
 * deletes its project. Lines live in memory only.
 *
 * @module data/buildLogs
 */
import {
  mergeBoundedBuildLogLines,
  type BuildLogLine,
  type BuildLogQuery,
} from "../zerops/activity/buildLog.ts";
import {
  BuildLogTransportError,
  type BuildLogFollowHandle,
  type BuildLogTransport,
} from "./adapters/buildLog.ts";
import { factOf } from "./reducer.ts";
import type { AccountStore } from "./store.ts";

export type BuildLogStatus = "idle" | "loading" | "live" | "ended" | "error";
export type BuildLogPublicError = "access" | "backfill" | "stream" | "account";

export interface BuildLogCursor {
  readonly oldestLineId: string | null;
  readonly newestLineId: string | null;
}

export interface BuildLogGaps {
  readonly older: boolean;
  readonly newer: boolean;
}

export interface BuildLogTruncation {
  readonly lines: number;
  readonly bytes: number;
}

/** Public state is intentionally free of signed grants, URLs and raw transport errors. */
export interface BuildLogSnapshot {
  readonly lines: ReadonlyArray<BuildLogLine>;
  readonly bytes: number;
  readonly status: BuildLogStatus;
  readonly cursor: BuildLogCursor;
  readonly gaps: BuildLogGaps;
  readonly truncation: BuildLogTruncation;
  readonly error: BuildLogPublicError | null;
}

export interface SharedBuildLogSession {
  getSnapshot(): BuildLogSnapshot;
  subscribe(listener: () => void): () => void;
  /** Resolves after currently reachable asynchronous transport work settles. */
  drain(): Promise<void>;
}

export interface BuildLogLease {
  readonly session: SharedBuildLogSession;
  setFollow(follow: boolean): void;
  /**
   * Idempotent. The final release stops following at once and keeps what was read for
   * {@link LOG_RELEASE_GRACE_MS}: a card drawn again for the same build in it (a row that
   * plops from the live slot into the history) reads nothing again.
   */
  release(): void;
}

export type BuildLogSessionKey = string & { readonly BuildLogSessionKey: unique symbol };

export type BuildLogRegistryErrorKind = "access" | "capacity" | "closed";

export class BuildLogRegistryError extends Error {
  readonly kind: BuildLogRegistryErrorKind;

  constructor(kind: BuildLogRegistryErrorKind) {
    super(`Build log registry rejected the request (${kind}).`);
    this.name = "BuildLogRegistryError";
    this.kind = kind;
  }
}

export interface BuildLogRegistry {
  acquire(
    projectId: string,
    query: BuildLogQuery,
    options?: { readonly follow?: boolean },
  ): BuildLogLease;
  drain(): Promise<void>;
  /** Erases the logs of projects the viewer may no longer read. */
  reconcileAccess(): void;
  diagnostics(): {
    readonly activeSessions: number;
    readonly leases: number;
    readonly closed: boolean;
  };
  /** Idempotently disposes every session and the account-owned transport. */
  shutdown(): void;
}

export interface BuildLogPolicy {
  readonly logBackfillLines: number;
  readonly logPublishBatchLines: number;
  readonly retainedLogLinesPerSession: number;
  readonly retainedLogBytesPerSession: number;
  readonly activeLogSessionsPerAccount: number;
  readonly logPublicationCoalescingMs: number;
}

export const BUILD_LOG_POLICY: BuildLogPolicy = {
  logBackfillLines: 500,
  logPublishBatchLines: 100,
  retainedLogLinesPerSession: 2_000,
  retainedLogBytesPerSession: 5 * 1_024 * 1_024,
  activeLogSessionsPerAccount: 32,
  logPublicationCoalescingMs: 100,
};

export interface BuildLogRegistryOptions {
  /** Whether the viewer may read a project's logs now, as the account's store holds it. */
  readonly readable: (projectId: string) => boolean;
  readonly transport: BuildLogTransport;
  readonly policy: BuildLogPolicy;
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

const emptySnapshot = (): BuildLogSnapshot => ({
  lines: [],
  bytes: 0,
  status: "idle",
  cursor: { oldestLineId: null, newestLineId: null },
  gaps: { older: false, newer: false },
  truncation: { lines: 0, bytes: 0 },
  error: null,
});

/** The project plus every supported filter field; token material is never part of identity. */
export function buildLogSessionKeyOf(projectId: string, query: BuildLogQuery): BuildLogSessionKey {
  return JSON.stringify([
    projectId,
    query.buildServiceStackId,
    query.appVersionId,
    query.fromIso ?? null,
    query.tillIso ?? null,
    query.processId ?? null,
  ]) as BuildLogSessionKey;
}

const publicError = (error: unknown, fallback: "backfill" | "stream"): BuildLogPublicError => {
  if (error instanceof BuildLogTransportError) {
    if (error.kind === "closed") return "account";
    if (error.kind === "grant") return "access";
  }
  return fallback;
};

class BuildLogSession implements SharedBuildLogSession {
  readonly #projectId: string;
  readonly #query: BuildLogQuery;
  readonly #transport: BuildLogTransport;
  readonly #policy: BuildLogRegistryOptions["policy"];
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #canRead: () => boolean;
  readonly #listeners = new Set<() => void>();
  readonly #operations = new Set<Promise<void>>();
  readonly #lifecycleController = new AbortController();
  #snapshot = emptySnapshot();
  #disposed = false;
  #lifecycleGeneration = 0;
  #initialGeneration = 0;
  #followGeneration = 0;
  #followDesired = false;
  #followHandle: BuildLogFollowHandle | undefined;
  #reopening = false;
  #initialLoading = false;
  #pending: ReadonlyArray<BuildLogLine> = [];
  #pendingDroppedLines = 0;
  #pendingDroppedBytes = 0;
  #pendingOlderGap = false;
  #pendingNewerGap = false;
  #flushHandle: unknown;
  /** The first valid source frame and its lines are published together. */
  #liveWithFlush = false;

  constructor(
    projectId: string,
    query: BuildLogQuery,
    options: BuildLogRegistryOptions,
    canRead: () => boolean,
  ) {
    this.#projectId = projectId;
    this.#query = query;
    this.#transport = options.transport;
    this.#policy = options.policy;
    this.#setTimer = options.setTimer;
    this.#clearTimer = options.clearTimer;
    this.#canRead = () => !this.#disposed && canRead();
  }

  getSnapshot(): BuildLogSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    if (!this.#canRead() || this.#snapshot.status !== "idle") return;
    this.#loadInitial();
  }

  setFollow(follow: boolean): void {
    if (!this.#canRead() || this.#followDesired === follow) return;
    this.#followDesired = follow;
    if (!follow) {
      this.#stopFollow();
      const opening = this.#snapshot.status === "loading" && !this.#initialLoading;
      if (this.#snapshot.status === "live" || opening) {
        this.#publish({ ...this.#snapshot, status: "ended", error: null });
      }
      return;
    }
    if (this.#snapshot.status === "ended") this.#openFollow();
  }

  async drain(): Promise<void> {
    while (this.#operations.size > 0) {
      await Promise.allSettled(this.#operations);
    }
  }

  dispose(error?: BuildLogPublicError): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#lifecycleController.abort();
    this.#lifecycleGeneration += 1;
    this.#initialGeneration += 1;
    this.#stopFollow();
    if (this.#flushHandle !== undefined) {
      this.#clearTimer(this.#flushHandle);
      this.#flushHandle = undefined;
    }
    this.#pending = [];
    this.#pendingDroppedLines = 0;
    this.#pendingDroppedBytes = 0;
    this.#pendingOlderGap = false;
    this.#pendingNewerGap = false;
    this.#snapshot =
      error === undefined ? emptySnapshot() : { ...emptySnapshot(), status: "error", error };
    for (const listener of this.#listeners) listener();
    this.#listeners.clear();
  }

  #loadInitial(): void {
    if (!this.#canRead() || this.#initialLoading) return;
    this.#initialLoading = true;
    const lifecycle = this.#lifecycleGeneration;
    const initial = ++this.#initialGeneration;
    this.#publish({ ...this.#snapshot, status: "loading", error: null });
    const operation = this.#transport
      .loadPage({
        projectId: this.#projectId,
        query: this.#query,
        limit: this.#policy.logBackfillLines,
        signal: this.#lifecycleController.signal,
      })
      .then((page) => {
        if (!this.#isCurrent(lifecycle) || initial !== this.#initialGeneration) return;
        const merged = mergeBoundedBuildLogLines(
          this.#snapshot.lines,
          page.lines,
          {
            maxLines: this.#policy.retainedLogLinesPerSession,
            maxBytes: this.#policy.retainedLogBytesPerSession,
          },
          "newest",
        );
        this.#publishWindow(merged, {
          older: page.rejectedItems > 0 || merged.droppedOlder,
          newer: merged.droppedNewer,
          status: this.#followDesired ? "loading" : "ended",
          error: null,
        });
        if (this.#followDesired) this.#openFollow();
      })
      .catch((error: unknown) => {
        if (!this.#isCurrent(lifecycle) || initial !== this.#initialGeneration) return;
        this.#publish({
          ...this.#snapshot,
          status: "error",
          error: publicError(error, "backfill"),
        });
      })
      .finally(() => {
        if (initial === this.#initialGeneration) this.#initialLoading = false;
      });
    this.#track(operation);
  }

  #openFollow(): void {
    if (!this.#canRead() || !this.#followDesired || this.#followHandle !== undefined) return;
    const lifecycle = this.#lifecycleGeneration;
    const follow = ++this.#followGeneration;
    const operation = this.#transport
      .openFollow({
        projectId: this.#projectId,
        query: this.#query,
        signal: this.#lifecycleController.signal,
        ...(this.#snapshot.cursor.newestLineId === null
          ? {}
          : { fromLineId: this.#snapshot.cursor.newestLineId }),
        callbacks: {
          onLines: (lines, rejectedItems) => {
            if (!this.#isFollowCurrent(lifecycle, follow)) return;
            this.#reopening = false;
            if (this.#snapshot.status !== "live") {
              this.#liveWithFlush = true;
            }
            this.#acceptFollowLines(lines, rejectedItems);
          },
          onMalformedFrame: () => {
            if (!this.#isFollowCurrent(lifecycle, follow)) return;
            this.#pendingOlderGap = true;
            this.#pendingNewerGap = true;
            this.#scheduleFlush();
          },
          onError: () => {
            if (!this.#isFollowCurrent(lifecycle, follow)) return;
            const handle = this.#followHandle;
            this.#followHandle = undefined;
            this.#followGeneration += 1;
            this.#liveWithFlush = false;
            handle?.close();
            this.#publish({
              ...this.#snapshot,
              status: "error",
              gaps: { ...this.#snapshot.gaps, newer: true },
              error: "stream",
            });
          },
          onClose: () => {
            if (!this.#isFollowCurrent(lifecycle, follow)) return;
            this.#followHandle = undefined;
            this.#liveWithFlush = false;
            if (this.#reopening) {
              this.#reopening = false;
              this.#publish({
                ...this.#snapshot,
                status: "ended",
                error: null,
                gaps: { ...this.#snapshot.gaps, newer: true },
              });
              return;
            }
            // The reopened stream waits for its own source frame.
            const hasCursor = this.#snapshot.cursor.newestLineId !== null;
            this.#publish({
              ...this.#snapshot,
              status: "loading",
              gaps: { ...this.#snapshot.gaps, newer: this.#snapshot.gaps.newer || !hasCursor },
            });
            this.#reopening = true;
            this.#openFollow();
          },
        },
      })
      .then((handle) => {
        if (!this.#isFollowCurrent(lifecycle, follow)) {
          handle.close();
          return;
        }
        this.#followHandle = handle;
      })
      .catch((error: unknown) => {
        if (!this.#isFollowCurrent(lifecycle, follow)) return;
        this.#publish({
          ...this.#snapshot,
          status: "error",
          gaps: { ...this.#snapshot.gaps, newer: true },
          error: publicError(error, "stream"),
        });
      });
    this.#track(operation);
  }

  #stopFollow(): void {
    this.#followGeneration += 1;
    this.#reopening = false;
    this.#liveWithFlush = false;
    this.#followHandle?.close();
    this.#followHandle = undefined;
  }

  #acceptFollowLines(lines: ReadonlyArray<BuildLogLine>, rejectedItems: number): void {
    const pending = mergeBoundedBuildLogLines(
      this.#pending,
      lines,
      {
        maxLines: this.#policy.retainedLogLinesPerSession,
        maxBytes: this.#policy.retainedLogBytesPerSession,
      },
      "newest",
    );
    this.#pending = pending.lines;
    this.#pendingDroppedLines += pending.droppedLines;
    this.#pendingDroppedBytes += pending.droppedBytes;
    this.#pendingOlderGap ||= pending.droppedOlder || rejectedItems > 0;
    this.#pendingNewerGap ||= pending.droppedNewer;
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushHandle !== undefined || this.#disposed) return;
    this.#flushHandle = this.#setTimer(() => {
      this.#flushHandle = undefined;
      this.#flushPending();
    }, this.#policy.logPublicationCoalescingMs);
  }

  #flushPending(): void {
    if (!this.#canRead()) return;
    const batch = this.#pending.slice(0, this.#policy.logPublishBatchLines);
    this.#pending = this.#pending.slice(batch.length);
    if (this.#liveWithFlush || batch.length > 0 || this.#pendingOlderGap || this.#pendingNewerGap) {
      if (this.#liveWithFlush) {
        // Its first frame's lines and its being live reach readers together.
        this.#liveWithFlush = false;
        this.#snapshot = {
          ...this.#snapshot,
          status: "live",
          error: null,
          gaps: { ...this.#snapshot.gaps, newer: false },
        };
      }
      const merged = mergeBoundedBuildLogLines(
        this.#snapshot.lines,
        batch,
        {
          maxLines: this.#policy.retainedLogLinesPerSession,
          maxBytes: this.#policy.retainedLogBytesPerSession,
        },
        "newest",
      );
      this.#publishWindow(merged, {
        older: this.#pendingOlderGap || merged.droppedOlder,
        newer: this.#pendingNewerGap || merged.droppedNewer,
        truncatedLines: this.#pendingDroppedLines,
        truncatedBytes: this.#pendingDroppedBytes,
      });
      this.#pendingDroppedLines = 0;
      this.#pendingDroppedBytes = 0;
      this.#pendingOlderGap = false;
      this.#pendingNewerGap = false;
    }
    if (this.#pending.length > 0) this.#scheduleFlush();
  }

  #publishWindow(
    window: {
      readonly lines: ReadonlyArray<BuildLogLine>;
      readonly bytes: number;
      readonly droppedLines: number;
      readonly droppedBytes: number;
      readonly droppedOlder: boolean;
      readonly droppedNewer: boolean;
    },
    change: {
      readonly older: boolean;
      readonly newer: boolean;
      readonly status?: BuildLogStatus;
      readonly error?: BuildLogPublicError | null;
      readonly truncatedLines?: number;
      readonly truncatedBytes?: number;
    },
  ): void {
    this.#publish({
      ...this.#snapshot,
      lines: window.lines,
      bytes: window.bytes,
      status: change.status ?? this.#snapshot.status,
      cursor: {
        oldestLineId: window.lines.at(0)?.id ?? null,
        newestLineId: window.lines.at(-1)?.id ?? null,
      },
      gaps: {
        older: this.#snapshot.gaps.older || change.older,
        newer: this.#snapshot.gaps.newer || change.newer,
      },
      truncation: {
        lines: this.#snapshot.truncation.lines + window.droppedLines + (change.truncatedLines ?? 0),
        bytes: this.#snapshot.truncation.bytes + window.droppedBytes + (change.truncatedBytes ?? 0),
      },
      error: change.error === undefined ? this.#snapshot.error : change.error,
    });
  }

  #publish(snapshot: BuildLogSnapshot): void {
    if (!this.#canRead()) return;
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }

  #isCurrent(lifecycle: number): boolean {
    return this.#canRead() && lifecycle === this.#lifecycleGeneration;
  }

  #isFollowCurrent(lifecycle: number, follow: number): boolean {
    return this.#isCurrent(lifecycle) && this.#followDesired && follow === this.#followGeneration;
  }

  #track(operation: Promise<void>): void {
    this.#operations.add(operation);
    void operation.finally(() => this.#operations.delete(operation));
  }
}

/** How long a build's log nobody holds is kept before it is closed. */
export const LOG_RELEASE_GRACE_MS = 5_000;

interface RegistryEntry {
  readonly projectId: string;
  readonly session: BuildLogSession;
  readonly follows: Map<number, boolean>;
  /** Its close, pending since its final release. */
  closing?: unknown;
}

export function makeBuildLogRegistry(options: BuildLogRegistryOptions): BuildLogRegistry {
  const sessions = new Map<BuildLogSessionKey, RegistryEntry>();
  let nextLeaseId = 0;
  let closed = false;

  const reconcileAccess = (): void => {
    for (const [key, entry] of sessions) {
      if (options.readable(entry.projectId)) continue;
      sessions.delete(key);
      if (entry.closing !== undefined) options.clearTimer(entry.closing);
      entry.session.dispose("access");
    }
  };

  const close = (key: BuildLogSessionKey, entry: RegistryEntry): void => {
    if (entry.closing !== undefined) options.clearTimer(entry.closing);
    entry.closing = undefined;
    if (sessions.get(key) === entry) sessions.delete(key);
    entry.session.dispose();
  };

  const acquire: BuildLogRegistry["acquire"] = (projectId, query, leaseOptions = {}) => {
    if (closed) throw new BuildLogRegistryError("closed");
    reconcileAccess();
    if (!options.readable(projectId)) throw new BuildLogRegistryError("access");
    const key = buildLogSessionKeyOf(projectId, query);
    let entry = sessions.get(key);
    if (entry?.closing !== undefined) {
      options.clearTimer(entry.closing);
      entry.closing = undefined;
    }
    if (entry === undefined) {
      // A log nobody holds gives way to one asked for.
      for (const [heldKey, held] of sessions) {
        if (sessions.size < options.policy.activeLogSessionsPerAccount) break;
        if (held.follows.size === 0) close(heldKey, held);
      }
      if (sessions.size >= options.policy.activeLogSessionsPerAccount) {
        throw new BuildLogRegistryError("capacity");
      }
      const session = new BuildLogSession(
        projectId,
        query,
        options,
        () => options.readable(projectId) && sessions.get(key) === entry,
      );
      entry = { projectId, session, follows: new Map() };
      sessions.set(key, entry);
    }

    const ownedEntry = entry;
    const leaseId = nextLeaseId++;
    ownedEntry.follows.set(leaseId, leaseOptions.follow ?? false);
    ownedEntry.session.setFollow([...ownedEntry.follows.values()].some(Boolean));
    ownedEntry.session.start();
    let released = false;

    const release = (): void => {
      if (released) return;
      released = true;
      ownedEntry.follows.delete(leaseId);
      if (ownedEntry.follows.size === 0) {
        ownedEntry.session.setFollow(false);
        if (closed || sessions.get(key) !== ownedEntry) {
          close(key, ownedEntry);
          return;
        }
        ownedEntry.closing = options.setTimer(() => {
          ownedEntry.closing = undefined;
          close(key, ownedEntry);
        }, LOG_RELEASE_GRACE_MS);
        return;
      }
      ownedEntry.session.setFollow([...ownedEntry.follows.values()].some(Boolean));
    };

    return {
      session: ownedEntry.session,
      setFollow: (follow) => {
        if (released || closed) return;
        ownedEntry.follows.set(leaseId, follow);
        ownedEntry.session.setFollow([...ownedEntry.follows.values()].some(Boolean));
      },
      release,
    };
  };

  const shutdown = (): void => {
    if (closed) return;
    closed = true;
    for (const entry of sessions.values()) {
      if (entry.closing !== undefined) options.clearTimer(entry.closing);
      entry.session.dispose();
    }
    sessions.clear();
    options.transport.shutdown();
  };

  return {
    acquire,
    reconcileAccess,
    drain: async () => {
      await Promise.all([...sessions.values()].map(({ session }) => session.drain()));
    },
    diagnostics: () => ({
      activeSessions: sessions.size,
      leases: [...sessions.values()].reduce((count, entry) => count + entry.follows.size, 0),
      closed,
    }),
    shutdown,
  };
}

/**
 * The account's build logs over its store: a project's logs are read while the store does not
 * withhold or delete it, and erased the moment it does.
 */
export function makeAccountBuildLogs(options: {
  readonly store: AccountStore;
  readonly transport: BuildLogTransport;
  readonly policy?: Partial<BuildLogPolicy>;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}): BuildLogRegistry {
  const { store } = options;
  const registry = makeBuildLogRegistry({
    readable: (projectId) => {
      const content = factOf(store.state(), "project", projectId)?.content.kind;
      return content !== "purged" && content !== "deleted";
    },
    transport: options.transport,
    policy: { ...BUILD_LOG_POLICY, ...options.policy },
    setTimer:
      options.setTimer ??
      // @effect-diagnostics-next-line globalTimers:off -- the logs' one timer port; plain promises, no Effect runtime.
      ((callback, delayMs) => globalThis.setTimeout(callback, delayMs)),
    clearTimer:
      options.clearTimer ??
      ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)),
  });
  const unsubscribe = store.subscribe(registry.reconcileAccess);
  return {
    ...registry,
    shutdown: () => {
      unsubscribe();
      registry.shutdown();
    },
  };
}
