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
            author: "mate-abc",
            url: "https://gitea.example/todo/appdev/pulls/4",
            updatedAt: "2026-09-17T18:00:00Z",
            line: "#4 · mate-abc",
          },
        ],
      },
      { name: "group", fullName: "todo/group", url: "https://gitea.example/todo/group", pulls: [] },
    ],
  },
];

const render = (state: ZeropsGiteaOverviewState) =>
  renderToStaticMarkup(<ZeropsGiteaOverview state={state} />);

describe("ZeropsGiteaOverview", () => {
  it("lists each owner, its repositories and the pull requests open on them", () => {
    const html = render({ kind: "read", owners: OWNERS });
    expect(html).toContain('data-zerops-gitea-owner="todo"');
    expect(html).toContain('data-zerops-gitea-repository="todo/appdev"');
    expect(html).toContain('href="https://gitea.example/todo/appdev"');
    expect(html).toContain("1 open pull request");
    expect(html).toContain("No open pull request");
    expect(html).toContain("Add a due date to each todo");
    expect(html).toContain('href="https://gitea.example/todo/appdev/pulls/4"');
    expect(html).toContain("#4 · mate-abc");
    // The way in is the title; the page changes nothing.
    expect(html).not.toContain("<button");
  });

  it.each([
    { state: { kind: "no-gitea" }, says: "This account has no Gitea yet" },
    { state: { kind: "signing-in" }, says: "Signing you in to Gitea" },
    {
      state: { kind: "sign-in-refused", reason: "Gitea refused: no login source" },
      says: "no login source",
    },
    { state: { kind: "read", owners: [] }, says: "No repository yet" },
  ] as const)("says $says before the list", ({ state, says }) => {
    expect(render(state)).toContain(says);
  });

  it("says nothing while the first read is on its way", () => {
    expect(render({ kind: "unread" })).toBe("");
  });
});
