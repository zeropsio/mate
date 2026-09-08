import {
  mergeBoundedBuildLogLines,
  type BuildLogLine,
  type BuildLogQuery,
} from "../activity/buildLog.ts";
import type { ZeropsDataPolicy } from "./policy.ts";
import type { BuildLogFollowHandle, BuildLogTransport } from "./logTransport.ts";
import { BuildLogTransportError } from "./logTransport.ts";
import {
  organizationKeyOf,
  projectRoleGrantsAccess,
  type AccessState,
  type AccountScope,
  type ProjectRef,
} from "./types.ts";

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
  readonly loadingOlder: boolean;
  readonly cursor: BuildLogCursor;
  readonly gaps: BuildLogGaps;
  readonly truncation: BuildLogTruncation;
  readonly error: BuildLogPublicError | null;
}

export interface SharedBuildLogSession {
  getSnapshot(): BuildLogSnapshot;
  subscribe(listener: () => void): () => void;
  loadOlder(): Promise<void>;
  retry(): Promise<void>;
  /** Resolves after currently reachable asynchronous transport work settles. */
  drain(): Promise<void>;
}

export interface BuildLogLease {
  readonly session: SharedBuildLogSession;
  setFollow(follow: boolean): void;
  loadOlder(): Promise<void>;
  retry(): Promise<void>;
  /** Idempotent. The final release closes the shared session immediately. */
  release(): void;
}

export type BuildLogSessionKey = string & { readonly BuildLogSessionKey: unique symbol };

export type BuildLogRegistryErrorKind = "account" | "access" | "capacity" | "closed";

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
    project: ProjectRef,
    query: BuildLogQuery,
    options?: { readonly follow?: boolean },
  ): BuildLogLease;
  drain(): Promise<void>;
  /** Erases sessions no longer covered by the current account grant. */
  reconcileAccess(): void;
  diagnostics(): {
    readonly activeSessions: number;
    readonly leases: number;
    readonly closed: boolean;
  };
  /** Idempotently disposes every session and the account-owned transport. */
  shutdown(): void;
}

export interface BuildLogRegistryOptions {
  readonly scope: AccountScope;
  readonly access: () => AccessState;
  readonly now: () => number;
  readonly transport: BuildLogTransport;
  readonly policy: Pick<
    ZeropsDataPolicy,
    | "logBackfillLines"
    | "logPublishBatchLines"
    | "retainedLogLinesPerSession"
    | "retainedLogBytesPerSession"
    | "activeLogSessionsPerAccount"
    | "logPublicationCoalescingMs"
  >;
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

const emptySnapshot = (): BuildLogSnapshot => ({
  lines: [],
  bytes: 0,
  status: "idle",
  loadingOlder: false,
  cursor: { oldestLineId: null, newestLineId: null },
  gaps: { older: false, newer: false },
  truncation: { lines: 0, bytes: 0 },
  error: null,
});

const sameAccount = (scope: AccountScope, project: ProjectRef): boolean => {
  const account = project.organization.account;
  return (
    account.apiOrigin === scope.account.apiOrigin && account.accountId === scope.account.accountId
  );
};

/** Full ProjectRef plus every supported filter field; token material is never part of identity. */
export function buildLogSessionKeyOf(
  project: ProjectRef,
  query: BuildLogQuery,
): BuildLogSessionKey {
  return JSON.stringify([
    project.organization.account.apiOrigin,
    project.organization.account.accountId,
    project.organization.organizationId,
    project.projectId,
    query.buildServiceStackId,
    query.appVersionId,
    query.fromIso ?? null,
  ]) as BuildLogSessionKey;
}

const publicError = (error: unknown, fallback: "backfill" | "stream"): BuildLogPublicError => {
  if (error instanceof BuildLogTransportError) {
    if (error.kind === "account-fence" || error.kind === "closed") return "account";
    if (error.kind === "grant") return "access";
  }
  return fallback;
};

class BuildLogSession implements SharedBuildLogSession {
  readonly #project: ProjectRef;
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
  #olderGeneration = 0;
  #followGeneration = 0;
  #followDesired = false;
  #followHandle: BuildLogFollowHandle | undefined;
  #reopening = false;
  #initialLoading = false;
  #olderLoading = false;
  #pending: ReadonlyArray<BuildLogLine> = [];
  #pendingDroppedLines = 0;
  #pendingDroppedBytes = 0;
  #pendingOlderGap = false;
  #pendingNewerGap = false;
  #flushHandle: unknown;

