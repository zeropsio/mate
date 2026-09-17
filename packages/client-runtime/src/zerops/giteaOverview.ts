/**
 * The Gitea overview — every repository this person can reach and the pull
 * requests open on it, the way the footer's Gitea button shows them
 * (spec §10.11, D26).
 *
 * Not a project's flow: that is `projectFlow.ts`, one group at a time. This
 * is the account-wide answer to "what is open, anywhere I can see", read
 * from Gitea's two account-wide lists — the repositories the person has
 * access to and a search over the pull requests open in them — and grouped
 * by owner, which in this product is a project's org.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module giteaOverview
 */

import type { GiteaIssueSearchHit, GiteaRepository } from "./giteaClient.ts";

export interface GiteaOverviewPullRequest {
  readonly number: number;
  readonly title: string;
  readonly author: string | undefined;
  readonly url: string | undefined;
  readonly updatedAt: string | undefined;
  /** `#4 · mate-abc` */
  readonly line: string;
}

export interface GiteaOverviewRepository {
  readonly name: string;
  readonly fullName: string;
  /** The repository's page in Gitea; absent for one the list did not carry. */
  readonly url: string | undefined;
  readonly pulls: ReadonlyArray<GiteaOverviewPullRequest>;
}

export interface GiteaOverviewOwner {
  readonly owner: string;
  readonly repositories: ReadonlyArray<GiteaOverviewRepository>;
  /** How many pull requests are open across the owner's repositories. */
  readonly openPulls: number;
}

/** `2 open pull requests` — a repository's one line. */
export function giteaRepositoryLine(openPulls: number): string {
  if (openPulls === 0) return "No open pull request";
  return openPulls === 1 ? "1 open pull request" : `${openPulls} open pull requests`;
}

/** `#4 · ada` — who is waiting, and on what number. */
export function giteaPullRequestLine(pull: {
  readonly number: number;
  readonly author: string | undefined;
}): string {
  return pull.author === undefined ? `#${pull.number}` : `#${pull.number} · ${pull.author}`;
}

function byName(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function byNewest(left: GiteaOverviewPullRequest, right: GiteaOverviewPullRequest): number {
  return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || right.number - left.number;
}

/**
 * Owners, their repositories and the pull requests open on each — every
 * level in name order, the pull requests newest first.
 *
 * A pull request whose repository the access list did not carry still gets
 * a row under its owner: the search answered as the person, so they can see
 * it, and a page that dropped it would be quieter than Gitea. One that names
 * no repository at all has nowhere to go and is left out.
 */
export function giteaOverview(input: {
  readonly repositories: ReadonlyArray<GiteaRepository>;
  readonly pulls: ReadonlyArray<GiteaIssueSearchHit>;
}): ReadonlyArray<GiteaOverviewOwner> {
  const repositories = new Map<
    string,
    { url: string | undefined; pulls: Array<GiteaOverviewPullRequest> }
  >();
  for (const repository of input.repositories) {
    repositories.set(repository.full_name, { url: repository.html_url, pulls: [] });
  }
  for (const hit of input.pulls) {
    const fullName = hit.repository?.full_name;
    if (fullName === undefined) continue;
    const entry = repositories.get(fullName) ?? { url: undefined, pulls: [] };
    repositories.set(fullName, entry);
    const author = hit.user?.login;
    entry.pulls.push({
      number: hit.number,
      title: hit.title,
      author,
      url: hit.html_url,
      updatedAt: hit.updated_at,
      line: giteaPullRequestLine({ number: hit.number, author }),
    });
  }

  const owners = new Map<string, Array<GiteaOverviewRepository>>();
  for (const [fullName, entry] of repositories) {
    const slash = fullName.indexOf("/");
    const owner = slash === -1 ? fullName : fullName.slice(0, slash);
    const name = slash === -1 ? fullName : fullName.slice(slash + 1);
    const list = owners.get(owner) ?? [];
    owners.set(owner, list);
    list.push({ name, fullName, url: entry.url, pulls: [...entry.pulls].sort(byNewest) });
  }

  return [...owners.entries()]
    .sort(([left], [right]) => byName(left, right))
    .map(([owner, list]) => {
      const sorted = [...list].sort((left, right) => byName(left.name, right.name));
      return {
        owner,
        repositories: sorted,
        openPulls: sorted.reduce((count, repository) => count + repository.pulls.length, 0),
      };
    });
}
