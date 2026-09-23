import type { GiteaOverviewOwner } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsGiteaOverview, type ZeropsGiteaOverviewState } from "./ZeropsGiteaPage";

const OWNERS: ReadonlyArray<GiteaOverviewOwner> = [
  {
    owner: "todo",
    openPulls: 1,
    repositories: [
      {
        name: "appdev",
        fullName: "todo/appdev",
        url: "https://gitea.example/todo/appdev",
        pulls: [
          {
            number: 4,
            title: "Add a due date to each todo",
            author: "Vera",
            mateProjectId: "abc",
            url: "https://gitea.example/todo/appdev/pulls/4",
            updatedAt: "2026-09-17T18:00:00Z",
            line: "#4 · Vera",
          },
        ],
      },
      { name: "group", fullName: "todo/group", url: "https://gitea.example/todo/group", pulls: [] },
    ],
  },
];

const render = (
  state: ZeropsGiteaOverviewState,
  props: Partial<React.ComponentProps<typeof ZeropsGiteaOverview>> = {},
) => renderToStaticMarkup(<ZeropsGiteaOverview state={state} {...props} />);

describe("ZeropsGiteaOverview", () => {
  it("lists each owner, its repositories and the pull requests open on them", () => {
    const html = render({ kind: "read", owners: OWNERS, failure: null });
    expect(html).toContain('data-zerops-gitea-owner="todo"');
    expect(html).toContain('data-zerops-gitea-repository="todo/appdev"');
    expect(html).toContain('href="https://gitea.example/todo/appdev"');
    expect(html).toContain("1 open pull request");
    expect(html).toContain("No open pull request");
    expect(html).toContain("Add a due date to each todo");
    expect(html).toContain("#4 · Vera");
    // A change nothing here can draw is a title and a line, never a dead
    // control and never a way out to the forge.
    expect(html).not.toContain("https://gitea.example/todo/appdev/pulls/4");
    expect(html).not.toContain("<button");
  });

  it("names a project the way every other surface names it", () => {
    // A Gitea org is a group's slug; `todo` is not what the person called it.
    const html = render(
      { kind: "read", owners: OWNERS, failure: null },
      { ownerName: () => "Todo" },
    );
    expect(html).toContain(">Todo</h2>");
    expect(html).not.toContain(">todo</h2>");
  });

  it("gives a change this account can draw its own state and its own page", () => {
    const html = render(
      { kind: "read", owners: OWNERS, failure: null },
      {
        change: () => ({
          state: { word: "needs a rebase", tone: "attention" },
          open: () => {},
        }),
      },
    );
    expect(html).toContain("needs a rebase");
    expect(html).toContain('data-zerops-status-tone="attention"');
    expect(html).toContain('data-zerops-surface="pull-request-title"');
    expect(html).toContain("<button");
  });

  it.each([
    { state: { kind: "no-gitea" }, says: "This account has no Gitea yet" },
    { state: { kind: "signing-in" }, says: "Signing you in to Gitea" },
    {
      state: { kind: "sign-in-refused", reason: "Gitea refused: no login source" },
      says: "no login source",
    },
    { state: { kind: "read", owners: [], failure: null }, says: "No repository yet" },
  ] as const)("says $says before the list", ({ state, says }) => {
    expect(render(state)).toContain(says);
  });

  it("says nothing while the first read is on its way", () => {
    expect(render({ kind: "unread", failure: null })).toBe("");
  });

  it("names why the first read did not answer instead of an empty page", () => {
    const html = render({ kind: "unread", failure: "Gitea answered 500." });
    expect(html).toContain('data-zerops-surface="gitea-read-trouble"');
    expect(html).toContain("Gitea answered 500.");
    expect(html).not.toContain("No repository yet");
  });

  it("names why the last read did not answer beside what was read before it", () => {
    const html = render({ kind: "read", owners: OWNERS, failure: "Gitea answered 500." });
    expect(html).toContain('data-zerops-surface="gitea-read-trouble"');
    expect(html).toContain("Gitea answered 500.");
    expect(html).toContain('data-zerops-gitea-repository="todo/appdev"');
  });
});
