import { onBrowserStorageFull } from "../lib/storage";
import { accountLocalStorage } from "./accountLifetime";

export interface DraftStorage {
  getItem(key: string): string | null;
  /** Whether the value landed. */
  setItem(key: string, value: string): boolean;
  removeItem(key: string): void;
}

type TabStorage = Pick<Storage, "getItem" | "setItem">;

/** How many branches of a key outlive their tabs: each holds a whole copy of the drafts. */
const KEPT_BRANCHES = 8;

/** When a branch's document opened; a branch from before ids carried it is the oldest. */
const openedAt = (branchId: string) => {
  const dot = branchId.indexOf(".");
  return dot === -1 ? 0 : Number.parseInt(branchId.slice(0, dot), 36) || 0;
};

/** Each document writes a fresh branch, including duplicated tabs. A reload
 * starts from that tab's previous branch; a new tab starts from the account's
 * last saved branch. Another tab can never overwrite the active branch. A key
 * keeps at most eight branches: the oldest of closed tabs go first. */
export function createDraftStorage(
  storage: DraftStorage & { keys(): string[] },
  tabStorage: () => TabStorage,
  makeId: () => string,
  now: () => number = Date.now,
): DraftStorage & { evict(): void } {
  let previousBranch: string | null = null;
  let branchId: string | undefined;
  const branch = () => {
    if (branchId !== undefined) return branchId;
    const key = "mate:draft-tab:v1";
    try {
      previousBranch = tabStorage().getItem(key);
    } catch {
      /* Memory-only tab. */
    }
    branchId = `${now().toString(36)}.${makeId()}`;
    try {
      tabStorage().setItem(key, branchId);
    } catch {
      /* Memory-only tab. */
    }
    return branchId;
  };
  const branchKey = (key: string, id: string) => `${key}:tab:${id}`;
  /** Removes `key`'s branches beyond this tab's, its previous one, the latest and the `kept` newest. */
  const prune = (key: string, kept: number) => {
    const prefix = `${key}:tab:`;
    const keep = new Set([branch(), previousBranch, storage.getItem(`${key}:latest`)]);
    const others = storage
      .keys()
      .filter((stored) => stored.startsWith(prefix))
      .map((stored) => stored.slice(prefix.length))
      .filter((id) => !keep.has(id))
      .toSorted((left, right) => openedAt(right) - openedAt(left));
    for (const id of others.slice(kept)) storage.removeItem(branchKey(key, id));
  };
  const pruned = new Set<string>();
  const pruneOnce = (key: string) => {
    if (pruned.has(key)) return;
    pruned.add(key);
    prune(key, KEPT_BRANCHES - 2);
  };
  return {
    getItem(key) {
      pruneOnce(key);
      const own = storage.getItem(branchKey(key, branch()));
      if (own !== null) return own;
      const latest = storage.getItem(`${key}:latest`);
      const previous =
        previousBranch === null ? null : storage.getItem(branchKey(key, previousBranch));
      const inherited =
        previous ?? (latest === null ? null : storage.getItem(branchKey(key, latest)));
      // Materialize a resumed branch even when the user makes no edit. Otherwise
      // a second reload would lose the chain and read another tab's latest draft.
      const materialized =
        inherited !== null && storage.setItem(branchKey(key, branch()), inherited);
      if (materialized && previous !== null && previousBranch !== null) {
        // This tab's previous load lives on in this branch; a duplicate of the tab
        // that still points at it starts from the latest branch instead.
        storage.removeItem(branchKey(key, previousBranch));
        if (latest === previousBranch) storage.setItem(`${key}:latest`, branch());
      }
      return inherited;
    },
    setItem(key, value) {
      pruneOnce(key);
      const landed = storage.setItem(branchKey(key, branch()), value);
      // The latest pointer never names a branch that was not written.
      if (landed) storage.setItem(`${key}:latest`, branch());
      return landed;
    },
    removeItem(key) {
      // A tombstone prevents an intentional clear from resurrecting a prior branch.
      storage.setItem(branchKey(key, branch()), "");
    },
    /** A full origin keeps only this tab's branches and the latest of every key. */
    evict() {
      for (const stored of storage.keys()) {
        if (stored.endsWith(":latest")) prune(stored.slice(0, -":latest".length), 0);
      }
    },
  };
}

export const accountDraftStorage = createDraftStorage(
  accountLocalStorage,
  () => window.sessionStorage,
  () =>
    Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16)).join("-"),
);
onBrowserStorageFull(() => accountDraftStorage.evict());
