import { accountLocalStorage, accountStorageKey } from "./accountLifetime";

/**
 * Where the left menu's collapsed projects are remembered, under the signed-in
 * account's key. A new key, not the stops' fold's: that folded something else,
 * and a project a person had folded the stops of is not one they collapsed.
 */
const COLLAPSED_PROJECTS_KEY = "zerops.sidebar.collapsedProjects";

/**
 * The groups the signed-in account collapsed in the left menu last time.
 *
 * Storage can throw outright (a private window, blocked site data) and can
 * hold anything at all, so a bad read is an empty set rather than a crash on
 * boot — every project expanded is the safe wrong answer. With no account open
 * there is nothing to read.
 */
export function readCollapsedProjects(): ReadonlySet<string> {
  try {
    if (accountStorageKey(COLLAPSED_PROJECTS_KEY) === null) return new Set();
    const raw = accountLocalStorage.getItem(COLLAPSED_PROJECTS_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

export function writeCollapsedProjects(collapsed: ReadonlySet<string>): void {
  try {
    accountLocalStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify([...collapsed]));
  } catch {
    // A menu that cannot remember what was collapsed still works; one that
    // throws on a collapse does not.
  }
}
