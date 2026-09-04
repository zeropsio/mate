// @effect-diagnostics cryptoRandomUUID:off -- the receiver id is a plain client-generated UUID v4
// per `platformWatch.ts`'s own contract; every real caller may still override `makeReceiverId`.
/**
 * The service-map read for one environment: resolves which Zerops project and
 * organization it is, opens the platform websocket, and keeps a
 * `ZeropsTopologyView` current from the two direct REST reads
 * (`listProjectServices`, and the project's own process poller). One instance
 * per environment, ref-counted like `activity/projectActivityPoller.ts`'s
 * `ProjectActivityPoller` — the same split of a plain, injectable-clock class
 * behind a thin `useSyncExternalStore` hook (`useProjectTopology.ts`).
 *
 * Design rule this file exists to enforce: a push from `platformWatch.ts` is
 * a *signal*, never data — every `changed` event just triggers a debounced
 * `listProjectServices` re-read through `topology.ts`'s `projectTopology`,
 * the one REST decoder. A process update instead recomputes the view from
 * the already-cached service list and the shared process poller's latest
 * snapshot — no extra REST call, since nothing about a service changed.
 */
import type { ZeropsApiClient, ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import { loadZeropsCandidates } from "@t3tools/client-runtime/zerops/candidateLoading";
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import {
  lookupEnvironmentProjectRef,
  rememberEnvironmentProjectRef,
  type EnvironmentProjectRef,
} from "@t3tools/client-runtime/zerops/environmentProjectRef";
import {
  openPlatformWatch,
  type PlatformWatch,
  type PlatformWatchSocket,
} from "@t3tools/client-runtime/zerops/platformWatch";
import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops/session";
import { projectTopology, type ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { EnvironmentId } from "@t3tools/contracts";

import { pollerFor } from "./activity/useProjectActivity.ts";

const CHANGED_DEBOUNCE_MS = 300;
const DISCONNECTED_POLL_TRANSIENT_MS = 5_000;
const DISCONNECTED_POLL_IDLE_MS = 30_000;

export type ProjectTopologyLiveness = "live" | "polling";

export interface ProjectTopologySnapshot {
  readonly view: ZeropsTopologyView | undefined;
  /** `"live"` once the socket is open and subscribed; `"polling"` otherwise; `undefined` before anything has resolved. */
  readonly liveness: ProjectTopologyLiveness | undefined;
  readonly lastReadAt: number | undefined;
  readonly error: string | undefined;
}

const EMPTY_SNAPSHOT: ProjectTopologySnapshot = {
  view: undefined,
  liveness: undefined,
  lastReadAt: undefined,
  error: undefined,
};

export interface ProjectTopologyWatcherOptions {
  readonly environmentId: EnvironmentId;
  readonly client: ZeropsApiClient;
  readonly storage: ZeropsStorageAdapter;
  /** The environment's own registered origin — the only input the one-time origin match needs. */
  readonly displayUrl: string | null;
  readonly makeSocket: (url: string) => PlatformWatchSocket;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly isHidden?: () => boolean;
  readonly makeReceiverId?: () => string;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong reading this project.";
}

/**
 * One in-flight origin match per environment, shared across every watcher
 * instance for that environment (a remount while the first match is still
 * running must not start a second one). Cleared once the match settles,
 * whatever the outcome — a miss is retried on a later resolve, a hit never
 * needs to run again because it is remembered.
 */
const matchInFlightByEnvironment = new Map<string, Promise<EnvironmentProjectRef | undefined>>();

export class ProjectTopologyWatcher {
  readonly #environmentId: EnvironmentId;
  readonly #client: ZeropsApiClient;
  readonly #storage: ZeropsStorageAdapter;
  readonly #displayUrl: string | null;
  readonly #makeSocket: (url: string) => PlatformWatchSocket;
  readonly #now: () => number;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #isHidden: () => boolean;
  readonly #makeReceiverId: () => string;

  readonly #listeners = new Set<() => void>();
  #snapshot: ProjectTopologySnapshot = EMPTY_SNAPSHOT;

  #ref: EnvironmentProjectRef | undefined;
  #project: ZeropsProject | undefined;
  #servicesCache: ReadonlyArray<ZeropsService> | undefined;
  #latestProcesses: ReadonlyArray<ActivityProcess> = [];

  #watch: PlatformWatch | undefined;
  #unsubscribeWatch: (() => void) | undefined;
  #unsubscribePoller: (() => void) | undefined;
  #pollHandle: unknown;
  #debounceHandle: unknown;
  #disposed = false;
  /** Bumped on every stop, so a start left over from a stopped subscription becomes a no-op past its next await. */
  #generation = 0;

  constructor(options: ProjectTopologyWatcherOptions) {
    this.#environmentId = options.environmentId;
    this.#client = options.client;
    this.#storage = options.storage;
    this.#displayUrl = options.displayUrl;
    this.#makeSocket = options.makeSocket;
    this.#now = options.now ?? (() => Date.now());
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as number));
    this.#isHidden = options.isHidden ?? (() => typeof document !== "undefined" && document.hidden);
    this.#makeReceiverId = options.makeReceiverId ?? (() => crypto.randomUUID());
  }

  getSnapshot(): ProjectTopologySnapshot {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) {
      void this.#start(this.#generation);
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#stop();
    };
  }

  dispose(): void {
    this.#disposed = true;
    this.#stop();
    this.#listeners.clear();
  }

  #publish(next: Partial<ProjectTopologySnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...next };
    for (const listener of this.#listeners) listener();
  }

  /**
   * `myGeneration` pins this call to the subscription span it started in: a
   * fast unsubscribe→resubscribe while an earlier `#start` is still awaiting
   * bumps `#generation` on the way out, so that earlier call's continuation
   * becomes a no-op instead of racing the fresh one (mirrors
   * `platformWatch.ts`'s own generation guard).
   */
  async #start(myGeneration: number): Promise<void> {
    if (this.#ref === undefined) {
      const ref = await this.#resolveRef();
      if (this.#disposed || myGeneration !== this.#generation) return;
      if (ref === undefined) {
        this.#publish({ view: undefined });
        return;
      }
      this.#ref = ref;
    }

    if (this.#project === undefined) {
      const projectId = this.#ref.projectId;
      this.#project = await this.#client
        .fetchProject(projectId)
        .catch((): ZeropsProject => ({ id: projectId, name: projectId, status: "UNKNOWN" }));
      if (this.#disposed || myGeneration !== this.#generation) return;
    }

    this.#openWatch(this.#ref);
    this.#subscribeProcessPoller(this.#ref.projectId);
    await this.#readNow();
    if (this.#disposed || myGeneration !== this.#generation) return;
    this.#publish({ liveness: this.#snapshot.liveness ?? "polling" });
    this.#scheduleNextDisconnectedPoll();
  }

  async #resolveRef(): Promise<EnvironmentProjectRef | undefined> {
    const remembered = await lookupEnvironmentProjectRef(this.#storage, this.#environmentId);
    if (remembered !== undefined) return remembered;
    return this.#runMatchOnce();
  }

  #runMatchOnce(): Promise<EnvironmentProjectRef | undefined> {
    const key = String(this.#environmentId);
    const existing = matchInFlightByEnvironment.get(key);
    if (existing !== undefined) return existing;
    const promise = this.#doMatch().finally(() => {
      matchInFlightByEnvironment.delete(key);
    });
    matchInFlightByEnvironment.set(key, promise);
    return promise;
  }

  /**
   * The fallback for an environment connected before this store existed:
   * one origin match against every organization the account belongs to,
   * stopping at the first hit. Tries organizations one at a time (rather
   * than trusting a `clientId` field on the matched project) so the
   * organization id this remembers is the one actually searched, never an
   * inferred one.
   */
  async #doMatch(): Promise<EnvironmentProjectRef | undefined> {
    if (this.#displayUrl === null) return undefined;
    const origin = normalizeOrigin(this.#displayUrl);
    if (origin === null) return undefined;

    let organizations;
    try {
      organizations = await this.#client.fetchOrganizations();
    } catch {
      return undefined;
    }

    const connectedOrigins = new Map([[origin, this.#environmentId]]);
    for (const organization of organizations) {
      if (this.#disposed) return undefined;
      let candidates;
      try {
        ({ candidates } = await loadZeropsCandidates(this.#client, {
          organizationIds: [organization.id],
          connectedOrigins,
        }));
      } catch {
        continue;
      }
      const match = candidates.find((candidate) => candidate.environmentId === this.#environmentId);
      if (match === undefined) continue;
      const ref = { projectId: match.project.id, orgId: organization.id, source: "match" as const };
      await rememberEnvironmentProjectRef(this.#storage, this.#environmentId, ref, this.#now);
      return { ...ref, learnedAt: this.#now() };
    }
    return undefined;
  }

  #openWatch(ref: EnvironmentProjectRef): void {
    const watch = openPlatformWatch({
      client: this.#client,
      orgId: ref.orgId,
      projectId: ref.projectId,
      makeSocket: this.#makeSocket,
      timers: { setTimer: this.#setTimer, clearTimer: this.#clearTimer },
      makeReceiverId: this.#makeReceiverId,
    });
    this.#watch = watch;
    this.#unsubscribeWatch = watch.events.subscribe((event) => {
      if (this.#disposed) return;
      if (event.type === "connected") {
        this.#publish({ liveness: "live" });
        this.#stopDisconnectedPollLoop();
        void this.#readNow();
      } else if (event.type === "disconnected") {
        this.#publish({ liveness: "polling" });
        this.#scheduleNextDisconnectedPoll();
      } else {
        // "changed" — a push is a signal, never data: re-read through the
        // one REST decoder, debounced so a burst becomes one read.
        this.#scheduleDebouncedRead();
      }
    });
  }

  #subscribeProcessPoller(projectId: string): void {
    const poller = pollerFor(projectId, this.#client);
    this.#latestProcesses = poller.getSnapshot().processes ?? [];
    this.#unsubscribePoller = poller.subscribe(() => {
      if (this.#disposed) return;
      this.#latestProcesses = poller.getSnapshot().processes ?? this.#latestProcesses;
      this.#recomputeView();
    });
  }

  #scheduleDebouncedRead(): void {
    if (this.#debounceHandle !== undefined) this.#clearTimer(this.#debounceHandle);
    this.#debounceHandle = this.#setTimer(() => {
      this.#debounceHandle = undefined;
      void this.#readNow();
    }, CHANGED_DEBOUNCE_MS);
  }

  #currentIntervalMs(): number {
    const transient = this.#snapshot.view?.services.some((service) => service.transient) ?? false;
    return transient ? DISCONNECTED_POLL_TRANSIENT_MS : DISCONNECTED_POLL_IDLE_MS;
  }

  #scheduleNextDisconnectedPoll(): void {
    if (this.#disposed || this.#listeners.size === 0) return;
    if (this.#snapshot.liveness === "live") return;
    if (this.#pollHandle !== undefined) return;
    this.#pollHandle = this.#setTimer(() => {
      this.#pollHandle = undefined;
      if (this.#isHidden()) {
        this.#scheduleNextDisconnectedPoll();
        return;
      }
      void this.#readNow().then(() => this.#scheduleNextDisconnectedPoll());
    }, this.#currentIntervalMs());
  }

  #stopDisconnectedPollLoop(): void {
    if (this.#pollHandle !== undefined) {
      this.#clearTimer(this.#pollHandle);
      this.#pollHandle = undefined;
    }
  }

  async #readNow(): Promise<void> {
    if (this.#ref === undefined || this.#disposed) return;
    try {
      const services = await this.#client.listProjectServices(this.#ref.projectId);
      if (this.#disposed) return;
      this.#servicesCache = services;
      this.#recomputeView();
      this.#publish({ lastReadAt: this.#now(), error: undefined });
    } catch (cause) {
      if (this.#disposed) return;
      this.#publish({ error: errorMessage(cause) });
    }
  }

  #recomputeView(): void {
    if (this.#project === undefined || this.#servicesCache === undefined) return;
    const view = projectTopology(this.#project, this.#servicesCache, this.#latestProcesses);
    this.#publish({ view });
  }

  #stop(): void {
    this.#generation += 1;
    this.#unsubscribeWatch?.();
    this.#unsubscribeWatch = undefined;
    this.#watch?.close();
    this.#watch = undefined;
    this.#unsubscribePoller?.();
    this.#unsubscribePoller = undefined;
    this.#stopDisconnectedPollLoop();
    if (this.#debounceHandle !== undefined) {
      this.#clearTimer(this.#debounceHandle);
      this.#debounceHandle = undefined;
    }
  }
}
