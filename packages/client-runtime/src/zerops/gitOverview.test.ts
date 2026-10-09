import { describe, expect, it } from "vite-plus/test";

import { gitOverview, gitOverviewPresentation, gitRepositoryLine } from "./gitOverview.ts";
import type { FlowPullRequest } from "./projectFlow.ts";

/** An open change of `repository`, as HQ's stream says it, moved at hour `hour`. */
function change(repository: string, number: number, hour = number): FlowPullRequest {
  return {
    repository,
    number,
    title: `Change ${number}`,
    kind: "code",
    mateProjectId: "p-vera",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    state: "open",
    headSha: "abc",
    baseBranch: "main",
    line: `${repository} #${number}`,
    updatedAt: `2026-10-02T${String(hour).padStart(2, "0")}:00:00Z`,
  };
}

const VERA = (projectId: string) => (projectId === "p-vera" ? "Vera" : undefined);

describe("the Git page's overview (SPEC §5.3)", () => {
  it("lists each application by name, its repositories by name, their changes newest first", () => {
    const overview = gitOverview({
      apps: [
        {
          appId: "a-todo",
          name: "Todo",
          repositories: [{ name: "group" }, { name: "appdev" }],
          changes: [change("appdev", 4), change("appdev", 5)],
        },
        { appId: "a-crm", name: "CRM", repositories: [{ name: "api" }], changes: [] },
      ],
      mateName: VERA,
    });
    expect(overview.map((app) => app.name)).toEqual(["CRM", "Todo"]);
    const todo = overview[1];
    expect(todo?.repositories.map((repository) => repository.name)).toEqual(["appdev", "group"]);
    expect(todo?.repositories[0]?.changes.map((entry) => entry.pull.number)).toEqual([5, 4]);
    expect(todo?.repositories[1]?.changes).toEqual([]);
  });

  // HQ's stream said it as the person, so they may see it: a page that dropped it would be
  // quieter than HQ.
  it("keeps a change whose repository the list did not carry, under its application", () => {
    const [app] = gitOverview({
      apps: [
        {
          appId: "a-todo",
          name: "Todo",
          repositories: [{ name: "group" }],
          changes: [change("appdev", 4)],
        },
      ],
      mateName: VERA,
    });
    expect(app?.repositories.map((repository) => repository.name)).toEqual(["appdev", "group"]);
  });

  it("names each change by its number and its Mate, under its repository's row", () => {
    const [app] = gitOverview({
      apps: [
        {
          appId: "a-todo",
          name: "Todo",
          repositories: [{ name: "appdev" }],
          changes: [change("appdev", 4), { ...change("appdev", 6), mateProjectId: "p-gone" }],
        },
      ],
      mateName: VERA,
    });
    expect(app?.repositories[0]?.changes.map((entry) => entry.line)).toEqual(["#6", "#4 · Vera"]);
  });

  it.each([
    [0, "No open change"],
    [1, "1 open change"],
    [3, "3 open changes"],
  ])("says a repository with %i open as %s", (open, line) => {
    expect(gitRepositoryLine(open)).toBe(line);
  });
});

describe("Git overview presentation", () => {
  it.each(["unread", "failed"] as const)(
    "A repository with %s coverage is not a quiet repository",
    (coverage) => {
      const apps = gitOverview({
        apps: [
          { appId: "todo", name: "Todo", repositories: [{ name: "group" }], changes: [], coverage },
        ],
        mateName: VERA,
      });
      const presentation = gitOverviewPresentation(apps, "open");
      expect(presentation.rows.map(({ name }) => name)).toEqual(["group"]);
      expect(presentation.incomplete).toBe(true);
    },
  );
  it("New changes wait for Update list while displayed changes take current facts", () => {
    const overview = (changes: ReadonlyArray<FlowPullRequest>) =>
      gitOverview({
        apps: [{ appId: "todo", name: "Todo", repositories: [{ name: "appdev" }], changes }],
        mateName: VERA,
      });
    const initial = gitOverviewPresentation(overview([change("appdev", 4)]), "open");
    const apps = overview([
      change("appdev", 5),
      { ...change("appdev", 4), title: "Current title" },
    ]);
    const held = gitOverviewPresentation(apps, "open", initial.identities);
    expect(held.rows[0]?.changes.map(({ pull }) => [pull.number, pull.title])).toEqual([
      [4, "Current title"],
    ]);
    expect(held.changed).toBe(true);
    expect(
      gitOverviewPresentation(apps, "open").rows[0]?.changes.map(({ pull }) => pull.number),
    ).toEqual([5, 4]);
  });
});
