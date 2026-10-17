// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { RepositorySource } from "@t3tools/shared/hqGit";
import { ZeropsRepositorySource, ZeropsRepositoryBrowser } from "./ZeropsRepositoryBrowser";

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

vi.mock("~/zerops/useRepositorySource", () => ({
  useRepositorySource: () => ({
    source: { state: "unread", words: "Waiting for HQ…", alert: false, busy: false },
    again: () => undefined,
  }),
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

async function browser(repo = "appdev", project = "Shop & Tools") {
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
        query={{ path: "", kind: "tree" }}
        onNavigate={() => {}}
        onBack={() => {}}
      />,
    ),
  );
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
async function enter(host: HTMLElement, url: string) {
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
      "https://github.com/settings/personal-access-tokens/new?name=Mate+Shop+%26+Tools&target_name=acme&expires_in=366&contents=write&workflows=write&checks=read&statuses=read&actions=read",
    );
    expect(host.textContent).toContain("Only select repositories");
    expect(host.textContent).toContain("acme/widgets");
    expect(host.textContent).toContain("Resource owner: acme");
    expect(host.textContent).toContain("Direct push to a branch only");
    expect(host.textContent).toContain("This guide does not connect a repository or check access.");
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(host.textContent).toContain("Contents: Read and write");
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
    expect(host.querySelector('input[aria-label="Repository HTTPS URL"]')).toBeNull();
    expect(host.textContent).toContain("Clone with HTTPS");
    expect(host.textContent).toContain("Open changes");
  } finally {
    await close();
  }
});
