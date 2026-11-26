import { expect, it } from "vite-plus/test";
import {
  codeSize,
  gitChangesStatus,
  gitOverview,
  gitOverviewGroups,
  gitOverviewView,
} from "./gitOverview.ts";
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
  expect(gitOverviewGroups(apps, standingOf).groups[0]?.size).toEqual({
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
  const groups = gitOverviewGroups(apps, standing, questions);
  expect(gitOverviewView(groups, "all", "").projects.map(({ name }) => name)).toEqual(["A"]);
  expect(
    gitOverviewView(groups, "all", "").waiting.map(({ name, standing, repositories }) => [
      name,
      standing.kind,
      repositories.length,
    ]),
  ).toEqual([
    ["B", "asked", 1],
    ["gamma", "asked", 0],
  ]);
  expect(
    gitOverviewView(gitOverviewGroups(apps, standing, []), "all", "").waiting.map(
      ({ name }) => name,
    ),
  ).toEqual(["B"]);
});

// witness: packages/client-runtime/src/zerops/gitOverview.ts | standing.phase !== "going" → standing.phase === "going"
it("ZV183: The Git overview lists each project once with its code repositories as rows and its setup repository as the project's link, and places it by its standing: under Waiting when its question or a deletion that is not going waits on a person, under Kept code when it is kept or going with nothing placed, else under Projects; breaks: a project's setup repository is counted as code, or a deletion that stopped is listed as a project in use", () => {
  const apps = gitOverview({
    mateName: () => undefined,
    apps: [
      {
        appId: "a",
        name: "A",
        repositories: [repo("group"), repo("active"), repo("quiet")],
        changes: [pull("group", 1), pull("active", 2), pull("active", 3)],
      },
      { appId: "b", name: "B", repositories: [repo("old")], changes: [] },
      { appId: "c", name: "C", repositories: [], changes: [] },
      { appId: "d", name: "D", repositories: [repo("d1")], changes: [] },
      { appId: "e", name: "E", repositories: [], changes: [] },
      { appId: "f", name: "F", repositories: [repo("f1")], changes: [] },
      { appId: "g", name: "G", repositories: [], changes: [] },
    ],
  });
  const standing = (id: string): CodeStanding => {
    if (id === "a") return { kind: "in-use", mate: true, leaving: false };
    if (id === "b") return { kind: "kept", holds: "code" };
    if (id === "c") return { kind: "asked" };
    return {
      kind: "deleting",
      placed: id === "d" || id === "f",
      phase: id === "d" ? "failed" : id === "g" ? "needs" : "going",
    };
  };
  const overview = gitOverviewGroups(apps, standing);
  const view = gitOverviewView(overview, "all", "");
  expect(view.waiting.map(({ name }) => name)).toEqual(["C", "D", "G"]);
  expect(
    view.projects.map(({ name, repositories, setup }) => [
      name,
      repositories.map(({ name }) => name),
      setup?.changes.length,
    ]),
  ).toEqual([
    ["A", ["active", "quiet"], 1],
    ["F", ["f1"], undefined],
  ]);
  expect(view.kept.map(({ name }) => name)).toEqual(["B", "E"]);
  expect([
    overview.projects,
    overview.repositories,
    overview.openChanges,
    overview.keptCount,
  ]).toEqual([7, 5, 3, 4]);
});

// witness: packages/client-runtime/src/zerops/gitOverview.ts | open.some(({ status }) => status?.tone === tone) → open[0]?.status?.tone === tone
it("ZV184: A repository's open changes are said as their count, each status with how many hold it, and the tone of the worst of them, and nothing where none is open; breaks: a repository with a conflicting change among ready ones reads as calm as one ready to merge", () => {
  const row = (change: FlowPullRequest) => ({
    pull: change,
    line: "",
    status: changeState(change),
  });
  expect(gitChangesStatus([])).toBeUndefined();
  expect(gitChangesStatus([row(pull("app", 3))])).toEqual({
    open: 1,
    words: "Ready to merge",
    tone: "off",
  });
  expect(
    gitChangesStatus([
      row(pull("app", 3)),
      row(pull("app", 2)),
      row(pull("app", 1, "conflicting")),
    ]),
  ).toEqual({ open: 3, words: "2 Ready to merge, 1 Conflicts with main", tone: "attention" });
});

