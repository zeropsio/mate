import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { RepositorySource } from "@t3tools/shared/hqGit";
import { ZeropsRepositorySource, ZeropsRepositoryBrowser } from "./ZeropsRepositoryBrowser";

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
