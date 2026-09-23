import { accountLocalStorage, accountStorageKey } from "./accountLifetime";

/** Where the folded projects are remembered, under the signed-in account's key. */
const COLLAPSED_STOPS_KEY = "zerops.sidebar.collapsedStops";

/**
 * Folds under the bare key belong to no account and are shared by every
 * account in the browser: the first account that reads them takes them over
 * (unless it has its own), and the bare key is removed.
 */
function takeUnscopedFolds(): void {
  const unscoped = window.localStorage.getItem(COLLAPSED_STOPS_KEY);
  if (unscoped === null) return;
  if (accountLocalStorage.getItem(COLLAPSED_STOPS_KEY) === null) {
    accountLocalStorage.setItem(COLLAPSED_STOPS_KEY, unscoped);
  }
  window.localStorage.removeItem(COLLAPSED_STOPS_KEY);
}

/**
 * The projects whose stops the signed-in account folded away last time.
 *
 * Storage can throw outright (a private window, blocked site data) and can
 * hold anything at all, so a bad read is an empty set rather than a crash on
 * boot — the menu unfolded is the safe wrong answer. With no account open
 * there is nothing to read.
 */
export function readCollapsedStops(): ReadonlySet<string> {
  try {
    if (accountStorageKey(COLLAPSED_STOPS_KEY) === null) return new Set();
    takeUnscopedFolds();
    const raw = accountLocalStorage.getItem(COLLAPSED_STOPS_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

export function writeCollapsedStops(collapsed: ReadonlySet<string>): void {
  try {
    accountLocalStorage.setItem(COLLAPSED_STOPS_KEY, JSON.stringify([...collapsed]));
  } catch {
    // A menu that cannot remember its folds still works; one that throws on a
    // fold does not.
  }
}
