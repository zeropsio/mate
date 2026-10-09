// @vitest-environment happy-dom
/**
 * The Git page's list (SPEC §5.3): each application by its name, its repositories and the changes
 * open on them — each change with the word and colour its row wears everywhere, opening its own
 * page — and each repository opens its source within Mate.
 */
import { gitOverview, type FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { gitPageState } from "./ZeropsGitPage.logic";
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
    expect(html).toContain(">Todo</span>");
    expect(html).toContain('data-zerops-git-app="a-todo"');
    expect(html).toContain('data-zerops-git-repository="appdev"');
    expect(html).toContain("1 open change");
    expect(html).toContain("All repositories");
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
        state={{
          kind: "read",
          apps: APPS.map((app) => ({
            ...app,
            repositories: app.repositories.map((repo) => ({
              ...repo,
              coverage: "unread",
              open: true,
            })),
          })),
          failure: null,
        }}
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
      "No repositories yet. Repositories appear here after a project is set up.",
    );
  });

  it("does not claim an empty repository listing while another read is pending", () => {
    const html = render({ kind: "read", apps: [], failure: null, reading: true });
    expect(html).toContain("Reading repositories and changes…");
    expect(html).not.toContain("No repositories yet");
  });
  it("does not call unread changes an empty change list", () => {
    const html = render({
      kind: "read",
      apps: APPS.map((app) => ({
        ...app,
        repositories: app.repositories.map((repo) => ({ ...repo, coverage: "unread", open: true })),
      })),
      failure: null,
    });
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
    expect(html).toContain(">Read again</button>");
    expect(html).not.toContain("No repositories yet");
  });

  it("names why the last read did not answer beside what was read", () => {
    const html = render({ kind: "read", apps: APPS, failure: "HQ is not answering right now." });
    expect(html).toContain("HQ is not answering right now.");
    expect(html).toContain(">Read again</button>");
    expect(html).toContain('data-zerops-git-repository="appdev"');
  });
});

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  host?.remove();
  root = undefined;
});
async function mount(state: GitPageState, onOpenChange = vi.fn()) {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(() => root?.render(<ZeropsGitOverview state={state} onOpenChange={onOpenChange} />));
  return host;
}
async function press(label: string) {
  const button = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
  expect(button, label).toBeDefined();
  await act(() => button?.click());
}
const page = (apps: Parameters<typeof gitPageState>[0]["apps"]) =>
  gitPageState({ appsKnown: true, apps, mateName: () => "Vera" });
const project = (
  appId: string,
  name: string,
  changes: ReadonlyArray<FlowPullRequest> | undefined = [OPEN],
) => ({
  appId,
  name,
  changes,
  read: true,
  repositories: [{ name: "appdev" }, { name: "group" }],
  failure: undefined,
});
const repositoryNames = () =>
  [...host.querySelectorAll("[data-zerops-git-repository]")].map(
    (node) =>
      `${node.getAttribute("data-zerops-git-app")}/${node.getAttribute("data-zerops-git-repository")}`,
  );

describe("Git overview slice 1", () => {
  // Decision: slice 1 only; slices 2–3 follow as their own cards.
  it("Quiet repositories remain reachable from All repositories", async () => {
    await mount(page([project("todo", "Todo")]));
    expect(repositoryNames()).toEqual(["todo/appdev"]);
    await press("All repositories");
    expect(repositoryNames()).toEqual(["todo/appdev", "todo/group"]);
    expect(host.textContent).toContain("No open changes.");
    expect(host.textContent).toContain("Recipe");
    await press("Open changes");
    expect(repositoryNames()).toEqual(["todo/appdev"]);
  });
  it("Unread changes remain visible in Open changes", async () => {
    // Explicit undefined is an unread source, not a successful empty list.
    await mount(page([{ ...project("todo", "Todo"), changes: undefined }]));
    expect(repositoryNames()).toEqual(["todo/appdev", "todo/group"]);
    expect(host.textContent).toContain("Changes not read yet.");
    expect(host.textContent).toContain("0 known open changes");
    expect(host.textContent).not.toContain("No open changes.");
  });
  it("Background facts do not reorder displayed repositories", async () => {
    await mount(page([project("z", "Zebra"), project("b", "Bravo")]));
    expect(repositoryNames()).toEqual(["b/appdev", "z/appdev"]);
    await mount(page([project("z", "Alpha"), project("b", "Bravo"), project("a", "Aardvark")]));
    expect(repositoryNames()).toEqual(["b/appdev", "z/appdev"]);
    expect(host.textContent).toContain("Alpha");
    await press("Update list");
    expect(repositoryNames()).toEqual(["a/appdev", "z/appdev", "b/appdev"]);
  });
  it("Denied content disappears immediately", async () => {
    await mount(page([project("a", "Alpha"), project("b", "Bravo")]));
    await mount(page([{ ...project("a", "Alpha"), read: false }, project("b", "Bravo")]));
    expect(repositoryNames()).toEqual(["b/appdev"]);
    await mount(page([{ ...project("a", "Alpha"), read: undefined }, project("b", "Bravo")]));
    expect(repositoryNames()).toEqual(["b/appdev"]);
  });
  it("Review opens the selected change without merging it", async () => {
    const open = vi.fn();
    await mount(
      page([project("todo", "Todo", [OPEN, { ...OPEN, number: 5, title: "Second change" }])]),
      open,
    );
    const disclosure = host.querySelector("details");
    expect(disclosure?.open).toBe(false);
    expect(disclosure?.querySelector("summary")?.textContent).toBe("2 open changes");
    await act(() => {
      if (disclosure) disclosure.open = true;
    });
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Review Todo / appdev #5"]');
    await act(() => button?.click());
    expect(open.mock.calls).toEqual([["todo", "appdev", 5]]);
    expect(host.textContent).not.toContain("Merge change");
    expect(OPEN.state).toBe("open");
  });
  it("A merged change stays labeled Merged until Update list", async () => {
    await mount(page([project("todo", "Todo")]));
    await mount(
      page([
        { ...project("todo", "Todo", []), merged: [{ ...OPEN, state: "merged", merged: true }] },
      ]),
    );
    expect(host.textContent).toContain("Merged");
    expect(host.textContent).toContain(OPEN.title);
    await press("Update list");
    expect(repositoryNames()).toEqual([]);
    expect(host.textContent).toContain("No open changes.");
  });
  it("Failed coverage stays visible and never calls a repository quiet", async () => {
    await mount(page([{ ...project("todo", "Todo", []), failure: "HQ unavailable." }]));
    expect(repositoryNames()).toEqual(["todo/appdev", "todo/group"]);
    expect(host.textContent).toContain("Todo: HQ unavailable.");
    expect(host.textContent).toContain("Showing the last read changes.");
    expect(host.textContent).toContain("0 known open changes");
    expect(host.textContent).not.toContain("No open changes.");
  });
});
