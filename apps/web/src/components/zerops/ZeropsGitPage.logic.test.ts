/**
 * What the Git page says, from what HQ has answered: nothing until every application the person
 * may read has its repositories and its changes known, a read that failed named beside whatever
 * was read, and an application whose changes HQ's rule keeps from them left out.
 */
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import { gitPageState, type GitPageApp } from "./ZeropsGitPage.logic";

const OPEN: FlowPullRequest = {
  repository: "appdev",
  number: 4,
  title: "Add a due date to each todo",
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
  line: "appdev #4",
  updatedAt: "2026-10-02T09:00:00Z",
};

const app = (over: Partial<GitPageApp> = {}): GitPageApp => ({
  appId: "a-todo",
  name: "Todo",
  read: true,
  changes: [OPEN],
  ...over,
});

const state = (input: {
  readonly apps: ReadonlyArray<GitPageApp>;
  readonly repos?: ReadonlyMap<string, ReadonlyArray<{ readonly name: string }>>;
  readonly failures?: ReadonlyMap<string, string>;
  readonly appsKnown?: boolean;
}) =>
  gitPageState({
    appsKnown: input.appsKnown ?? true,
    apps: input.apps,
    repos: input.repos ?? new Map([["a-todo", [{ name: "appdev" }, { name: "group" }]]]),
    failures: input.failures ?? new Map(),
    mateName: (projectId) => (projectId === "p-vera" ? "Vera" : undefined),
  });

describe("gitPageState — what the Git page says (SPEC §5.3)", () => {
  it("lays out each application's repositories and the changes open on them", () => {
    const said = state({ apps: [app()] });
    expect(said.kind).toBe("read");
    if (said.kind !== "read") return;
    expect(said.apps.map((entry) => entry.name)).toEqual(["Todo"]);
    expect(said.apps[0]?.repositories.map((repository) => repository.name)).toEqual([
      "appdev",
      "group",
    ]);
    expect(said.apps[0]?.repositories[0]?.changes.map((change) => change.line)).toEqual([
      "#4 · Vera",
    ]);
    expect(said.failure).toBeNull();
  });

  it.each([
    ["the applications are not known yet", { appsKnown: false }],
    ["HQ's rule has not been asked", { apps: [app({ read: undefined })] }],
    ["an application's repositories are on their way", { repos: new Map() }],
    ["an application's changes are not told yet", { apps: [app({ changes: undefined })] }],
  ] as const)("says nothing while %s", (_case, over) => {
    expect(state({ apps: [app()], ...over })).toEqual({ kind: "unread", failure: null });
  });

  // Main's Gitea read rule (`read_change`): an application listed to the person whose changes are
  // not is not on this page, and is not waited on.
  it("leaves out an application whose changes the person may not read", () => {
    const said = state({
      apps: [app(), app({ appId: "a-crm", name: "CRM", read: false })],
    });
    expect(said.kind === "read" && said.apps.map((entry) => entry.name)).toEqual(["Todo"]);
  });

  it("names why a read did not answer, beside what was read", () => {
    const said = state({
      apps: [app(), app({ appId: "a-crm", name: "CRM" })],
      failures: new Map([["a-crm", "HQ is not answering right now."]]),
    });
    expect(said).toMatchObject({ kind: "read", failure: "HQ is not answering right now." });
    expect(said.kind === "read" && said.apps.map((entry) => entry.name)).toEqual(["Todo"]);
  });

  it("names why it did not answer instead of an empty page, before anything was read", () => {
    expect(
      state({
        apps: [app()],
        repos: new Map(),
        failures: new Map([["a-todo", "HQ is not answering right now."]]),
      }),
    ).toEqual({ kind: "unread", failure: "HQ is not answering right now." });
  });
});
