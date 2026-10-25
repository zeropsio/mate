// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import DiffPanel from "./DiffPanel";
import { useRightPanelStore } from "../rightPanelStore";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const input = vi.hoisted(() => {
  /** A checkout's status as the Git page reads it. */
  const status = (changed: number, aheadOfMain: number) => ({
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "work",
    hasWorkingTreeChanges: changed > 0,
    workingTree: {
      files: Array.from({ length: changed }, (_, index) => ({
        path: `file-${index}.ts`,
        insertions: 1,
        deletions: 0,
      })),
      insertions: changed,
      deletions: 0,
    },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    aheadOfDefaultCount: aheadOfMain,
    pr: null,
  });
  const checkout = (name: string, changed: number, aheadOfMain: number) => ({
    repository: { name, label: name, cwd: `/var/www/${name}` },
    status: status(changed, aheadOfMain),
  });
  return {
    checkout,
    selection: { kind: "branch", baseRef: null } as {
      kind: string;
      baseRef?: null;
      repository?: string;
    },
    source: "local",
    error: "Local refs refused." as string | null,
    /** Why git could not read the shown diff; `null` while it reads it. */
    previewFailure: null as string | null,
    pending: false,
    retained: false,
    otherKnown: false,
    refreshes: { preview: vi.fn(), local: vi.fn(), remote: vi.fn() },
    statusRefreshes: vi.fn(),
    repositories: {
      reads: [checkout("apidev", 0, 1)] as ReadonlyArray<unknown> | null,
      gitPage: true,
    },
    previews: [] as Array<string>,
    /** The comparison base each preview asked git for; `null` where it left it to the server. */
    previewBases: [] as Array<string | null>,
  };
});
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ environmentId: "mate", threadId: "thread" }),
}));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: () => ({ wordWrap: false, diffIgnoreWhitespace: false }),
}));
vi.mock("./useDiffRepositories", () => ({ useDiffRepositories: () => input.repositories }));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => () => {} }));
vi.mock("../state/entities", () => ({
  useThread: () => ({
    id: "thread",
    environmentId: "mate",
    projectId: "project",
    worktreePath: null,
  }),
  useProject: () => ({ workspaceRoot: "/work", repositoryIdentity: null }),
}));
vi.mock("../diffPanelStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../diffPanelStore")>();
  return {
    ...actual,
    useDiffPanelStore: (select: (state: unknown) => unknown) =>
      select({
        diffRenderMode: "unified",
        setDiffRenderMode: () => {},
        byThreadKey: { "mate:thread": { kind: "branch", baseRef: null } },
      }),
    selectThreadDiffPanelSelection: () => input.selection,
  };
});
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === "refresh-status" ? input.statusRefreshes : async () => {},
}));
vi.mock("../state/vcs", () => ({
  vcsEnvironment: {
    status: () => "status",
    refreshStatus: "refresh-status",
    listRefs: ({ input }: { input: { refKind: string } }) => input.refKind,
  },
}));
vi.mock("../state/review", () => ({
  reviewEnvironment: {
    diffPreview: (query: { input: { cwd: string; baseRef?: string } }) => {
      input.previews.push(query.input.cwd);
      input.previewBases.push(query.input.baseRef ?? null);
      return "preview";
    },
    diffFileContents: {},
  },
}));
vi.mock("../state/server", () => ({ serverEnvironment: { configValueAtom: () => null } }));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
  useEnvironmentQuery: (key: string | null) => ({
    data:
      key === "preview"
        ? input.previewFailure !== null
          ? null
          : {
              cwd: "/work",
              sources: [
                {
                  kind: "branch-range",
                  baseRef: "main",
                  headRef: "work",
                  diff: "",
                  truncated: false,
                },
              ],
            }
        : key === input.source
          ? input.retained
            ? { refs: [{ name: "main", current: false, isDefault: true, worktreePath: null }] }
            : null
          : key === "local" || key === "remote"
            ? {
                refs: input.otherKnown
                  ? [
                      {
                        name: "origin/main",
                        current: false,
                        isDefault: true,
                        worktreePath: null,
                        isRemote: true,
                      },
                    ]
                  : [],
              }
            : null,
    error: key === "preview" ? input.previewFailure : key === input.source ? input.error : null,
    isPending: key === input.source && input.pending,
    refresh:
      key === "preview" || key === "local" || key === "remote" ? input.refreshes[key] : () => {},
  }),
}));
vi.mock("./ui/combobox", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Combobox: Part,
    ComboboxEmpty: Part,
    ComboboxList: Part,
    ComboboxPopup: Part,
    ComboboxItem: Part,
    ComboboxTrigger: Part,
    ComboboxSearchInput: () => null,
  };
});