// witness: packages/client-runtime/src/zerops/gitOverview.ts | tab === "open" || → false ||
it("ZV+1: The Open changes tab keeps every project with an open change, cut to its repositories that have one or whose changes are not read, and the Kept code tab keeps exactly the projects nothing is placed in, while the counts stay those of the whole list; breaks: a repository with unread changes disappears under Open changes, or a kept project with an open change is missing from it", () => {
  const apps = gitOverview({
    mateName: () => undefined,
    apps: [
      {
        appId: "a",
        name: "A",
        repositories: [repo("active"), repo("quiet")],
        changes: [pull("active", 1)],
      },
      { appId: "b", name: "B", repositories: [repo("old")], changes: [pull("old", 2)] },
      { appId: "c", name: "C", repositories: [repo("unread")], changes: [], coverage: "unread" },
      { appId: "d", name: "D", repositories: [repo("group")], changes: [pull("group", 3)] },
      { appId: "e", name: "E", repositories: [], changes: [] },
    ],
  });
  const standing = (id: string): CodeStanding =>
    id === "e"
      ? { kind: "asked" }
      : id === "b" || id === "c"
        ? { kind: "kept", holds: "code" }
        : { kind: "in-use", mate: true, leaving: false };
  const overview = gitOverviewGroups(apps, standing);
  const open = gitOverviewView(overview, "open", "");
  expect(
    open.projects.map(({ name, repositories }) => [name, repositories.map(({ name }) => name)]),
  ).toEqual([
    ["A", ["active"]],
    ["B", ["old"]],
    ["C", ["unread"]],
    ["D", []],
  ]);
  expect([open.waiting, open.kept]).toEqual([[], []]);
  const kept = gitOverviewView(overview, "kept", "");
  expect(kept.waiting.map(({ name }) => name)).toEqual(["E"]);
  expect(kept.kept.map(({ name }) => name)).toEqual(["B", "C"]);
  expect(kept.projects).toEqual([]);
  expect([overview.openChanges, overview.keptCount]).toEqual([3, 3]);
});

// witness: packages/client-runtime/src/zerops/gitOverview.ts | repository.name.toLocaleLowerCase().includes(needle) → group.name.toLocaleLowerCase().includes(needle)
it("ZV+2: A search keeps a project whose name matches with all its repositories, else only its repositories whose names match, whatever the letters' case, and drops a project with neither; breaks: searching a repository's name hides it because its project's name does not match", () => {
  const apps = gitOverview({
    mateName: () => undefined,
    apps: [
      {
        appId: "a",
        name: "Acme Store",
        repositories: [repo("storefront"), repo("api")],
        changes: [],
      },
      {
        appId: "d",
        name: "Docs",
        repositories: [repo("handbook"), repo("store-notes")],
        changes: [],
      },
    ],
  });
  const overview = gitOverviewGroups(apps, () => ({ kind: "in-use", mate: true, leaving: false }));
  const rows = (query: string) =>
    gitOverviewView(overview, "all", query).projects.map(({ name, repositories }) => [
      name,
      repositories.map(({ name }) => name),
    ]);
  expect(rows("STORE")).toEqual([
    ["Acme Store", ["api", "storefront"]],
    ["Docs", ["store-notes"]],
  ]);
  expect(rows("api")).toEqual([["Acme Store", ["api"]]]);
  expect(rows("zzz")).toEqual([]);
  expect(rows("  ")).toEqual([
    ["Acme Store", ["api", "storefront"]],
    ["Docs", ["handbook", "store-notes"]],
  ]);
});
