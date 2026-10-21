// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { defaultParseSearch } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { RepositorySource } from "@t3tools/shared/hqGit";
import { ZeropsRepositoryBrowser } from "./ZeropsRepositoryBrowser";
import { ZeropsRepositorySource } from "./ZeropsRepositorySource";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

const common = {
  revision: "a".repeat(40),
  path: "",
  branches: [{ ref: "refs/heads/main", sha: "a".repeat(40) }],
  branchesTruncated: false,
  truncated: false,
};
const render = (source: RepositorySource) =>
  renderToStaticMarkup(<ZeropsRepositorySource source={source} onOpen={() => {}} />);
describe("repository source view", () => {
  it("shows every tree entry and explicitly says when the listing is incomplete", () => {
    const html = render({
      ...common,
      kind: "tree",
      entries: [
        { path: "src", type: "tree", mode: "040000", sha: "b".repeat(40) },
        { path: "README.md", type: "blob", mode: "100644", sha: "c".repeat(40) },
      ],
      truncated: true,
    });
    expect(html).toContain("src");
    expect(html).toContain("README.md");
    expect(html).toContain("Folder");
    expect(html).toContain("Only the first");
  });
  it("renders source as escaped text, identifies binary files and names clipped content", () => {
    const html = render({
      ...common,
      kind: "file",
      content: "<script>alert(1)</script>",
      binary: false,
      truncated: true,
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Only the first");
    expect(render({ ...common, kind: "file", content: null, binary: true })).toContain(
      "Binary file",
    );
  });
  it("names an earned empty tree", () => {
    expect(render({ ...common, kind: "tree", entries: [] })).toContain("No files here");
  });
});

const held = vi.hoisted(() => ({
  source: { state: "unread", words: "Waiting for HQ…", alert: false, busy: false } as unknown,
  sourceAsked: [] as Array<unknown>,
  home: { state: "unread", busy: false } as unknown,
}));
vi.mock("~/zerops/useRepositorySource", () => ({
  useRepositorySource: (input: { readonly query: unknown } | null) => {
    if (input !== null) held.sourceAsked.push(input.query);
    return { source: held.source, again: () => undefined };
  },
}));
vi.mock("~/zerops/useGitBrowse", () => ({
  useGitBrowse: () => ({ view: held.home, again: () => undefined }),
  useGitBrowseReads: () => ({ views: [], again: () => undefined }),
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
  held.home = { state: "unread", busy: false };
  held.source = { state: "unread", words: "Waiting for HQ…", alert: false, busy: false };
  held.sourceAsked = [];
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
      {
        ...common,
        kind: "file" as const,
        path: "src/a.ts",
        content: "export const a = 1;",
        binary: false,
      },
      "export const a = 1;",
    ],
    [
      { rev: "v1", path: "src", kind: "tree" as const },
      {
        ...common,
        kind: "tree" as const,
        path: "src",
        entries: [{ path: "a.ts", type: "blob" as const, mode: "100644", sha: "c".repeat(40) }],
      },
      "a.ts",
    ],
  ])(
    "A link with rev, path and kind still opens the same file or folder: %j",
    async (query, source, shown) => {
      held.source = { state: "known", source, busy: false, failed: false };
      const { host, close } = await browser("appdev", "Shop", query);
      try {
        expect(held.sourceAsked.at(-1)).toEqual(query);
        expect(host.textContent).toContain(shown);
      } finally {
        await close();
      }
    },
  );
});

describe("repository README", () => {
  it("Raw HTML in a README is sanitized", async () => {
    held.home = knownHome({
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
      held.home = knownHome({ path: ".github/README.md", content: `[open](${href})` });
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

  it("An image outside the repository is shown as a link and never loaded", async () => {
    held.home = knownHome({
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
