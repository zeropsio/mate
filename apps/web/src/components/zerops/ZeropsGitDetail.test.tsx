// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { RepositorySource } from "@t3tools/shared/hqGit";
import type { GitSearch } from "~/routes/git";
import type { useRepositorySource } from "~/zerops/useRepositorySource";
import { ZeropsGitPage } from "./ZeropsGitPage";

type Search = GitSearch;
const fixture = vi.hoisted(() => ({
  search: {} as Search,
  home: {} as unknown,
  homeAgain: vi.fn(),
  refs: [] as Array<unknown>,
  source: {} as ReturnType<typeof useRepositorySource>["source"],
  again: vi.fn(),
  allowed: true as boolean | undefined,
  failure: undefined as string | undefined,
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => fixture.search,
  useNavigate: () => fixture.navigate,
}));
vi.mock("~/zerops/useRepositorySource", () => ({
  useRepositorySource: () => ({ source: fixture.source, again: fixture.again }),
}));
vi.mock("~/zerops/useGitBrowse", () => ({
  useGitBrowse: () => ({ view: fixture.home, again: fixture.homeAgain }),
  useGitBrowseReads: () => ({ views: fixture.refs, again: () => undefined }),
}));
vi.mock("./ZeropsGitCredentials", () => ({
  ZeropsGitCredentials: ({ appId, repo }: { appId: string; repo: string }) => (
    <div>
      Credentials for {appId}/{repo}
    </div>
  ),
}));
vi.mock("./landing/ZeropsHostedFrame", () => ({
  ZeropsHostedFrame: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("./landing/ZeropsAccountControl", () => ({ ZeropsSessionAccountControl: () => null }));
vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: { id: "org" },
  }),
}));
vi.mock("~/zerops/useHqAppDetail", () => ({ useHqAppDetailHold: () => undefined }));
vi.mock("~/zerops/ZeropsAccountData", () => ({ useAccountDataOptional: () => null }));
vi.mock("~/zerops/inventoryContext", async () => {
  const { createContext } = await import("react");
  return { InventoryContext: createContext(null), useAccountTrouble: () => null };
});
vi.mock("~/zerops/useZeropsRegistry", () => ({
  useZeropsRegistry: () => ({
    loading: false,
    registry: { groups: [{ groupId: "shop", name: "Shop" }] },
  }),
}));
vi.mock("~/zerops/useChangeOffers", () => ({
  useChangeOffers: () => () => ({ read: fixture.allowed, why: {} }),
}));
vi.mock("~/zerops/projectFlows", () => ({
  useMateNames: () => new Map([["ada", "Ada"]]),
  useProjectFlows: () => ({
    releaseFailures: new Map(),
    flows: new Map([
      [
        "shop",
        {
          changesKnown: true,
          changesFailure: fixture.failure,
          repos: [{ name: "appdev" }, { name: "group" }],
          pullRequests: [
            {
              repository: "appdev",
              number: 4,
              title: "Add a due date",
              kind: "code",
              mateProjectId: "ada",
              mergeability: "conflicting",
              state: "open",
              merged: false,
              behind: false,
              updatedAt: "2026-10-09",
            },
            {
              repository: "group",
              number: 5,
              title: "Other repository change",
              kind: "recipe",
              mateProjectId: "ada",
              state: "open",
              merged: false,
            },
          ],
        },
      ],
    ]),
  }),
}));
const value: RepositorySource = {
  kind: "tree",
  revision: "a".repeat(40),
  path: "",
  truncated: false,
  branchesTruncated: false,
  branches: [
    { ref: "refs/heads/main", sha: "a".repeat(40) },
    { ref: "refs/heads/feature", sha: "b".repeat(40) },
  ],
  entries: [{ path: "src", type: "tree", mode: "040000", sha: "c".repeat(40) }],
};
const sha = "a".repeat(40);
const ref = (name: string) => ({
  name,
  ref: `refs/heads/${name}`,
  sha,
  kind: "branch",
  committedAt: "2026-10-09T00:00:00.000Z",
  subject: "Subject",
  outsideMate: false,
});
const refsPage = (next: string | null) => [
  {
    state: "known",
    answer: { items: [ref("main"), ref("feature")], next, total: 2 },
    busy: false,
    failed: false,
  },
];
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  fixture.search = {};
  fixture.allowed = true;
  fixture.failure = undefined;
  fixture.source = { state: "known", source: value, busy: false, failed: false };
  fixture.home = {
    state: "known",
    answer: {
      sha,
      ref: { name: "main", kind: "branch" },
      about: {
        remote: null,
        mirror: null,
        updatedAt: "2026-10-09T00:00:00.000Z",
        branchCount: 2,
        tagCount: 0,
      },
      readme: null,
    },
    busy: false,
    failed: false,
  };
  fixture.refs = refsPage(null);
  fixture.again.mockClear();
  fixture.navigate
    .mockReset()
    .mockImplementation(({ search }: { search?: Search | ((previous: Search) => Search) }) => {
      if (search) fixture.search = typeof search === "function" ? search(fixture.search) : search;
      return Promise.resolve();
    });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
});
const draw = async () => {
  await act(() => root.render(<ZeropsGitPage />));
  // Each repository page is its own chunk: wait for the one the link names.
  await act(async () => {
    await Promise.all([import("./gitBrowser/GitRepoHome"), import("./gitBrowser/GitRepoCode")]);
  });
};
/** Popovers open in a portal, outside the page's own element. */
const page = () => document.body.textContent ?? "";
const detail = () => host.querySelector('[data-zerops-surface="repository-browser"]')!;
async function press(words: string, within: ParentNode = host) {
  const node = [...within.querySelectorAll<HTMLElement>("button, a")].find(
    (node) => node.textContent === words,
  );
  expect(node, words).toBeDefined();
  await act(() => node!.click());
  await draw();
}
async function open() {
  fixture.search = { appId: "shop", repo: "appdev" };
  await draw();
}

