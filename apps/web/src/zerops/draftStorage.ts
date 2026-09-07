import { accountLocalStorage } from "./accountLifetime";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Each document writes a fresh branch, including duplicated tabs. A reload
 * starts from that tab's previous branch; a new tab starts from the account's
 * last saved branch. Another tab can never overwrite the active branch. */
export function createDraftStorage(
  storage: DraftStorage,
  tabStorage: () => DraftStorage,
  makeId: () => string,
): DraftStorage {
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
    branchId = makeId();
    try {
      tabStorage().setItem(key, branchId);
    } catch {
      /* Memory-only tab. */
    }
    return branchId;
  };
  return {
    getItem(key) {
      const own = storage.getItem(`${key}:tab:${branch()}`);
      if (own !== null) return own;
      const previous =
        previousBranch === null ? null : storage.getItem(`${key}:tab:${previousBranch}`);
      const latest = storage.getItem(`${key}:latest`);
      const inherited =
        previous ?? (latest === null ? null : storage.getItem(`${key}:tab:${latest}`));
      // Materialize a resumed branch even when the user makes no edit. Otherwise
      // a second reload would lose the chain and read another tab's latest draft.
      if (inherited !== null) storage.setItem(`${key}:tab:${branch()}`, inherited);
      return inherited;
    },
    setItem(key, value) {
      storage.setItem(`${key}:tab:${branch()}`, value);
      storage.setItem(`${key}:latest`, branch());
    },
    removeItem(key) {
      // A tombstone prevents an intentional clear from resurrecting a prior branch.
      storage.setItem(`${key}:tab:${branch()}`, "");
    },
  };
}

export const accountDraftStorage = createDraftStorage(
  accountLocalStorage,
  () => window.sessionStorage,
  () =>
    Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16)).join("-"),
);
