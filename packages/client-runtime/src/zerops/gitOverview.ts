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

import { byNewest, type FlowPullRequest } from "./projectFlow.ts";

/** An open change on a repository's row: the flow's own, and its number with its Mate's name. */
export interface GitOverviewChange {
  readonly pull: FlowPullRequest;
  /** `#4 · Vera`; `#4` where the Mate cannot be named. */
  readonly line: string;
}

export interface GitOverviewRepository {
  readonly name: string;
  readonly changes: ReadonlyArray<GitOverviewChange>;
}

export interface GitOverviewApp {
  readonly appId: string;
  readonly name: string;
  readonly repositories: ReadonlyArray<GitOverviewRepository>;
}

/** `2 open pull requests` — a repository's one line. */
export function gitRepositoryLine(open: number): string {
  if (open === 0) return "No open pull request";
  return open === 1 ? "1 open pull request" : `${String(open)} open pull requests`;
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
        changes.push({ pull, line: mate === undefined ? number : `${number} · ${mate}` });
      }
      return {
        appId: app.appId,
        name: app.name,
        repositories: [...repositories]
          .sort(([left], [right]) => byName(left, right))
          .map(([name, changes]) => ({ name, changes })),
      };
    });
}