it.each([
  {
    name: "local",
    source: "local",
    error: "Local refs refused.",
    pending: false,
    expected: "Local refs refused.",
    retained: false,
    otherKnown: false,
    empty: false,
  },
  {
    name: "remote",
    source: "remote",
    error: "Remote refs refused.",
    pending: false,
    expected: "Remote refs refused.",
    retained: false,
    otherKnown: false,
    empty: false,
  },
  {
    name: "loading",
    source: "local",
    error: null,
    pending: true,
    expected: "Loading refs...",
    retained: false,
    otherKnown: false,
    empty: false,
  },
  {
    name: "one failure with other source retained",
    source: "local",
    error: "Local refs refused.",
    pending: false,
    expected: "Local refs refused.",
    retained: false,
    otherKnown: true,
    empty: false,
  },
  {
    name: "retained after failure",
    source: "local",
    error: "Local refs refused.",
    pending: false,
    expected: "Local refs refused.",
    retained: true,
    otherKnown: false,
    empty: false,
  },
  {
    name: "empty",
    source: "neither",
    error: null,
    pending: false,
    expected: "No matching refs.",
    retained: false,
    otherKnown: false,
    empty: true,
  },
])("DiffPanel distinguishes $name from matching no refs", ({ expected, empty, ...read }) => {
  Object.assign(input, read);
  const html = renderToStaticMarkup(
    <DiffPanel composerDraftTarget={{ environmentId: "mate", threadId: "thread" } as never} />,
  );
  expect(html).toContain(expected);
  expect(html.includes("No matching refs.")).toBe(empty);
  if (read.retained) expect(html).toContain("Showing last-known refs.");
  if (read.otherKnown) expect(html).toContain("origin/main");
});

vi.mock("./diffs/AnnotatableCodeView", () => ({ AnnotatableCodeView: () => null }));

it.each(["toolbar", "failed read"])(
  "%s offers Refresh diff to retry the preview and both ref lists",
  async (location) => {
    Object.assign(input, {
      source: "local",
      error: "Local refs refused.",
      pending: false,
      retained: false,
      otherKnown: false,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(() =>
        root.render(
          <DiffPanel
            composerDraftTarget={{ environmentId: "mate", threadId: "thread" } as never}
          />,
        ),
      );
      Object.values(input.refreshes).forEach((refresh) => refresh.mockClear());
      const button =
        location === "toolbar"
          ? container.querySelector<HTMLButtonElement>('button[aria-label="Refresh diff"]')
          : container.querySelector<HTMLButtonElement>('[role="status"] button');
      expect(button).not.toBeNull();
      expect(button?.textContent || button?.getAttribute("aria-label")).toContain("Refresh diff");
      await act(() => button!.click());
      expect(input.refreshes.preview).toHaveBeenCalledOnce();
      expect(input.refreshes.local).toHaveBeenCalledOnce();
      expect(input.refreshes.remote).toHaveBeenCalledOnce();
    } finally {
      await act(() => root.unmount());
      container.remove();
    }
  },
);

it("Refresh reads every repository's git status again, so what Diff offers follows a commit or a push", async () => {
  const restore = withReads([input.checkout("apidev", 1, 0), input.checkout("appdev", 0, 2)]);
  try {
    await withDiff(async (container) => {
      input.statusRefreshes.mockClear();
      await act(() =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Refresh diff"]')!.click(),
      );
      expect(input.statusRefreshes.mock.calls.map(([call]) => call)).toEqual([
        { environmentId: "mate", input: { cwd: "/var/www/apidev" } },
        { environmentId: "mate", input: { cwd: "/var/www/appdev" } },
      ]);
    });
  } finally {
    restore();
  }
});

/** Renders Diff for the conversation and hands its container to `look`. */
async function withDiff(look: (container: HTMLElement) => Promise<void> | void) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() =>
      root.render(
        <DiffPanel composerDraftTarget={{ environmentId: "mate", threadId: "thread" } as never} />,
      ),
    );
    await look(container);
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
}

function withReads(reads: ReadonlyArray<unknown> | null, selection = input.selection) {
  const before = { reads: input.repositories.reads, selection: input.selection };
  input.repositories.reads = reads;
  input.selection = selection;
  input.previews.length = 0;
  input.previewBases.length = 0;
  return () => {
    input.repositories.reads = before.reads;
    input.selection = before.selection;
  };
}

