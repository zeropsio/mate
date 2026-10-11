import { accountLocalStorage, accountStorageKey } from "./accountLifetime";

/**
 * Where the left menu's collapsed projects are remembered, under the signed-in
 * account's key. A new key, not the stops' fold's: that folded something else,
 * and a project a person had folded the stops of is not one they collapsed.
 */
const COLLAPSED_PROJECTS_KEY = "zerops.sidebar.collapsedProjects";

/** Where the projects the person opened against the many-projects default are remembered. */
const OPENED_PROJECTS_KEY = "zerops.sidebar.openedProjects";

/**
 * From this many projects the menu starts folded, each project its one line until its person
 * opens it (the owner, 2026-10-11: "I'd have them collapsed all by default, when you have like
 * 6+").
 */
export const FOLDED_FROM_PROJECTS = 6;

/** What the person chose of each project: folded, or opened against the default. */
export interface ProjectFolds {
  readonly closed: ReadonlySet<string>;
  readonly opened: ReadonlySet<string>;
}

/**
 * A set of project ids the signed-in account left under `key`.
 *
 * Storage can throw outright (a private window, blocked site data) and can
 * hold anything at all, so a bad read is an empty set rather than a crash on
 * boot. With no account open there is nothing to read.
 */
function readProjectSet(key: string): ReadonlySet<string> {
  try {
    if (accountStorageKey(key) === null) return new Set();
    const raw = accountLocalStorage.getItem(key);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

function writeProjectSet(key: string, projects: ReadonlySet<string>): void {
  try {
    accountLocalStorage.setItem(key, JSON.stringify([...projects]));
  } catch {
    // A menu that cannot remember what was folded still works; one that
    // throws on a fold does not.
  }
}

/** The groups the signed-in account collapsed in the left menu last time. */
export function readCollapsedProjects(): ReadonlySet<string> {
  return readProjectSet(COLLAPSED_PROJECTS_KEY);
}

export function writeCollapsedProjects(collapsed: ReadonlySet<string>): void {
  writeProjectSet(COLLAPSED_PROJECTS_KEY, collapsed);
}

/** The groups the signed-in account opened while the menu folds them by default. */
export function readOpenedProjects(): ReadonlySet<string> {
  return readProjectSet(OPENED_PROJECTS_KEY);
}

export function writeOpenedProjects(opened: ReadonlySet<string>): void {
  writeProjectSet(OPENED_PROJECTS_KEY, opened);
}

/** Whether a project is folded: as its person left it, else folded where the menu lists many. */
export function projectFolded(folds: ProjectFolds, groupId: string, projects: number): boolean {
  if (folds.closed.has(groupId)) return true;
  if (folds.opened.has(groupId)) return false;
  return projects >= FOLDED_FROM_PROJECTS;
}

/** The person's choice for one project, one choice per project; the same folds where unchanged. */
export function withProjectFold(folds: ProjectFolds, groupId: string, fold: boolean): ProjectFolds {
  const into = fold ? folds.closed : folds.opened;
  const from = fold ? folds.opened : folds.closed;
  if (into.has(groupId) && !from.has(groupId)) return folds;
  const nextInto = new Set(into).add(groupId);
  const nextFrom = new Set(from);
  nextFrom.delete(groupId);
  return fold ? { closed: nextInto, opened: nextFrom } : { closed: nextFrom, opened: nextInto };
}
