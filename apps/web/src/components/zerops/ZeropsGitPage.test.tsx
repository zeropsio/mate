/**
 * The Git page's list (SPEC §5.3): each application by its name, its repositories and the changes
 * open on them — each change with the word and colour its row wears everywhere, opening its own
 * page — and each repository opens its source within Mate.
 */
import { gitOverview, type FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { GitPageState } from "./ZeropsGitPage.logic";
import { ZeropsGitOverview } from "./ZeropsGitPage";

const OPEN: FlowPullRequest = {
  repository: "appdev",
  number: 4,
  title: "Add a due date to each todo",
  kind: "code",
  mateProjectId: "p-vera",
  url: undefined,
  mergeability: "conflicting",
  behind: false,
  merged: false,
  mergedAt: undefined,
  state: "open",
  headSha: "abc",
  baseBranch: "main",
  line: "appdev #4",
  updatedAt: "2026-10-02T09:00:00Z",
};

const APPS = gitOverview({
  apps: [
    {
      appId: "a-todo",
      name: "Todo",
      repositories: [{ name: "appdev" }, { name: "group" }],
      changes: [OPEN],
    },
  ],
  mateName: () => "Vera",
});

const render = (state: GitPageState, onOpenChange?: () => void) =>
  renderToStaticMarkup(
    <ZeropsGitOverview
      onAgain={() => {}}
      state={state}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    />,
  );

describe("ZeropsGitOverview", () => {
  it("lists each application, its repositories and the changes open on them", () => {
    const html = render({ kind: "read", apps: APPS, failure: null });
    expect(html).toContain(">Todo</h2>");
    expect(html).toContain('data-zerops-git-app="a-todo"');
    expect(html).toContain('data-zerops-git-repository="appdev"');
    expect(html).toContain("1 open change");
    expect(html).toContain("No open change");
    expect(html).toContain("Add a due date to each todo");
    expect(html).toContain("#4 · Vera");
  });

  // HQ's word for a Mate's work is a change (design-system glossary): never a PR.
  it("tags a Mate's code change as a change", () => {
    const html = render({ kind: "read", apps: APPS, failure: null });
    expect(html).toContain(">change<");
    expect(html).not.toMatch(/>pr<|\bPR\b|pull request/iu);
  });

  it("opens each repository's source from Git, with its application id and the hosted base path", () => {
    const html = renderToStaticMarkup(
      <ZeropsGitOverview
        state={{ kind: "read", apps: APPS, failure: null }}
        repositoryHref={(appId, repo) => `/mate/git?${new URLSearchParams({ appId, repo })}`}
      />,
    );
    expect(html).toContain('href="/mate/git?appId=a-todo&amp;repo=appdev"');
    expect(html).toContain('href="/mate/git?appId=a-todo&amp;repo=group"');
  });

  it("gives each change its state and its own page", () => {
    const html = render({ kind: "read", apps: APPS, failure: null }, () => {});
    expect(html).toContain('data-zerops-status-tone="attention"');
    expect(html).toContain('data-zerops-surface="pull-request-title"');
  });

  it("says there is no repository yet once everything is read", () => {
    expect(render({ kind: "read", apps: [], failure: null })).toContain(
      "No repository yet. The first project brings one.",
    );
  });

  it("does not claim an empty repository listing while another read is pending", () => {
    const html = render({ kind: "read", apps: [], failure: null, reading: true });
    expect(html).toContain("Reading repositories and changes…");
    expect(html).not.toContain("No repository yet");
  });
  it("does not call unread changes an empty change list", () => {
    const html = render({ kind: "read", apps: APPS, failure: null, unreadChanges: ["a-todo"] });
    expect(html).toContain("Changes not read yet.");
    expect(html).not.toContain("No open change");
  });

  it("names the first read while it is on its way", () => {
    expect(render({ kind: "unread", failure: null })).toContain(
      "Reading repositories and changes…",
    );
  });

  it("names why the first read did not answer instead of an empty page", () => {
    const html = render({ kind: "unread", failure: "HQ is not answering right now." });
    expect(html).toContain('data-zerops-surface="git-read-trouble"');
    expect(html).toContain("HQ is not answering right now.");
    expect(html).toContain(">Again</button>");
    expect(html).not.toContain("No repository yet");
  });

  it("names why the last read did not answer beside what was read", () => {
    const html = render({ kind: "read", apps: APPS, failure: "HQ is not answering right now." });
    expect(html).toContain("HQ is not answering right now.");
    expect(html).toContain(">Again</button>");
    expect(html).toContain('data-zerops-git-repository="appdev"');
  });
});
