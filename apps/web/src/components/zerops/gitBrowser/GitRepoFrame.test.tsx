import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { GitHomeAbout } from "@t3tools/shared/hqGitBrowse/home";
import { GitRepoFrame } from "./GitRepoFrame";

vi.mock("./GitRefPicker", () => ({ GitRefPicker: () => null }));
vi.mock("./GitArchiveButton", () => ({ useGitArchive: () => ({}), GitArchiveButton: () => null }));
vi.mock("../ZeropsGitCredentials", () => ({ ZeropsGitCredentials: () => null }));

const page = (storage: GitHomeAbout["storage"]) =>
  renderToStaticMarkup(
    <GitRepoFrame
      appId="app"
      repo="appdev"
      project="Shop"
      rev={undefined}
      view="home"
      home={{
        state: "known",
        busy: false,
        failed: false,
        answer: {
          ref: { name: "main", kind: "branch" },
          sha: null,
          about: {
            ...(storage === undefined ? {} : { storage }),
            remote: null,
            mirror: null,
            updatedAt: "2026-10-28T12:00:00Z",
            branchCount: 0,
            tagCount: 0,
          },
          readme: null,
        },
      }}
      changes={[]}
      onBack={() => undefined}
      onPick={() => undefined}
      onTab={() => undefined}
    />,
  );

describe("repository storage beside Clone", () => {
  it.each([
    { storage: undefined, line: "Git storage is not available yet.", large: false },
    {
      storage: {
        usedBytes: 1_300_000_000,
        limitBytes: 2_000_000_000,
        large: true,
        routeBodyLimitBytes: null,
      },
      line: "Git storage: 1.30 GB of 2.00 GB",
      large: true,
    },
    {
      storage: {
        usedBytes: 1_300_000_000,
        limitBytes: 2_000_000_000,
        large: false,
        routeBodyLimitBytes: null,
      },
      line: "Git storage: 1.30 GB of 2.00 GB",
      large: false,
    },
  ])("shows the repository metadata it reads: $line, large=$large", ({ storage, line, large }) => {
    const markup = page(storage);
    expect(markup).toContain("Clone");
    expect(markup).toContain(line);
    expect(markup.includes("Large repository")).toBe(large);
    expect(markup.includes("Starting a new workspace may take longer.")).toBe(large);
  });
});
