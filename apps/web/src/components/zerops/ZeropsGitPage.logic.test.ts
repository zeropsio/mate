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
  repositories: [{ name: "appdev" }, { name: "group" }],
  failure: undefined,
  ...over,
});

const state = (input: { readonly apps: ReadonlyArray<GitPageApp>; readonly appsKnown?: boolean }) =>
  gitPageState({
    appsKnown: input.appsKnown ?? true,
    apps: input.apps,
    mateName: (projectId) => (projectId === "p-vera" ? "Vera" : undefined),
  });

describe("gitPageState — what the Git page says (SPEC §5.3)", () => {
  it("Unread changes remain visible in Open changes", () => {
    const said = state({ apps: [app({ changes: undefined })] });
    expect(said.kind === "read" && said.apps[0]?.repositories[0]).toMatchObject({
      name: "appdev",
      coverage: "unread",
      open: true,
    });
  });

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
    [
      "an application's repositories are on their way",
      { apps: [app({ repositories: undefined })] },
    ],
  ] as const)("waits visibly while %s", (_case, over) => {
    expect(state({ apps: [app()], ...over })).toEqual({ kind: "unread", failure: null });
  });

  it("keeps repository facts while that application's changes are still unread", () => {
    expect(state({ apps: [app({ changes: undefined })] })).toMatchObject({
      kind: "read",
      reading: true,
      apps: [{ repositories: [{ name: "appdev" }, { name: "group" }] }],
    });
  });

  it("lists a readable app while another permission is unresolved", () => {
    expect(state({ apps: [app(), app({ appId: "pending", read: undefined })] })).toMatchObject({
      kind: "read",
      reading: true,
      apps: [{ appId: "a-todo" }],
    });
  });

  it("explains a refused read instead of claiming there are no repositories", () => {
    expect(state({ apps: [app({ read: false })] })).toMatchObject({
      kind: "refused",
      reason: expect.stringContaining("Basic user"),
    });
  });

  it("names an application's unverified access alongside repositories already read", () => {
    expect(
      state({
        apps: [
          app(),
          app({
            appId: "unknown",
            name: "Unknown",
            read: false,
            readReason: "Project access has not been verified.",
          }),
        ],
      }),
    ).toMatchObject({
      kind: "read",
      refusals: [{ name: "Unknown", reason: "Project access has not been verified." }],
    });
  });
  it("uses the permission's reason when no application can be read", () => {
    expect(
      state({ apps: [app({ read: false, readReason: "Project access has not been verified." })] }),
    ).toMatchObject({ kind: "refused", reason: "Project access has not been verified." });
  });

  it("ends a failed changes read visibly even without repository facts", () => {
    expect(
      state({
        apps: [app({ changes: undefined, repositories: undefined, failure: "Read failed." })],
      }),
    ).toEqual({
      kind: "unread",
      failure: "Todo: Read failed.",
    });
  });

  // Main's Gitea read rule (`read_change`): an application listed to the person whose changes are
  // not is not on this page, and is not waited on.
  it("leaves out an application whose changes the person may not read", () => {
    const said = state({
      apps: [app(), app({ appId: "a-crm", name: "CRM", read: false })],
    });
    expect(said.kind === "read" && said.apps.map((entry) => entry.name)).toEqual(["Todo"]);
  });

  // E2E 2026-10-03 (F5): an application a stopped press left with no project stays listed here,
  // with the repository HQ made for it, as the projects page now draws it too.
  it("keeps listing an application with no project, and its repository", () => {
    const said = state({
      apps: [
        app(),
        app({
          appId: "a-e2e",
          name: "mate-rig-e2e-a",
          changes: [],
          repositories: [{ name: "group" }],
        }),
      ],
    });
    expect(said.kind === "read" && said.apps.map((entry) => entry.name)).toEqual([
      "mate-rig-e2e-a",
      "Todo",
    ]);
  });

  it("names why a read did not answer, beside what was read", () => {
    const said = state({
      apps: [
        app(),
        app({
          appId: "a-crm",
          name: "CRM",
          repositories: undefined,
          failure: "HQ is not answering right now.",
        }),
      ],
    });
    expect(said).toMatchObject({ kind: "read", failure: "CRM: HQ is not answering right now." });
    expect(said.kind === "read" && said.apps.map((entry) => entry.name)).toEqual(["Todo"]);
  });

  it("names why it did not answer instead of an empty page, before anything was read", () => {
    expect(
      state({
        apps: [app({ repositories: undefined, failure: "HQ is not answering right now." })],
      }),
    ).toEqual({ kind: "unread", failure: "Todo: HQ is not answering right now." });
  });

  // The flow reads every application's releases and repositories, the ones the page leaves out
  // too: why one of those did not answer is not this page's to say.
  it("names no failure of an application whose changes the person may not read", () => {
    const said = state({
      apps: [
        app(),
        app({
          appId: "a-crm",
          name: "CRM",
          read: false,
          repositories: undefined,
          failure: "You can't see this application's changes.",
        }),
      ],
    });
    expect(said).toMatchObject({ kind: "read", failure: null });
  });
});
