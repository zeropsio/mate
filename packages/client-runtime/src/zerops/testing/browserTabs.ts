/**
 * Browser tabs for the account harness (DESIGN §11.1, §6.7): tabs of one
 * origin sharing `localStorage` and Web Locks, each with its own
 * `sessionStorage` and signals.
 *
 * It keeps the browser's cross-tab semantics a test depends on: a storage
 * event reaches every tab but the writer's, as a later task, and only when a
 * value changed.
 *
 * No React and no DOM globals (DESIGN §7.2 rule 1): web tests adapt a tab to a
 * window of their own.
 */

import {
  ZEROPS_SELECTION_STORAGE_KEY,
  ZEROPS_SESSION_STORAGE_KEY,
  type ZeropsSession,
  type ZeropsStorageAdapter,
} from "../session.ts";

/** Runs cross-tab delivery as a later task even when a test fakes the timers. */
const nextTask = globalThis.setTimeout.bind(globalThis);

/** The `Storage` members code under test calls. */
export interface HarnessStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

export interface HarnessStorageChange {
  readonly key: string | null;
  readonly oldValue: string | null;
  readonly newValue: string | null;
}

/** What a tab's page hears from the browser, by the DOM event it arrives as. */
export type BrowserSignal =
  | { readonly type: "visibilitychange"; readonly visibilityState: "visible" | "hidden" }
  | { readonly type: "freeze" }
  | { readonly type: "resume" }
  | { readonly type: "offline" }
  | { readonly type: "online" }
  | { readonly type: "focus" }
  | { readonly type: "blur" }
  | { readonly type: "pageshow"; readonly persisted: boolean }
  | ({ readonly type: "storage" } & HarnessStorageChange);

export interface TabState {
  readonly visibilityState: "visible" | "hidden";
  readonly frozen: boolean;
  readonly online: boolean;
  readonly focused: boolean;
}

/**
 * A tab's signals (DESIGN §6.4). Each changes the tab's state and is heard
 * once per change; repeating one that changes nothing is silent, as in a browser.
 */
export interface FakeSignals {
  readonly subscribe: (listener: (signal: BrowserSignal) => void) => () => void;
  readonly state: () => TabState;
  readonly hide: () => void;
  readonly show: () => void;
  readonly freeze: () => void;
  readonly resume: () => void;
  readonly offline: () => void;
  readonly online: () => void;
  readonly focus: () => void;
  readonly blur: () => void;
  /** The page is shown again, `persisted` when it comes back from the back/forward cache. */
  readonly pageshow: (options: { readonly persisted: boolean }) => void;
  /** A storage event arriving from another tab. */
  readonly storage: (change: HarnessStorageChange) => void;
}

export interface HarnessLock {
  readonly name: string;
  readonly mode: "exclusive";
}

export interface HarnessLockOptions {
  /** Answer `null` at once instead of waiting while another holder has the lock. */
  readonly ifAvailable?: boolean;
}

type LockCallback<T> = (lock: HarnessLock | null) => T | Promise<T>;

/** The exclusive `navigator.locks` requests the client makes (DESIGN §6.7). */
export interface FakeWebLocks {
  request<T>(name: string, callback: LockCallback<T>): Promise<T>;
  request<T>(name: string, options: HarnessLockOptions, callback: LockCallback<T>): Promise<T>;
}

export interface HarnessMessageEvent {
  readonly data: unknown;
}

/** The `BroadcastChannel` members the client uses. */
export interface FakeBroadcastChannel {
  readonly name: string;
  postMessage(data: unknown): void;
  addEventListener(type: "message", listener: (event: HarnessMessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: HarnessMessageEvent) => void): void;
  close(): void;
}

export interface HarnessTab {
  readonly id: string;
  /** This tab's view of the origin's shared `localStorage`. */
  readonly localStorage: HarnessStorage;
  /** This tab's own `sessionStorage`; it survives the tab's reloads. */
  readonly sessionStorage: HarnessStorage;
  readonly signals: FakeSignals;
  readonly locks: FakeWebLocks;
  /** `BroadcastChannel` for code running in this tab. */
  readonly BroadcastChannel: new (name: string) => FakeBroadcastChannel;
  /** The Zerops session storage adapter over this tab's storage. */
  readonly zeropsStorage: ZeropsStorageAdapter;
  /**
   * The page reloads: everything it ran is gone — its locks are released, its
   * channels closed, its listeners dropped — and its `sessionStorage` stays.
   */
  readonly reload: () => void;
  readonly reloads: number;
}

