// @vitest-environment happy-dom
/**
 * A commit row on the Git tab opens that commit's changes — its files, read from the checkout
 * it lives in — and one press brings the commit list back.
 */
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import {
  EnvironmentId,
  ThreadId,
  type ReviewDiffPreviewInput,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsGitTab, type ZeropsGitTabProps } from "./ZeropsGitTab";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const PATCH = [
  "diff --git a/menu.txt b/menu.txt",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/menu.txt",
  "@@ -0,0 +1 @@",
  "+green tea",
  "",
].join("\n");

const reads = vi.hoisted(() => ({ previews: [] as Array<unknown> }));

vi.mock("../../zerops/useProjectTopology", () => ({
  useProjectTopology: () => ({
    view: { services: [{ hostname: "shopdev", group: "runtimes" }] },
    error: undefined,
    again: () => {},
    liveness: "live",
  }),
}));
vi.mock("../../zerops/useZeropsGroupRecipe", () => ({
  useZeropsGroupRecipe: () => ({ tier: undefined }),
}));
vi.mock("../../zerops/useZeropsGitRemoteProbe", () => ({
  checkoutPathFor: (hostname: string) => `/var/www/${hostname}`,
  useGitRemoteReads: () => new Map(),
}));
vi.mock("../../state/sourceControlActions", () => ({
  useVcsPullAction: () => ({ isPending: false, error: null, run: async () => {} }),
}));
vi.mock("~/zerops/useZeropsChangeDetail", () => ({
  mergedMain: () => undefined,
}));
vi.mock("~/zerops/useZeropsChangeCommits", () => ({
  useZeropsChangeCommits: () => ({
    readout: {
      kind: "read",
      value: { commits: [{ sha: SHA, subject: "Add the menu", at: "2026-10-02T11:00:00Z" }] },
    },
    retry: () => {},
  }),
}));
vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => Date.parse("2026-10-02T12:00:00Z") }));
// The query hook hands back what each read below answers, as the data layer would.
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (answer: unknown) =>
    answer ?? { data: null, error: null, isPending: false, refresh: () => {} },
}));
vi.mock("~/state/vcs", () => ({
  vcsEnvironment: {
    status: () => ({ data: null, error: null, isPending: false, refresh: () => {} }),
  },
}));
vi.mock("~/state/review", () => ({
  reviewEnvironment: {
    diffFileContents: {},
    diffPreview: (target: { readonly input: ReviewDiffPreviewInput }) => {
      reads.previews.push(target.input);
      return {
        data: {
          cwd: target.input.cwd,
          generatedAt: DateTime.makeUnsafe(0),
          sources: [
            {
              id: "commit",
              kind: "branch-range",
              title: "Commit 0123456",
              baseRef: "f".repeat(40),
              headRef: SHA,
              diff: PATCH,
              diffHash: "h",
              truncated: false,
              files: [{ path: "menu.txt", previousPath: null, additions: 1, deletions: 0 }],
            },
          ],
        },
        error: null,
        isPending: false,
        refresh: () => {},
      };
    },
  },
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => async () => ({}) }));
vi.mock("~/hooks/useSettings", () => ({ useClientSettings: () => ({ wordWrap: false }) }));
vi.mock("../diffs/AnnotatableCodeView", () => ({
  AnnotatableCodeView: (props: {
    readonly files: ReadonlyArray<{ readonly filePath: string }>;
  }) => (
    <ul aria-label="Changed files">
      {props.files.map((file) => (
        <li key={file.filePath}>{file.filePath}</li>
      ))}
    </ul>
  ),
}));

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("mate-shop"),
  threadId: ThreadId.make("thread-shop"),
};

const change = {
  repository: "shopdev",
  number: 3,
  title: "Add the menu",
  kind: "code",
  mateProjectId: "project-nova",
  url: undefined,
  mergeability: "clean",
  behind: false,
  merged: false,
  mergedAt: undefined,
  headSha: SHA,
  baseBranch: "main",
  line: "#3",
  updatedAt: "2026-10-02T11:00:00Z",
} as unknown as FlowPullRequest;

const props: ZeropsGitTabProps = {
  threadRef,
  appId: "app-tea-shop",
  declarations: [],
  changes: { pullRequests: [change], merged: [] },
  mateProjectId: "project-nova",
  isOwner: true,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  reads.previews = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<ZeropsGitTab {...props} />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const commitRow = () =>
  [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Add the menu"),
  );
const visible = (element: Element | null) =>
  element !== null && element.closest("[hidden], .hidden") === null;

/** Presses the row, then lets the code view's chunk arrive. */
const openCommit = async () => {
  act(() =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "History")
      ?.click(),
  );
  act(() => commitRow()?.click());
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Changed files"]')).not.toBeNull());
};

describe("a commit on the Git tab", () => {
  it("opens that commit's changes, read from the checkout it lives in", async () => {
    expect(host.querySelector('[aria-label="Changed files"]')).toBeNull();

    await openCommit();

    expect(reads.previews).toContainEqual({ cwd: "/var/www/shopdev", commit: SHA });
    expect(host.querySelector('[aria-label="Changed files"]')?.textContent).toContain("menu.txt");
    expect(host.querySelector('[aria-label="Commit 0123456"]')?.textContent).toContain(
      "Add the menu",
    );
    expect(visible(host.querySelector('[data-zerops-surface="git-commits"]'))).toBe(false);
  });

  it("returns to the commit list with one press", async () => {
    await openCommit();
    expect(host.querySelector('[aria-label="Changed files"]')).not.toBeNull();

    act(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Back to commits"]')?.click(),
    );

    expect(host.querySelector('[aria-label="Changed files"]')).toBeNull();
    expect(visible(host.querySelector('[data-zerops-surface="git-commits"]'))).toBe(true);
  });
});