it("Diff offers each repository's files not committed and commits not on main, counted as the Git page counts them", async () => {
  const restore = withReads([input.checkout("apidev", 2, 0), input.checkout("appdev", 0, 3)], {
    kind: "unstaged",
  });
  try {
    await withDiff(async (container) => {
      const menu = container.querySelector<HTMLButtonElement>('button[aria-label^="Diff shows"]');
      expect(menu?.getAttribute("aria-label")).toBe("Diff shows: apidev · Not committed");
      await act(async () => {
        menu!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
        menu!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        menu!.click();
      });
      const items = Array.from(document.querySelectorAll('[role="menuitemradio"]'), (item) =>
        item.textContent?.trim(),
      );
      expect(items).toEqual([
        "Not committed2 files",
        "Not on main0 commits",
        "Not committed0 files",
        "Not on main3 commits",
      ]);
    });
  } finally {
    restore();
  }
});

it("a Mate's Diff reads git in the checkout it shows, never a saved turn", async () => {
  const restore = withReads([input.checkout("apidev", 0, 0), input.checkout("appdev", 1, 0)], {
    kind: "unstaged",
  });
  try {
    await withDiff(() => {
      expect(input.previews).toContain("/var/www/appdev");
      expect(input.previews).not.toContain("/var/www/apidev");
    });
  } finally {
    restore();
  }
});

it("on main, Diff shows the commits not pushed it counts, from git's upstream, on any Mate's server", async () => {
  const onMain = input.checkout("apidev", 0, 0);
  const restore = withReads(
    [
      {
        ...onMain,
        status: { ...onMain.status, isDefaultRef: true, refName: "main", aheadCount: 2 },
      },
    ],
    { kind: "unstaged" },
  );
  try {
    await withDiff((container) => {
      expect(
        container.querySelector('button[aria-label^="Diff shows"]')?.getAttribute("aria-label"),
      ).toBe("Diff shows: Not pushed");
      expect(input.previews.at(-1)).toBe("/var/www/apidev");
      expect(input.previewBases.at(-1)).toBe("@{upstream}");
    });
  } finally {
    restore();
  }
});

it("with nothing outside main, Diff says so, offers no views of nothing, and opens the Git page", async () => {
  const restore = withReads([input.checkout("apidev", 0, 0)], { kind: "unstaged" });
  const open = vi.spyOn(useRightPanelStore.getState(), "open");
  try {
    await withDiff(async (container) => {
      expect(container.textContent).toContain("Nothing outside main.");
      expect(container.querySelector('[aria-label="Hide whitespace changes"]')).toBeNull();
      expect(input.previews).toEqual([]);
      const button = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === "Open Git",
      );
      expect(button).toBeDefined();
      await act(() => button!.click());
      expect(open).toHaveBeenCalledWith({ environmentId: "mate", threadId: "thread" }, "git");
    });
  } finally {
    open.mockRestore();
    restore();
  }
});

it.each([
  { name: "no checkout", reads: [], says: "No code here yet." },
  { name: "its checkouts still read", reads: null, says: "Reading git..." },
])("a Mate's Diff with $name never says nothing changed", async ({ reads, says }) => {
  const restore = withReads(reads, { kind: "unstaged" });
  try {
    await withDiff((container) => {
      expect(container.textContent).toContain(says);
      expect(container.textContent).not.toContain("Nothing outside main.");
      expect(input.previews).toEqual([]);
    });
  } finally {
    restore();
  }
});

it("Diff of changes it shows offers the Git page beside them", async () => {
  const restore = withReads([input.checkout("apidev", 1, 0)], { kind: "unstaged" });
  try {
    await withDiff((container) => {
      expect(
        Array.from(container.querySelectorAll("button"), (button) => button.textContent),
      ).toContain("Open Git");
    });
  } finally {
    restore();
  }
});

it("a diff git could not read says so and offers to read it again, never that there is no patch", async () => {
  const restore = withReads([input.checkout("apidev", 1, 0)], { kind: "unstaged" });
  input.previewFailure =
    "Git command failed in GitVcsDriver.readUnifiedWorkingTreeReviewDiff.addUntracked (/var/www/apidev): Git command exited with a non-zero status.";
  try {
    await withDiff(async (container) => {
      expect(container.textContent).toContain("Could not read the diff.");
      expect(container.textContent).toContain(input.previewFailure);
      expect(container.textContent).not.toContain("No patch available");
      input.refreshes.preview.mockClear();
      input.statusRefreshes.mockClear();
      const again = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Try again",
      );
      expect(again).toBeDefined();
      await act(() => again!.click());
      expect(input.refreshes.preview).toHaveBeenCalledOnce();
      expect(input.statusRefreshes).toHaveBeenCalledWith({
        environmentId: "mate",
        input: { cwd: "/var/www/apidev" },
      });
    });
  } finally {
    input.previewFailure = null;
    restore();
  }
});