// Decision: slice 2 only; slice 3 follows as its own card.
it("Opening source keeps the project and repository visible", async () => {
  await open();
  expect(detail().querySelector('nav[aria-label="Repository"]')?.textContent ?? "").toContain(
    "Git / Shop / appdev",
  );
  expect(detail().textContent).toContain("Open changes");
  expect(detail().textContent).toContain("Add a due date");
  expect(detail().textContent).not.toContain("Other repository change");
  expect(page()).not.toContain("Credentials for");
  expect(detail().querySelector('[aria-label="Source"]')).not.toBeNull();
  await press("src", detail());
  expect(fixture.search).toEqual({
    appId: "shop",
    repo: "appdev",
    rev: "a".repeat(40),
    view: "code",
    path: "src",
    kind: "tree",
  });
  expect(detail().textContent).toContain("Shop");
  await press("Up one folder", detail());
  expect(fixture.search.path).toBe("");
  await press("Code", detail());
  await press("Review", detail());
  expect(fixture.navigate).toHaveBeenLastCalledWith({
    to: "/change/$groupId/$repository/$number",
    params: { groupId: "shop", repository: "appdev", number: "4" },
  });
});
it("Branch selection resets the path without switching the Mate’s checkout", async () => {
  fixture.search = {
    appId: "shop",
    repo: "appdev",
    path: "src/index.ts",
    kind: "file",
    rev: "a".repeat(40),
  };
  await draw();
  await press("main", detail());
  const feature = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => option.textContent === "feature",
  );
  expect(feature, "the picker lists the feature branch").toBeDefined();
  await act(() => feature!.click());
  await draw();
  expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith({
    to: "/git",
    search: { appId: "shop", repo: "appdev", rev: "feature" },
  });
  expect(fixture.search).toEqual({ appId: "shop", repo: "appdev", rev: "feature" });
  expect(detail().textContent).toContain("Browsing source does not switch a Mate’s checkout.");
});
it("Returning from source restores the selected overview", async () => {
  await draw();
  await press("All repositories");
  await press("appdev");
  await press(
    detail().querySelector('nav[aria-label="Repository"]') ? "Git" : "Back to repositories",
    detail(),
  );
  expect(
    [...host.querySelectorAll("button")]
      .find((node) => node.textContent === "All repositories")
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(host.querySelector('[data-zerops-git-repository="group"]')).not.toBeNull();
});
it("Failed and limited reads never look complete", async () => {
  fixture.source = {
    state: "known",
    source: { ...value, truncated: true, branchesTruncated: true },
    busy: false,
    failed: true,
  };
  fixture.failure = "HQ is unavailable.";
  fixture.refs = refsPage("0.1.refs/heads/feature");
  await open();
  expect(detail().textContent).toContain("Showing the last read source.");
  expect(detail().textContent).toContain("Showing the last read changes.");
  expect(detail().textContent).toContain("Only the first entries");
  await press("Clone", detail());
  expect(page()).toContain("Clone with HTTPS");
  await press("main", detail());
  expect(page()).toContain("Show more");
  await press("Read again", detail().querySelector('[aria-label="Source"]')!);
  expect(fixture.again).toHaveBeenCalledOnce();
  fixture.source = {
    state: "known",
    source: { ...value, revision: null, branches: [], entries: [] },
    busy: false,
    failed: false,
  };
  await draw();
  expect(detail().textContent).toContain("No commits on this branch yet.");
  expect(detail().textContent).not.toContain("No files here.");
});
it.each([
  ["reading", "Reading source…", false],
  ["unread", "Waiting for HQ…", false],
  ["failed", "Branch could not be read.", true],
] as const)(
  "Repository context and clone remain reachable when source is %s",
  async (state, words, alert) => {
    fixture.source = {
      state,
      words: state === "reading" ? "Reading…" : words,
      alert,
      busy: state === "reading",
    };
    await open();
    expect(detail().textContent).toContain("Shop");
    expect(detail().textContent).toContain("Add a due date");
    expect(detail().textContent).toContain(words);
    await press("Clone", detail());
    expect(page()).toContain("Clone with HTTPS");
    expect(detail().textContent).not.toContain("No files here.");
  },
);

it("Source refusal withholds changes and HTTPS even before offers catch up", async () => {
  fixture.source = {
    state: "withheld",
    words: "You no longer have access to this repository.",
    alert: true,
    busy: false,
  };
  await open();
  expect(detail().textContent).toContain("You no longer have access");
  expect(detail().textContent).not.toContain("Add a due date");
  expect(
    [...detail().querySelectorAll("button")].map((button) => button.textContent),
  ).not.toContain("Clone");
});
it.each([
  { reason: "commit_not_found", words: "HQ has no such commit." },
  // An empty revision, or one read as an option, refused before it is sent.
  { reason: "invalid", words: "HQ refused this (invalid)." },
])(
  "A link to a revision HQ refuses as $reason says it is not in the repository, in place",
  async ({ reason, words }) => {
    fixture.home = { state: "refused", reason, words };
    await open();
    expect(detail().textContent).toContain("This branch, tag or commit is not in the repository.");
    expect(detail().textContent).not.toContain(words);
    expect(detail().textContent).toContain("Open changes");
  },
);
it.each([false, true])(
  "A repository's home is read again on Read again, and says when that read failed (failed: %s)",
  async (failed) => {
    fixture.home = { ...(fixture.home as object), busy: false, failed };
    fixture.homeAgain.mockClear();
    await open();
    expect(detail().textContent?.includes("HQ could not read this again.")).toBe(failed);
    await press("Read again", detail());
    expect(fixture.homeAgain).toHaveBeenCalledTimes(1);
  },
);
it("Clone with HTTPS opens the existing credentials for this project and repository", async () => {
  await open();
  expect(page()).not.toContain("Credentials for");
  await press("Clone", detail());
  expect(page()).toContain("Credentials for shop/appdev");
  await press("Clone", detail());
  expect(page()).not.toContain("Credentials for");
});
