import type { VcsStatusResult } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import GitActionsControl from "./GitActionsControl";

const input = vi.hoisted(() => ({
  error: "Status refused." as string | null,
  pending: false,
  data: null as unknown,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => () => {} }));
vi.mock("../state/entities", () => ({ useThreadShell: () => null }));
vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: (select: (store: unknown) => unknown) =>
    select({ getDraftThreadByRef: () => null, setDraftThreadContext: () => {} }),
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => async () => {} }));
vi.mock("../lib/sourceControlActions", () => ({
  useGitStackedAction: () => async () => {},
  useSourceControlActionRunning: () => false,
  useSourceControlPublishRepositoryAction: () => async () => {},
  useVcsInitAction: () => async () => {},
  useVcsPullAction: () => async () => {},
}));
vi.mock("../state/vcs", () => ({
  vcsEnvironment: { status: () => "status", refreshStatus: {} },
}));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
  useEnvironmentQuery: (key: unknown) =>
    key === "status"
      ? { ...input, isPending: input.pending, refresh: () => {} }
      : { data: null, error: null, isPending: false, refresh: () => {} },
}));
// Inspect the dialog's actual consumer content; portal visibility is the dialog primitive's contract.
vi.mock("./ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Part,
    DialogDescription: Part,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogPanel: Part,
    DialogPopup: Part,
    DialogTitle: Part,
  };
});

const emptyStatus: VcsStatusResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "work",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};
it.each([
  {
    name: "failed",
    error: "Status refused.",
    pending: false,
    data: null,
    expected: "Status refused.",
    empty: false,
  },
  {
    name: "loading",
    error: null,
    pending: true,
    data: null,
    expected: "Loading changed files...",
    empty: false,
  },
  {
    name: "unavailable",
    error: null,
    pending: false,
    data: null,
    expected: "Changed files unavailable.",
    empty: false,
  },
  { name: "empty", error: null, pending: false, data: emptyStatus, expected: "none", empty: true },
  {
    name: "retained empty after failure",
    error: "Status refused.",
    pending: false,
    data: emptyStatus,
    expected: "Status refused.",
    empty: false,
  },
])(
  "GitActionsControl dialog distinguishes $name from no changed files",
  ({ error, pending, data, expected, empty }) => {
    Object.assign(input, { error, pending, data });
    const text = renderToStaticMarkup(
      <GitActionsControl
        gitCwd="/work"
        activeThreadRef={{ environmentId: "mate", threadId: "thread" } as never}
      />,
    ).replace(/<[^>]*>/gu, "");
    expect(text).toContain(expected);
    expect(text.includes("none")).toBe(empty);
  },
);