  constructor(
    project: ProjectRef,
    query: BuildLogQuery,
    options: BuildLogRegistryOptions,
    canRead: () => boolean,
  ) {
    this.#project = project;
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
      if (this.#snapshot.status === "live") {
        this.#publish({ ...this.#snapshot, status: "ended", error: null });
      }
      return;
    }
    if (this.#snapshot.status === "ended") this.#openFollow();
  }

  async loadOlder(): Promise<void> {
    if (!this.#canRead() || this.#olderLoading) return;
    const beforeLineId = this.#snapshot.cursor.oldestLineId;
    if (beforeLineId === null) return;
    this.#olderLoading = true;
    const older = ++this.#olderGeneration;
    this.#publish({ ...this.#snapshot, loadingOlder: true, error: null });
    const lifecycle = this.#lifecycleGeneration;
    const operation = this.#transport
      .loadPage({
        project: this.#project,
        query: this.#query,
        limit: this.#policy.logBackfillLines,
        beforeLineId,
        signal: this.#lifecycleController.signal,
      })
      .then((page) => {
        if (!this.#isCurrent(lifecycle) || older !== this.#olderGeneration) return;
        const merged = mergeBoundedBuildLogLines(
          this.#snapshot.lines,
          page.lines,
          {
            maxLines: this.#policy.retainedLogLinesPerSession,
            maxBytes: this.#policy.retainedLogBytesPerSession,
          },
          "oldest",
        );
        this.#publishWindow(merged, {
          older: page.rejectedItems > 0 || merged.droppedOlder,
          newer: merged.droppedNewer,
          loadingOlder: false,
        });
      })
      .catch((error: unknown) => {
        if (!this.#isCurrent(lifecycle) || older !== this.#olderGeneration) return;
        this.#publish({
          ...this.#snapshot,
          loadingOlder: false,
          error: publicError(error, "backfill"),
        });
      })
      .finally(() => {
        if (older === this.#olderGeneration) this.#olderLoading = false;
      });
    this.#track(operation);
    await operation;
  }

