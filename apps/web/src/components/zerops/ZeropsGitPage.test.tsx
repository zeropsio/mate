/**
 * The Git page's list (SPEC §5.3): each application by its name, its repositories and the changes
 * open on them — each change with the word and colour its row wears everywhere, opening its own
 * page — and no way out to a web git browser until there is one.
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
    <ZeropsGitOverview state={state} {...(onOpenChange === undefined ? {} : { onOpenChange })} />,
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

  // SPEC §5.3: no web git browser until zitweb, so a repository's name goes nowhere.
  it("names a repository without a link out", () => {
    expect(render({ kind: "read", apps: APPS, failure: null })).not.toContain("<a ");
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

  it("says nothing while the first read is on its way", () => {
    expect(render({ kind: "unread", failure: null })).toBe("");
  });

  it("names why the first read did not answer instead of an empty page", () => {
    const html = render({ kind: "unread", failure: "HQ is not answering right now." });
    expect(html).toContain('data-zerops-surface="git-read-trouble"');
    expect(html).toContain("HQ is not answering right now.");
    expect(html).not.toContain("No repository yet");
  });

  it("names why the last read did not answer beside what was read", () => {
    const html = render({ kind: "read", apps: APPS, failure: "HQ is not answering right now." });
    expect(html).toContain("HQ is not answering right now.");
    expect(html).toContain('data-zerops-git-repository="appdev"');
  });
});
