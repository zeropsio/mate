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
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { CodeStanding } from "./codeStanding.ts";

export type GitRepositoryFacts = Pick<
  RepoListEntry,
  "remote" | "follows" | "updatedAt" | "usedBytes"
>;

/** An open change on a repository's row: the flow's own, and its number with its Mate's name. */
export interface GitOverviewChange {
  readonly pull: FlowPullRequest;
  /** `#4 · Vera`; `#4` where the Mate cannot be named. */
  readonly line: string;
  readonly status: ReturnType<typeof changeState>;
}

export interface GitOverviewRepository {
  readonly name: string;
  readonly facts?: GitRepositoryFacts | undefined;
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
    readonly repositories: ReadonlyArray<{ readonly name: string } & GitRepositoryFacts>;
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
      const facts = new Map(
        app.repositories.map(({ name, remote, follows, updatedAt, usedBytes }) => [
          name,
          {
            ...(remote === undefined ? {} : { remote }),
            ...(follows === undefined ? {} : { follows }),
            ...(usedBytes === undefined ? {} : { usedBytes }),
            updatedAt,
          },
        ]),
      );
      for (const pull of [...app.changes].sort(byNewest)) {
        const mate = input.mateName(pull.mateProjectId);
        const number = `#${String(pull.number)}`;
        const changes = repositories.get(pull.repository) ?? [];
        repositories.set(pull.repository, changes);
        changes.push({
          pull,
          line: mate === undefined ? number : `${number} · ${mate}`,
          status: changeState(pull),
        });
      }
      return {
        appId: app.appId,
        name: app.name,
        repositories: [...repositories]
          .sort(([left], [right]) => byName(left, right))
          .map(([name, changes]) => ({
            name,
            facts: facts.get(name),
            changes,
            coverage: app.coverage ?? "complete",
            open:
              (app.coverage !== undefined && app.coverage !== "complete") ||
              changes.some(({ pull }) => pull.state === "open"),
          })),
      };
    });
}

/** Sum known figures, and say whether HQ supplied every repository's figure. */
export function codeSize(repositories: ReadonlyArray<{ readonly usedBytes?: number | undefined }>) {
  return {
    bytes: repositories.reduce((sum, repository) => sum + (repository.usedBytes ?? 0), 0),
    complete: repositories.every((repository) => repository.usedBytes !== undefined),
  };
}

/** Each project's setup is its header link, never a code-repository row. */
export function gitOverviewGroups(
  apps: ReadonlyArray<GitOverviewApp>,
  standingOf: (appId: string) => CodeStanding,
  openOnly: boolean,
) {
  const groups = [...apps]
    .sort((a, b) => byName(a.name, b.name))
    .map((app) => {
      const standing = standingOf(app.appId);
      const setup = app.repositories.find((repository) => repository.name === "group");
      const repositories = app.repositories.filter((repository) => repository.name !== "group");
      const size = codeSize(app.repositories.map((repository) => repository.facts ?? {}));
      return { ...app, standing, setup, repositories, repositoryCount: repositories.length, size };
    });
  const shown = groups.flatMap((group) => {
    const repositories = openOnly
      ? group.repositories.filter((repository) => repository.open)
      : group.repositories;
    const setupOpen = group.setup?.changes.some(({ pull }) => pull.state === "open") === true;
    return openOnly && repositories.length === 0 && !setupOpen ? [] : [{ ...group, repositories }];
  });
  const isKept = ({ standing }: (typeof groups)[number]) =>
    standing.kind === "kept" ||
    standing.kind === "asked" ||
    (standing.kind === "deleting" && !standing.placed);
  return {
    used: shown.filter((group) => !isKept(group)),
    kept: shown.filter(isKept),
    projects: groups.length,
    repositories: groups.reduce((count, group) => count + group.repositories.length, 0),
    openChanges: apps.reduce(
      (count, app) =>
        count +
        app.repositories.reduce(
          (sum, repository) =>
            sum + repository.changes.filter(({ pull }) => pull.state === "open").length,
          0,
        ),
      0,
    ),
    incomplete: apps.some((app) =>
      app.repositories.some((repository) => repository.coverage !== "complete"),
    ),
  };
}

/** Open-change count and status words, in the changes' newest-first order. */
export function gitChangesSummary(changes: ReadonlyArray<GitOverviewChange>): string | undefined {
  const open = changes.filter(({ pull }) => pull.state === "open");
  if (open.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const { status } of open)
    if (status !== undefined) counts.set(status.word, (counts.get(status.word) ?? 0) + 1);
  const statuses = [...counts]
    .map(([word, count]) => (open.length === 1 ? word : `${String(count)} ${word}`))
    .join(", ");
  return `${String(open.length)} open ${open.length === 1 ? "change" : "changes"}${statuses ? ` · ${statuses}` : ""}`;
}
