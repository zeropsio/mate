import { expect, it } from "vite-plus/test";
import { codeSize, gitChangesSummary, gitOverview, gitOverviewGroups } from "./gitOverview.ts";
import { changeState, type FlowPullRequest } from "./projectFlow.ts";
import type { CodeStanding } from "./codeStanding.ts";

const pull = (
  repository: string,
  number: number,
  mergeability: "mergeable" | "conflicting" = "mergeable",
): FlowPullRequest => ({
  repository,
  number,
  title: "Change",
  kind: "code",
  mateProjectId: "m1",
  url: undefined,
  mergeability,
  behind: false,
  merged: false,
  mergedAt: undefined,
  state: "open",
  headSha: undefined,
  baseBranch: "main",
  line: "",
  updatedAt: `2026-11-2${number}T00:00:00Z`,
  ready: true,
});
const repo = (name: string) => ({ name, updatedAt: "2026-11-20T00:00:00Z" });
const standingOf = (id: string): CodeStanding =>
  id === "a"
    ? { kind: "in-use", mate: true, leaving: false }
    : { kind: "kept", holds: id === "b" ? "code" : "setup" };

// witness: packages/client-runtime/src/zerops/gitOverview.ts | repository.usedBytes !== undefined → true
it("ZV185: A project's code size is the sum of its repositories' sizes, its setup repository included, and is said only when HQ gave a size for every one of them; breaks: a project with a repository HQ has not sized reads smaller than it is", () => {
  expect(codeSize([{ usedBytes: 1024 }, { usedBytes: 2048 }])).toEqual({
    bytes: 3072,
    complete: true,
  });
  expect(codeSize([{ usedBytes: 1024 }, {}])).toEqual({ bytes: 1024, complete: false });
  expect(codeSize([])).toEqual({ bytes: 0, complete: true });
  const apps = gitOverview({
    mateName: () => undefined,
    apps: [
      {
        appId: "a",
        name: "A",
        changes: [],
        repositories: [
          { ...repo("group"), usedBytes: 512 },
          { ...repo("one"), usedBytes: 1024 },
          { ...repo("two"), usedBytes: 2048 },
        ],
      },
    ],
  });
  expect(gitOverviewGroups(apps, standingOf, false).used[0]?.size).toEqual({
    bytes: 3584,
    complete: true,
  });
});

// witness: packages/client-runtime/src/zerops/gitOverview.ts | !listed.has(question.appId) → listed.has(question.appId)
it("ZV186: Every open kept-code question has a group on the Git overview, the listed project's own or one made from the question when the project is not listed; breaks: an Owner cannot answer a question about a project whose changes HQ does not offer them", () => {
  const apps = gitOverview({
    mateName: () => undefined,
    apps: [
      { appId: "a", name: "A", repositories: [repo("one")], changes: [] },
      { appId: "b", name: "B", repositories: [repo("two")], changes: [] },
    ],
  });
  const standing = (id: string): CodeStanding =>
    id === "b" ? { kind: "asked" } : { kind: "in-use", mate: true, leaving: false };
  const questions = [
    { appId: "b", appName: "B" },
    { appId: "c", appName: "gamma" },
  ];
  const groups = gitOverviewGroups(apps, standing, false, questions);
  expect(groups.used.map(({ name }) => name)).toEqual(["A"]);
  expect(
    groups.kept.map(({ name, standing, repositories }) => [
      name,
      standing.kind,
      repositories.length,
    ]),
  ).toEqual([
    ["B", "asked", 1],
    ["gamma", "asked", 0],
  ]);
  expect(gitOverviewGroups(apps, standing, false, []).kept.map(({ name }) => name)).toEqual(["B"]);
  expect(gitOverviewGroups(apps, standing, true, questions).kept.map(({ name }) => name)).toEqual([
    "B",
    "gamma",
  ]);
});

// witness: packages/client-runtime/src/zerops/gitOverview.ts | repository.name !== "group" → repository.name !== ""
it("ZV183: The Git overview lists each project once with its code repositories as rows and its setup repository as the group's link, puts kept, asked and placeless deleting projects in their own section, and showing only open changes hides a repository without one but never one whose changes are not read, while the counts stay those of the whole list; breaks: a project's setup repository is counted as code, or a repository with unread changes disappears under the filter", () => {
  const apps = gitOverview({
    mateName: () => undefined,
    apps: [
      { appId: "c", name: "C", repositories: [repo("group")], changes: [] },
      {
        appId: "a",
        name: "A",
        repositories: [repo("quiet"), repo("group"), repo("active")],
        changes: [pull("group", 1), pull("active", 2), pull("active", 3)],
      },
      { appId: "b", name: "B", repositories: [repo("unread")], changes: [], coverage: "unread" },
    ],
  });
  const all = gitOverviewGroups(apps, standingOf, false);
  expect(
    all.used.map(({ name, repositories, setup }) => [
      name,
      repositories.map(({ name }) => name),
      setup?.changes.length,
    ]),
  ).toEqual([["A", ["active", "quiet"], 1]]);
  expect(
    all.kept.map(({ name, repositories }) => [name, repositories.map(({ name }) => name)]),
  ).toEqual([
    ["B", ["unread"]],
    ["C", []],
  ]);
  expect([all.projects, all.repositories, all.openChanges, all.incomplete]).toEqual([
    3,
    3,
    3,
    true,
  ]);
  const open = gitOverviewGroups(apps, standingOf, true);
  expect(
    open.used.map(({ name, repositories }) => [name, repositories.map(({ name }) => name)]),
  ).toEqual([["A", ["active"]]]);
  expect(
    open.kept.map(({ name, repositories }) => [name, repositories.map(({ name }) => name)]),
  ).toEqual([["B", ["unread"]]]);
  expect([open.projects, open.repositories, open.openChanges]).toEqual([3, 3, 3]);
});

// witness: packages/client-runtime/src/zerops/gitOverview.ts | `${String(count)} ${word}` → word
it("ZV184: A repository's open changes are said as their count and each status with how many hold it, and nothing where none is open; breaks: a repository with a conflicting change reads the same as one ready to merge", () => {
  const ready = pull("app", 3);
  const conflict = pull("app", 2, "conflicting");
  const row = (change: FlowPullRequest) => ({
    pull: change,
    line: "",
    status: changeState(change),
  });
  expect(gitChangesSummary([])).toBeUndefined();
  expect(gitChangesSummary([row(ready)])).toBe("1 open change · Ready to merge");
  expect(gitChangesSummary([row(ready), row(pull("app", 1)), row(conflict)])).toBe(
    "3 open changes · 2 Ready to merge, 1 Conflicts with main",
  );
});
