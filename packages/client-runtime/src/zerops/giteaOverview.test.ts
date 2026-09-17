import { describe, expect, it } from "vite-plus/test";

import type { GiteaIssueSearchHit, GiteaRepository } from "./giteaClient.ts";
import { giteaOverview, giteaPullRequestLine, giteaRepositoryLine } from "./giteaOverview.ts";

function repo(fullName: string, overrides: Partial<GiteaRepository> = {}): GiteaRepository {
  const [owner, name] = fullName.split("/") as [string, string];
  return {
    id: fullName.length,
    name,
    full_name: fullName,
    default_branch: "main",
    html_url: `https://gitea.example/${fullName}`,
    owner: { login: owner },
    updated_at: "2026-09-17T10:00:00Z",
    ...overrides,
  };
}

function hit(
  fullName: string,
  number: number,
  overrides: Partial<GiteaIssueSearchHit> = {},
): GiteaIssueSearchHit {
  const [owner, name] = fullName.split("/") as [string, string];
  return {
    number,
    title: `Change ${number}`,
    state: "open",
    html_url: `https://gitea.example/${fullName}/pulls/${number}`,
    user: { login: "mate-abc" },
    updated_at: `2026-09-17T1${number}:00:00Z`,
    repository: { name, owner, full_name: fullName },
    ...overrides,
  };
}

describe("the Gitea overview", () => {
  it("groups the repositories by owner, and each pull request under its repository", () => {
    const overview = giteaOverview({
      repositories: [repo("todo/group"), repo("todo/appdev"), repo("crm/api")],
      pulls: [hit("todo/appdev", 4), hit("todo/appdev", 5), hit("crm/api", 1)],
    });
    expect(overview.map((owner) => owner.owner)).toEqual(["crm", "todo"]);
    const todo = overview[1];
    expect(todo?.repositories.map((entry) => entry.name)).toEqual(["appdev", "group"]);
    expect(todo?.repositories[0]?.pulls.map((entry) => entry.number)).toEqual([5, 4]);
    expect(todo?.repositories[1]?.pulls).toEqual([]);
  });

  it("keeps a pull request whose repository the list did not carry, under its owner", () => {
    const overview = giteaOverview({
      repositories: [repo("todo/group")],
      pulls: [hit("todo/appdev", 4)],
    });
    expect(overview[0]?.repositories.map((entry) => entry.name)).toEqual(["appdev", "group"]);
    expect(overview[0]?.repositories[0]?.url).toBeUndefined();
  });

  it("drops a pull request that names no repository, which nothing could file it under", () => {
    const overview = giteaOverview({
      repositories: [repo("todo/group")],
      pulls: [hit("todo/group", 1, { repository: undefined })],
    });
    expect(overview[0]?.repositories[0]?.pulls).toEqual([]);
  });

  it("counts the open pull requests per owner", () => {
    const overview = giteaOverview({
      repositories: [repo("todo/group"), repo("todo/appdev")],
      pulls: [hit("todo/appdev", 4), hit("todo/group", 6)],
    });
    expect(overview[0]?.openPulls).toBe(2);
  });

  it("is empty for an account with nothing", () => {
    expect(giteaOverview({ repositories: [], pulls: [] })).toEqual([]);
  });

  it("says who opened a pull request and its number, once", () => {
    expect(giteaPullRequestLine({ number: 4, author: "mate-abc" })).toBe("#4 · mate-abc");
    expect(giteaPullRequestLine({ number: 4, author: undefined })).toBe("#4");
  });

  it.each([
    [0, "No open pull request"],
    [1, "1 open pull request"],
    [2, "2 open pull requests"],
  ])("counts %i open pull requests as a line", (count, expected) => {
    expect(giteaRepositoryLine(count)).toBe(expected);
  });
});