export interface HarnessBrowser {
  readonly openTab: () => HarnessTab;
  /** Every key in the origin's `localStorage`. */
  readonly localStorageKeys: () => ReadonlyArray<string>;
  /** The names of the Web Locks some tab holds. */
  readonly locksHeld: () => ReadonlyArray<string>;
}

export interface HarnessBrowserOptions {
  /**
   * A session stored before the test starts, as an older build left it: the
   * session key alone, with no owner record beside it (DESIGN §4.1 legacy rollout).
   */
  readonly session?: ZeropsSession;
}

function makeSignals() {
  const listeners = new Set<(signal: BrowserSignal) => void>();
  let state: TabState = { visibilityState: "visible", frozen: false, online: true, focused: true };
  const emit = (signal: BrowserSignal) => {
    for (const listener of listeners) listener(signal);
  };
  const change = (next: Partial<TabState>, signal: BrowserSignal) => {
    const changed = (Object.keys(next) as Array<keyof TabState>).some(
      (key) => state[key] !== next[key],
    );
    if (!changed) return;
    state = { ...state, ...next };
    emit(signal);
  };
  const signals: FakeSignals = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    state: () => state,
    hide: () =>
      change(
        { visibilityState: "hidden" },
        { type: "visibilitychange", visibilityState: "hidden" },
      ),
    show: () =>
      change(
        { visibilityState: "visible" },
        { type: "visibilitychange", visibilityState: "visible" },
      ),
    freeze: () => change({ frozen: true }, { type: "freeze" }),
    resume: () => change({ frozen: false }, { type: "resume" }),
    offline: () => change({ online: false }, { type: "offline" }),
    online: () => change({ online: true }, { type: "online" }),
    focus: () => change({ focused: true }, { type: "focus" }),
    blur: () => change({ focused: false }, { type: "blur" }),
    pageshow: ({ persisted }) => emit({ type: "pageshow", persisted }),
    storage: (storageChange) => emit({ type: "storage", ...storageChange }),
  };
  return { signals, unloadPage: () => listeners.clear() };
}

function makeStorage(
  entries: Map<string, string>,
  onChange: (change: HarnessStorageChange) => void,
): HarnessStorage {
  return {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      const oldValue = entries.get(key) ?? null;
      entries.set(key, String(value));
      if (oldValue !== value) onChange({ key, oldValue, newValue: value });
    },
    removeItem: (key) => {
      const oldValue = entries.get(key);
      if (oldValue === undefined) return;
      entries.delete(key);
      onChange({ key, oldValue, newValue: null });
    },
    clear: () => {
      if (entries.size === 0) return;
      entries.clear();
      onChange({ key: null, oldValue: null, newValue: null });
    },
  };
}

/**
 * The web client's placement (`web/zerops/storage.ts`): the session is shared
 * by every tab; each tab keeps its own organization selection, and the last
 * one written is where a new tab starts.
 */
function zeropsStorageOver(
  localStorage: HarnessStorage,
  sessionStorage: HarnessStorage,
): ZeropsStorageAdapter {
  const isSelection = (key: string) => key.startsWith(ZEROPS_SELECTION_STORAGE_KEY);
  return {
    get: async (key) =>
      isSelection(key)
        ? (sessionStorage.getItem(key) ?? localStorage.getItem(key))
        : localStorage.getItem(key),
    set: async (key, value) => {
      if (isSelection(key)) sessionStorage.setItem(key, value);
      localStorage.setItem(key, value);
    },
    remove: async (key) => {
      if (isSelection(key)) sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    },
  };
}

interface LockGrant {
  readonly tab: string;
  readonly granted: () => void;
}

