// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { defaultParseSearch } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { ZeropsRepositoryBrowser } from "./ZeropsRepositoryBrowser";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

const held = vi.hoisted(() => ({
  /** Each read's view by which read it is; the home read is the frame's. */
  views: {} as Record<string, unknown>,
  asked: [] as Array<{ readonly read: string; readonly params: unknown }>,
}));
vi.mock("~/zerops/useGitBrowse", () => {
  const viewOf = (request: { readonly read: string; readonly params: unknown }) => {
    held.asked.push({ read: request.read, params: request.params });
    return held.views[request.read] ?? { state: "unread", busy: false };
  };
  return {
    useGitBrowse: (request: { readonly read: string; readonly params: unknown }) => ({
      view: viewOf(request),
      again: () => undefined,
    }),
    // The frame holds the folder or file its page draws.
    useGitBrowseReads: (
      requests: ReadonlyArray<{ readonly read: string; readonly params: unknown }>,
    ) => ({
      views: requests.map(viewOf),
      again: () => undefined,
    }),
  };
});
vi.mock("./gitBrowser/GitTreeSidebar", () => ({ GitTreeSidebar: () => null }));
vi.mock("@pierre/diffs/react", () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  File: ({ file }: { file: { contents: string } }) => <pre>{file.contents}</pre>,
}));
vi.mock("~/components/DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@legendapp/list/react", () => ({
  LegendList: (props: { readonly ListFooterComponent?: ReactNode }) => (
    <div>{props.ListFooterComponent}</div>
  ),
}));
vi.mock("./ZeropsGitCredentials", () => ({
  ZeropsGitCredentials: () => <p>Clone address</p>,
}));
it("names unverified repository access without offering an inert Read again", () => {
  const html = renderToStaticMarkup(
    <ZeropsRepositoryBrowser
      appId="app"
      project="Shop"
      repo="appdev"
      allowed={undefined}
      query={{ path: "", kind: "tree" }}
      onNavigate={() => {}}
      onBack={() => {}}
    />,
  );
  expect(html).toContain("Your access to this repository has not been verified.");
  expect(html).not.toContain("Read again");
});

