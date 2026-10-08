import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import DiffPanel from "./DiffPanel";

const input = vi.hoisted(() => ({
  source: "local",
  error: "Local refs refused." as string | null,
  pending: false,
  retained: false,
  otherKnown: false,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ environmentId: "mate", threadId: "thread" }),
}));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: () => ({ wordWrap: false, diffIgnoreWhitespace: false }),
}));
vi.mock("../hooks/useTurnDiffSummaries", () => ({
  useTurnDiffSummaries: () => ({ turnDiffSummaries: [], inferredCheckpointTurnCountByTurnId: {} }),
}));
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
    selectThreadDiffPanelSelection: () => ({ kind: "branch", baseRef: null }),
  };
});
vi.mock("../lib/checkpointDiffState", () => ({
  useCheckpointDiff: () => ({ data: null, error: null, isPending: false }),
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => async () => {} }));
vi.mock("../state/vcs", () => ({
  vcsEnvironment: {
    status: () => "status",
    listRefs: ({ input }: { input: { refKind: string } }) => input.refKind,
  },
}));
vi.mock("../state/review", () => ({
  reviewEnvironment: { diffPreview: () => "preview", diffFileContents: {} },
}));
vi.mock("../state/server", () => ({ serverEnvironment: { configValueAtom: () => null } }));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
  useEnvironmentQuery: (key: string | null) => ({
    data:
      key === "preview"
        ? {
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
        : key === "status"
          ? { isRepo: true }
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
    error: key === input.source ? input.error : null,
    isPending: key === input.source && input.pending,
    refresh: () => {},
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
vi.mock("./CheckpointHistoryDiff", () => ({ CheckpointHistoryDiff: () => null }));
