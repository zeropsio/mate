/**
 * The Git page's overview — every application this person may read the changes of, its
 * repositories and the changes open on each (SPEC §5.3, main's footer *Git*, D26).
 *
 * Not a project's flow: that is `projectFlow.ts`, one application at a time. This is the
 * account-wide answer to "what is open, anywhere I can see", from what HQ says: each
 * application's repositories (`GET /api/apps/:appId/repos`) and the changes open in them, down its
 * stream.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module gitOverview
 */

import { byNewest, changeState, type FlowPullRequest } from "./projectFlow.ts";

/** An open change on a repository's row: the flow's own, and its number with its Mate's name. */
export interface GitOverviewChange {
  readonly pull: FlowPullRequest;
  /** `#4 · Vera`; `#4` where the Mate cannot be named. */
  readonly line: string;
  readonly status: ReturnType<typeof changeState>;
}

export interface GitOverviewRepository {
  readonly name: string;
  readonly changes: ReadonlyArray<GitOverviewChange>;
  readonly coverage: "complete" | "unread" | "failed";
  /** Included in Open changes: unknown coverage is not a quiet repository. */
  readonly open: boolean;
}

export interface GitOverviewApp {
  readonly appId: string;
  readonly name: string;
  readonly repositories: ReadonlyArray<GitOverviewRepository>;
}

/** `2 open changes` — a repository's one line. */
export function gitRepositoryLine(open: number): string {
  if (open === 0) return "No open change";
  return open === 1 ? "1 open change" : `${String(open)} open changes`;
}

function byName(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

/**
 * Applications, their repositories and the changes open on each — every level in name order, the
 * changes newest first. A change whose repository the list did not carry still gets a row under
 * its application: HQ's stream said it as the person, so they may see it, and a page that
 * dropped it would be quieter than HQ.
 */
export function gitOverview(input: {
  readonly apps: ReadonlyArray<{
    readonly appId: string;
    readonly name: string;
    /** Its repositories, as HQ listed them. */
    readonly repositories: ReadonlyArray<{ readonly name: string }>;
    /** Its open changes, as HQ's stream says them. */
    readonly changes: ReadonlyArray<FlowPullRequest>;
    readonly coverage?: "complete" | "unread" | "failed";
  }>;
  /** A Mate's name by its project. */
  readonly mateName: (projectId: string) => string | undefined;
}): ReadonlyArray<GitOverviewApp> {
  return [...input.apps]
    .sort((left, right) => byName(left.name, right.name))
    .map((app) => {
      const repositories = new Map<string, Array<GitOverviewChange>>(
        app.repositories.map((repository) => [repository.name, []]),
      );
      for (const pull of [...app.changes].sort(byNewest)) {
        const mate = input.mateName(pull.mateProjectId);
        const number = `#${String(pull.number)}`;
        const changes = repositories.get(pull.repository) ?? [];
        repositories.set(pull.repository, changes);
        changes.push({
          pull,
          line: mate === undefined ? number : `${number} · ${mate}`,
          status: pull.merged ? { word: "Merged", tone: "off" } : changeState(pull),
        });
      }
      return {
        appId: app.appId,
        name: app.name,
        repositories: [...repositories]
          .sort(([left], [right]) => byName(left, right))
          .map(([name, changes]) => ({
            name,
            changes,
            coverage: app.coverage ?? "complete",
            open:
              (app.coverage !== undefined && app.coverage !== "complete") ||
              changes.some(({ pull }) => pull.state === "open"),
          })),
      };
    });
}

export type GitOverviewView = "open" | "all";

/** Presentation memory holds identities only; every displayed fact comes from today's projection. */
export interface GitOverviewIdentity {
  readonly appId: string;
  readonly repository: string;
  readonly changes: ReadonlyArray<number>;
}

export function gitOverviewPresentation(
  apps: ReadonlyArray<GitOverviewApp>,
  view: GitOverviewView,
  held?: ReadonlyArray<GitOverviewIdentity>,
) {
  const available = apps.flatMap((app) =>
    app.repositories.map((repository) => ({ app, repository })),
  );
  const key = (appId: string, repository: string) => JSON.stringify([appId, repository]);
  const byIdentity = new Map(
    available.map((row) => [key(row.app.appId, row.repository.name), row]),
  );
  const current = available
    .filter(({ repository }) => view === "all" || repository.open)
    .map(({ app, repository }) => ({
      appId: app.appId,
      repository: repository.name,
      changes: repository.changes
        .filter(({ pull }) => pull.state === "open")
        .map(({ pull }) => pull.number),
    }));
  const identities = (held ?? current).flatMap((identity) => {
    const row = byIdentity.get(key(identity.appId, identity.repository));
    return row === undefined
      ? []
      : [
          {
            ...identity,
            changes: identity.changes.filter((number) =>
              row.repository.changes.some(({ pull }) => pull.number === number),
            ),
          },
        ];
  });
  const rows = identities.flatMap((identity) => {
    const row = byIdentity.get(key(identity.appId, identity.repository));
    return row === undefined
      ? []
      : [
          {
            appId: row.app.appId,
            project: row.app.name,
            ...row.repository,
            changes: identity.changes.flatMap((number) =>
              row.repository.changes.filter(({ pull }) => pull.number === number),
            ),
          },
        ];
  });
  // Compare membership, not sort order: renames update in place without asking for a refresh.
  const membership = (values: ReadonlyArray<GitOverviewIdentity>) =>
    values
      .map(({ appId, repository, changes }) =>
        JSON.stringify([appId, repository, [...changes].sort((a, b) => a - b)]),
      )
      .sort()
      .join("|");
  return {
    identities,
    rows,
    changed: membership(identities) !== membership(current),
    openChanges: rows.reduce(
      (count, row) => count + row.changes.filter(({ pull }) => pull.state === "open").length,
      0,
    ),
    incomplete: apps.some((app) =>
      app.repositories.some((repository) => repository.coverage !== "complete"),
    ),
  };
}