/** One origin's lock manager: one holder per name, the rest queued in request order. */
function makeLockManager() {
  const held = new Map<string, LockGrant>();
  const queued = new Map<string, LockGrant[]>();
  const grantNext = (name: string) => {
    const next = queued.get(name)?.shift();
    if (next === undefined) return;
    held.set(name, next);
    next.granted();
  };
  const release = (name: string, grant: LockGrant) => {
    if (held.get(name) !== grant) return;
    held.delete(name);
    grantNext(name);
  };
  async function request<T>(
    tab: string,
    name: string,
    options: HarnessLockOptions,
    callback: LockCallback<T>,
  ): Promise<T> {
    if (options.ifAvailable === true && held.has(name)) return callback(null);
    const grant = await new Promise<LockGrant>((resolve) => {
      const candidate: LockGrant = { tab, granted: () => resolve(candidate) };
      if (held.has(name)) queued.set(name, [...(queued.get(name) ?? []), candidate]);
      else {
        held.set(name, candidate);
        candidate.granted();
      }
    });
    try {
      return await callback({ name, mode: "exclusive" });
    } finally {
      release(name, grant);
    }
  }
  return {
    locksFor: (tab: string): FakeWebLocks => ({
      request: <T>(
        name: string,
        optionsOrCallback: HarnessLockOptions | LockCallback<T>,
        callback?: LockCallback<T>,
      ) =>
        typeof optionsOrCallback === "function"
          ? request(tab, name, {}, optionsOrCallback)
          : request(tab, name, optionsOrCallback, callback!),
    }),
    held: () => [...held.keys()],
    /** A page that is gone neither holds nor waits for a lock. */
    unloadPage: (tab: string) => {
      for (const [name, waiting] of queued)
        queued.set(
          name,
          waiting.filter((grant) => grant.tab !== tab),
        );
      for (const [name, grant] of held) if (grant.tab === tab) release(name, grant);
    },
  };
}

/**
 * One origin's channels. A message reaches every other open channel of its
 * name, in any tab, as a later task and as a structured clone.
 */
function makeChannelHub() {
  const open = new Set<HarnessBroadcastChannel>();
  class HarnessBroadcastChannel implements FakeBroadcastChannel {
    readonly #listeners = new Set<(event: HarnessMessageEvent) => void>();
    readonly tab: string;
    readonly name: string;
    constructor(tab: string, name: string) {
      this.tab = tab;
      this.name = name;
      open.add(this);
    }
    postMessage(data: unknown): void {
      for (const channel of open) {
        if (channel === this || channel.name !== this.name) continue;
        const clone = structuredClone(data);
        nextTask(() => {
          for (const listener of channel.#listeners) listener({ data: clone });
        });
      }
    }
    addEventListener(_type: "message", listener: (event: HarnessMessageEvent) => void): void {
      this.#listeners.add(listener);
    }
    removeEventListener(_type: "message", listener: (event: HarnessMessageEvent) => void): void {
      this.#listeners.delete(listener);
    }
    close(): void {
      open.delete(this);
      this.#listeners.clear();
    }
  }
  return {
    channelFor: (tab: string) =>
      class extends HarnessBroadcastChannel {
        constructor(name: string) {
          super(tab, name);
        }
      },
    unloadPage: (tab: string) => {
      for (const channel of open) if (channel.tab === tab) channel.close();
    },
  };
}

export function makeHarnessBrowser(options: HarnessBrowserOptions = {}): HarnessBrowser {
  const shared = new Map<string, string>();
  if (options.session !== undefined)
    shared.set(ZEROPS_SESSION_STORAGE_KEY, JSON.stringify(options.session));
  const tabs = new Set<HarnessTab>();
  const locks = makeLockManager();
  const channels = makeChannelHub();
  let opened = 0;

  return {
    openTab: () => {
      const id = `tab-${++opened}`;
      const { signals, unloadPage } = makeSignals();
      const localStorage = makeStorage(shared, (change) => {
        for (const other of tabs) if (other !== tab) nextTask(() => other.signals.storage(change));
      });
      const sessionStorage = makeStorage(new Map(), () => undefined);
      let reloads = 0;
      const tab: HarnessTab = {
        id,
        localStorage,
        sessionStorage,
        signals,
        locks: locks.locksFor(id),
        BroadcastChannel: channels.channelFor(id),
        zeropsStorage: zeropsStorageOver(localStorage, sessionStorage),
        reload: () => {
          reloads += 1;
          unloadPage();
          locks.unloadPage(id);
          channels.unloadPage(id);
        },
        get reloads() {
          return reloads;
        },
      };
      tabs.add(tab);
      return tab;
    },
    localStorageKeys: () => [...shared.keys()],
    locksHeld: locks.held,
  };
}