async function browser(
  repo = "appdev",
  project = "Shop & Tools",
  query: ComponentProps<typeof ZeropsRepositoryBrowser>["query"] = {},
  onNavigate: ComponentProps<typeof ZeropsRepositoryBrowser>["onNavigate"] = () => {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <ZeropsRepositoryBrowser
        appId="app"
        project={project}
        repo={repo}
        allowed={true}
        query={query}
        onNavigate={onNavigate}
        onBack={() => {}}
      />,
    ),
  );
  // Each page is its own chunk: wait for the one the link names.
  await act(async () => {
    await Promise.all([import("./gitBrowser/GitRepoHome"), import("./gitBrowser/GitRepoCode")]);
  });
  return {
    // The Clone popover opens in a portal, outside the page's own element.
    host: document.body,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
async function openClone(host: HTMLElement) {
  const clone = [...host.querySelectorAll("button")].find((b) => b.textContent === "Clone");
  expect(clone, "the repository header offers Clone").toBeDefined();
  await act(async () => clone!.click());
}
async function enter(host: HTMLElement, url: string) {
  if (host.querySelector('input[aria-label="Repository HTTPS URL"]') === null)
    await openClone(host);
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Repository HTTPS URL"]');
  expect(input, "Code repository offers HTTPS token guidance").not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, url);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("guides direct GitHub delivery from the code repository URL without connecting it", async () => {
  const { host, close } = await browser();
  try {
    await enter(host, "https://github.com/acme/widgets");
    const link = host.querySelector<HTMLAnchorElement>('a[href*="personal-access-tokens/new"]');
    expect(link?.getAttribute("href")).toBe(
      "https://github.com/settings/personal-access-tokens/new?name=Mate+Shop+%26+Tools&target_name=acme&expires_in=366&contents=write&workflows=write&checks=read&statuses=read&actions=read&issues=write&repository_hooks=write",
    );
    expect(host.textContent).toContain("Only select repositories");
    expect(host.textContent).toContain("acme/widgets");
    expect(host.textContent).toContain("Resource owner: acme");
    expect(host.textContent).toContain("Direct push to a branch only");
    expect(host.textContent).toContain("This guide does not connect a repository or check access.");
    expect(host.querySelector("input[data-secret]")).toBeNull();
    expect(host.textContent).toContain("Contents, Issues and Webhooks: Read and write");
    expect(host.textContent).toContain("Workflows: Read and write is optional");
    expect(host.textContent).not.toContain("Pull requests:");
    expect(host.textContent).toContain("Clone with HTTPS");
    expect(host.textContent).toContain("Open changes");
    expect(host.textContent).toContain("Changes not read yet.");
  } finally {
    await close();
  }
});
it("encodes and truncates the application name to forty characters in the real guide link", async () => {
  const { host, close } = await browser("appdev", "&".repeat(60));
  try {
    await enter(host, "https://github.com/acme/widgets.git");
    const href = host.querySelector<HTMLAnchorElement>(
      'a[href*="personal-access-tokens/new"]',
    )?.href;
    expect(href).toBeDefined();
    const url = new URL(href!);
    expect(url.searchParams.get("name")).toBe("Mate " + "&".repeat(35));
    expect(url.searchParams.get("name")!.length).toBe(40);
    expect(href).toContain("%26");
    expect(host.textContent).toContain("acme/widgets");
  } finally {
    await close();
  }
});
it.each([
  "git@github.com:acme/widgets.git",
  "http://github.com/acme/widgets",
  "https://github.com/acme",
  "not a URL",
])("refuses token guidance for malformed or non-HTTPS repository URL %s", async (url) => {
  const { host, close } = await browser();
  try {
    await enter(host, "https://github.com/acme/widgets");
    await enter(host, url);
    expect(host.querySelector('a[href*="personal-access-tokens/new"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Enter an HTTPS repository URL",
    );
  } finally {
    await close();
  }
});
it("keeps token guidance out of the recipe repository", async () => {
  const { host, close } = await browser("group");
  try {
    await openClone(host);
    expect(host.querySelector('input[aria-label="Repository HTTPS URL"]')).toBeNull();
    expect(host.textContent).toContain("Clone with HTTPS");
    expect(host.textContent).toContain("Open changes");
  } finally {
    await close();
  }
});

const sha = "d".repeat(40);
const knownHome = (readme: { readonly path: string; readonly content: string } | null) => ({
  state: "known",
  busy: false,
  failed: false,
  answer: {
    sha,
    ref: { name: "main", kind: "branch" },
    about: {
      remote: null,
      mirror: null,
      updatedAt: "2026-10-21T00:00:00.000Z",
      branchCount: 1,
      tagCount: 0,
    },
    readme: readme === null ? null : { ...readme, truncated: false },
  },
});
afterEach(() => {
  held.views = {};
  held.asked = [];
});

describe("repository frame", () => {
  it("Clone and the token guide open from the repository header", async () => {
    const { host, close } = await browser();
    try {
      expect(host.textContent).not.toContain("Clone with HTTPS");
      expect(host.querySelector('input[aria-label="Repository HTTPS URL"]')).toBeNull();
      await openClone(host);
      expect(host.textContent).toContain("Clone with HTTPS");
      expect(host.textContent).toContain("Clone address");
      expect(host.querySelector('input[aria-label="Repository HTTPS URL"]')).not.toBeNull();
    } finally {
      await close();
    }
  });

  it.each([
    [
      { rev: "v1", path: "src/a.ts", kind: "file" as const },
      "blob",
      {
        state: "known",
        busy: false,
        failed: false,
        answer: {
          path: "src/a.ts",
          blobSha: "b".repeat(40),
          size: 19,
          binary: false,
          content: "export const a = 1;",
          truncated: false,
        },
      },
      "export const a = 1;",
    ],
    [
      { rev: "v1", path: "src", kind: "tree" as const },
      "tree",
      {
        state: "known",
        busy: false,
        failed: false,
        answer: {
          entries: [
            { name: "a.ts", path: "src/a.ts", type: "file", mode: "100644", sha: "c".repeat(40) },
          ],
          truncated: false,
        },
      },
      "a.ts",
    ],
  ])(
    "A link with rev, path and kind still opens the same file or folder: %j",
    async (query, read, view, shown) => {
      held.views = { home: knownHome(null), [read]: view };
      const { host, close } = await browser("appdev", "Shop", query);
      try {
        // The link's branch, tag or commit is resolved once; its path is read at that commit.
        expect(held.asked.find((asked) => asked.read === "home")?.params).toEqual({ rev: "v1" });
        expect(held.asked.findLast((asked) => asked.read === read)?.params).toEqual({
          sha,
          path: query.path,
        });
        expect(host.textContent).toContain(shown);
      } finally {
        await close();
      }
    },
  );

  it("A link that names a folder as a file opens the folder", async () => {
    // A README's `[src](src)`: HQ answers the file read that the path is a folder.
    held.views = {
      home: knownHome(null),
      blob: { state: "refused", reason: "not_a_file", words: "HQ refused this (not_a_file)." },
      tree: {
        state: "known",
        busy: false,
        failed: false,
        answer: {
          entries: [
            { name: "a.ts", path: "src/a.ts", type: "file", mode: "100644", sha: "c".repeat(40) },
          ],
          truncated: false,
        },
      },
    };
    const { host, close } = await browser("appdev", "Shop", { path: "src", kind: "file" });
    try {
      expect(held.asked.findLast((asked) => asked.read === "tree")?.params).toEqual({
        sha,
        path: "src",
      });
      expect(host.textContent).toContain("a.ts");
      expect(host.textContent).not.toContain("not_a_file");
    } finally {
      await close();
    }
  });
});

describe("repository README", () => {
  it("Raw HTML in a README is sanitized", async () => {
    held.views.home = knownHome({
      path: "README.md",
      content:
        '# Shop\n\n<script>window.hit = 1</script><b onclick="window.hit = 2">bold</b> <a href="javascript:alert(1)">bad</a> <iframe src="https://example.test"></iframe>',
    });
    const { host, close } = await browser();
    try {
      const readme = host.querySelector('section[aria-label="README"]')!;
      expect(readme.querySelector("h1")?.textContent).toBe("Shop");
      expect(readme.querySelector("b")?.textContent).toBe("bold");
      expect(readme.querySelector("script, iframe, [onclick]")).toBeNull();
      expect(readme.innerHTML).not.toContain("javascript:");
    } finally {
      await close();
    }
  });

  it.each([
    ["../docs/setup.md", { path: "docs/setup.md", kind: "file" }],
    ["/src/", { path: "src", kind: "tree" }],
    ["./CONTRIBUTING.md#start", { path: ".github/CONTRIBUTING.md", kind: "file" }],
    // A name the router would read as a number, opened in a new tab.
    ["../2024", { path: "2024", kind: "file" }],
  ])(
    "A README link to a repository path opens that path at the same commit: %s",
    async (href, target) => {
      held.views.home = knownHome({ path: ".github/README.md", content: `[open](${href})` });
      const onNavigate = vi.fn();
      const { host, close } = await browser("appdev", "Shop", { rev: "main" }, onNavigate);
      try {
        const link = host.querySelector<HTMLAnchorElement>('section[aria-label="README"] a')!;
        expect(new URL(link.href).searchParams.get("rev")).toBe(sha);
        expect(defaultParseSearch(new URL(link.href).search)).toMatchObject(target);
        await act(async () => link.click());
        expect(onNavigate).toHaveBeenCalledWith({ rev: sha, view: "code", ...target });
      } finally {
        await close();
      }
    },
  );

  it("An image of the repository is drawn from the commit's bytes, at most twenty a document", async () => {
    held.views.home = knownHome({
      path: "docs/README.md",
      content: [
        "![logo](./logo.png)",
        ...Array.from({ length: 20 }, (_, i) => `![shot ${i + 2}](../shots/${i + 2}.png)`),
        "![far](https://cdn.example.test/far.png)",
      ].join("\n\n"),
    });
    held.views.raw = {
      state: "known",
      busy: false,
      failed: false,
      answer: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
    };
    const { host, close } = await browser();
    try {
      const readme = host.querySelector('section[aria-label="README"]')!;
      const images = [...readme.querySelectorAll("img")];
      expect(images).toHaveLength(20);
      expect(images.every((img) => img.src.startsWith("blob:"))).toBe(true);
      expect(images[0]!.alt).toBe("logo");
      const raws = held.asked.filter((asked) => asked.read === "raw").map((a) => a.params);
      expect(raws).toContainEqual({ sha, path: "docs/logo.png" });
      expect(raws).toContainEqual({ sha, path: "shots/2.png" });
      expect(raws).not.toContainEqual({ sha, path: "shots/21.png" });
      // Past twenty, an image of the repository opens its file; one outside it is only a link.
      const [extra, far] = [...readme.querySelectorAll("a")];
      expect(extra!.textContent).toBe("shot 21");
      expect(new URL(extra!.href).searchParams.get("path")).toBe("shots/21.png");
      expect([far!.textContent, far!.getAttribute("href")]).toEqual([
        "far",
        "https://cdn.example.test/far.png",
      ]);
    } finally {
      await close();
    }
  });

  it("An image outside the repository is shown as a link and never loaded", async () => {
    held.views.home = knownHome({
      path: "README.md",
      content:
        '![logo](https://cdn.example.test/logo.png)\n\n<img src="https://tracker.example.test/p.gif" alt="pixel">\n\n[![build](https://ci.example.test/badge.svg)](https://ci.example.test/)',
    });
    const { host, close } = await browser();
    try {
      const readme = host.querySelector('section[aria-label="README"]')!;
      expect(readme.querySelector("img, picture, source")).toBeNull();
      expect(
        [...readme.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]),
      ).toEqual([
        ["logo", "https://cdn.example.test/logo.png"],
        ["pixel", "https://tracker.example.test/p.gif"],
        ["build", "https://ci.example.test/"],
      ]);
    } finally {
      await close();
    }
  });
});

describe("a read HQ does not answer", () => {
  const refused = (reason: string) => ({
    state: "refused",
    reason,
    words: `HQ refused it (${reason}).`,
  });
  const knownBlob = {
    state: "known",
    busy: false,
    failed: false,
    answer: {
      path: "a.ts",
      blobSha: "b".repeat(40),
      size: 19,
      binary: false,
      content: "export const a = 1;",
      truncated: false,
    },
  };
  /** Each page, the link that opens it, the read it draws, and what else it needs answered. */
  const PAGES = [
    { page: "a folder", query: { path: "src", kind: "tree" as const }, read: "tree" },
    { page: "a file", query: { path: "a.ts", kind: "file" as const }, read: "blob" },
    { page: "history", query: { view: "commits" as const }, read: "log" },
    { page: "a commit", query: { rev: "e".repeat(40), view: "commit" as const }, read: "commit" },
    {
      page: "content search",
      query: { view: "search" as const, scope: "content" as const, q: "tea" },
      read: "grep",
    },
    {
      page: "the file finder",
      query: { view: "search" as const, scope: "name" as const },
      read: "paths",
    },
    {
      page: "blame",
      query: { view: "blame" as const, path: "a.ts" },
      read: "blame",
      also: { blob: knownBlob },
    },
    {
      page: "compare",
      query: { view: "compare" as const, base: "main", head: "dev" },
      read: "compare",
    },
    {
      page: "an archive",
      query: {},
      read: "archive",
      also: {
        tree: {
          state: "known",
          busy: false,
          failed: false,
          answer: { entries: [], truncated: false },
        },
      },
      within: 'section[aria-label="Download"]',
    },
  ];
  // What the person is told and offered: HQ's own refusals in the page's words.
  const REFUSED: Record<string, { readonly reason: string; readonly words: string }> = {
    tree: { reason: "path_not_found", words: "This commit holds nothing at this path." },
    blob: { reason: "path_not_found", words: "This commit holds nothing at this path." },
    log: {
      reason: "commit_not_found",
      words: "This branch, tag or commit is not in the repository.",
    },
    commit: { reason: "too_large", words: "HQ refused it (too_large)." },
    grep: { reason: "too_large", words: "HQ refused it (too_large)." },
    paths: { reason: "too_large", words: "HQ refused it (too_large)." },
    blame: { reason: "too_large", words: "HQ refused it (too_large)." },
    compare: {
      reason: "commit_not_found",
      words: "This branch, tag or commit is not in the repository.",
    },
    archive: { reason: "too_large", words: "HQ refused it (too_large)." },
  };
  const CASES = PAGES.flatMap(({ page, query, read, also, within }) => [
    {
      within,
      page,
      outcome: "refused",
      query,
      views: { ...also, [read]: refused(REFUSED[read]!.reason) },
      words: REFUSED[read]!.words,
      // The commit is fixed: reading it again reads the same no; the repository is the way on.
      way: read === "archive" ? null : "Back to the repository",
    },
    {
      within,
      page,
      outcome: "denied",
      query,
      views: { ...also, [read]: { state: "withheld" } },
      words: "You no longer have access to this repository.",
      // A read the frame holds withholds the whole repository; Git is its way back.
      way: read === "tree" || read === "blob" ? "Git" : "Back to Git",
    },
    {
      within,
      page,
      outcome: "not reached",
      query,
      views: { ...also, [read]: { state: "failed", words: "HQ could not be reached." } },
      words: "HQ could not be reached.",
      way: "Read again",
    },
  ]);

  it.each(CASES)(
    "A page whose read HQ $outcome says why and offers the way on: $page",
    async ({ query, views, words, way, within }) => {
      held.views = { home: knownHome(null), ...views };
      const { host, close } = await browser("appdev", "Shop", query);
      try {
        await act(async () => {
          await Promise.all(
            [
              "GitCommitsView",
              "GitCommitView",
              "GitCompareView",
              "GitSearchView",
              "GitBlameView",
            ].map((page) => import(`./gitBrowser/${page}.tsx`)),
          );
        });
        if (within !== undefined) {
          await openClone(host);
          const zip = [...host.querySelectorAll("button")].find(
            (b) => b.textContent === "Download ZIP",
          );
          await act(async () => zip!.click());
        }
        const shown = within === undefined ? host : host.querySelector<HTMLElement>(within)!;
        const alerts = [...shown.querySelectorAll('[role="alert"]')].map(
          (alert) => alert.textContent,
        );
        expect(alerts).toContain(words);
        expect(shown.textContent).not.toMatch(/Reading|Searching|Waiting for HQ/);
        const offered = [...shown.querySelectorAll("a, button")].map(
          (control) => control.textContent,
        );
        if (way !== null) expect(offered).toContain(way);
        if (way !== "Read again") expect(offered).not.toContain("Read again");
        if (way === "Back to the repository")
          expect(
            [...shown.querySelectorAll("a")]
              .find((a) => a.textContent === way)
              ?.getAttribute("href"),
          ).toBe("/git?appId=app&repo=appdev");
      } finally {
        await close();
      }
    },
  );
});