  async retry(): Promise<void> {
    if (!this.#canRead() || this.#initialLoading) return;
    this.#stopFollow();
    this.#olderGeneration += 1;
    this.#olderLoading = false;
    this.#loadInitial();
    await this.drain();
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
    this.#olderGeneration += 1;
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
    this.#publish({ ...this.#snapshot, status: "loading", loadingOlder: false, error: null });
    const operation = this.#transport
      .loadPage({
        project: this.#project,
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
          loadingOlder: false,
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
        project: this.#project,
        query: this.#query,
        signal: this.#lifecycleController.signal,
        ...(this.#snapshot.cursor.newestLineId === null
          ? {}
          : { fromLineId: this.#snapshot.cursor.newestLineId }),
        callbacks: {
          onLines: (lines, rejectedItems) => {
            if (!this.#isFollowCurrent(lifecycle, follow)) return;
            this.#reopening = false;
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
            const hasCursor = this.#snapshot.cursor.newestLineId !== null;
            if (!hasCursor) {
              this.#publish({ ...this.#snapshot, gaps: { ...this.#snapshot.gaps, newer: true } });
            }
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
        this.#publish({
          ...this.#snapshot,
          status: "live",
          error: null,
          gaps: { ...this.#snapshot.gaps, newer: false },
        });
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
    if (batch.length > 0 || this.#pendingOlderGap || this.#pendingNewerGap) {
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
        loadingOlder: this.#snapshot.loadingOlder,
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
      readonly loadingOlder: boolean;
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
      loadingOlder: change.loadingOlder,
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

interface RegistryEntry {
  readonly project: ProjectRef;
  readonly session: BuildLogSession;
  readonly follows: Map<number, boolean>;
}

export function makeBuildLogRegistry(options: BuildLogRegistryOptions): BuildLogRegistry {
  const sessions = new Map<BuildLogSessionKey, RegistryEntry>();
  let nextLeaseId = 0;
  let closed = false;
  let expiryTimer: unknown;
  let expiryDeadline: number | null = null;

  const accessDeadline = (project: ProjectRef): number | null => {
    const access = options.access();
    const grant =
      access.status === "verified"
        ? access
        : access.status === "verifying" || access.status === "failed"
          ? access.previous
          : null;
    if (
      grant === null ||
      grant.accountEpoch !== options.scope.epoch ||
      grant.account.accountId !== options.scope.account.accountId ||
      grant.account.apiOrigin !== options.scope.account.apiOrigin ||
      grant.deadlineMs <= options.now() ||
      !grant.organizations.some(
        ({ organization }) =>
          organizationKeyOf(organization) === organizationKeyOf(project.organization),
      ) ||
      !projectRoleGrantsAccess(grant, project, "any-role")
    )
      return null;
    return grant.deadlineMs;
  };

  const reconcileAccess = (): void => {
    let deadline: number | null = null;
    for (const [key, entry] of sessions) {
      const allowedUntil = accessDeadline(entry.project);
      if (allowedUntil === null) {
        sessions.delete(key);
        entry.session.dispose("access");
      } else deadline = allowedUntil;
    }
    if (deadline === expiryDeadline) return;
    if (expiryTimer !== undefined) options.clearTimer(expiryTimer);
    expiryTimer = undefined;
    expiryDeadline = deadline;
    if (deadline !== null) {
      expiryTimer = options.setTimer(
        () => {
          expiryTimer = undefined;
          expiryDeadline = null;
          reconcileAccess();
        },
        Math.max(0, deadline - options.now()),
      );
    }
  };

  const acquire: BuildLogRegistry["acquire"] = (project, query, leaseOptions = {}) => {
    if (closed) throw new BuildLogRegistryError("closed");
    if (!sameAccount(options.scope, project)) throw new BuildLogRegistryError("account");
    reconcileAccess();
    if (accessDeadline(project) === null) throw new BuildLogRegistryError("access");
    const key = buildLogSessionKeyOf(project, query);
    let entry = sessions.get(key);
    if (entry === undefined) {
      if (sessions.size >= options.policy.activeLogSessionsPerAccount) {
        throw new BuildLogRegistryError("capacity");
      }
      const session = new BuildLogSession(project, query, options, () => {
        reconcileAccess();
        return sessions.get(key) === entry;
      });
      entry = { project, session, follows: new Map() };
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
        if (sessions.get(key) === ownedEntry) sessions.delete(key);
        ownedEntry.session.dispose();
        reconcileAccess();
        return;
      }
      ownedEntry.session.setFollow([...ownedEntry.follows.values()].some(Boolean));
    };

    reconcileAccess();

    return {
      session: ownedEntry.session,
      setFollow: (follow) => {
        if (released || closed) return;
        ownedEntry.follows.set(leaseId, follow);
        ownedEntry.session.setFollow([...ownedEntry.follows.values()].some(Boolean));
      },
      loadOlder: () => (released ? Promise.resolve() : ownedEntry.session.loadOlder()),
      retry: () => (released ? Promise.resolve() : ownedEntry.session.retry()),
      release,
    };
  };

  const shutdown = (): void => {
    if (closed) return;
    closed = true;
    for (const entry of sessions.values()) entry.session.dispose();
    sessions.clear();
    reconcileAccess();
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
