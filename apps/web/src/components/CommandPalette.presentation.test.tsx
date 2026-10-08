// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { OpenCommandPaletteDialog } from "./CommandPalette";
const input = vi.hoisted(() => ({
  error: "Listing refused." as string | null,
  pending: false,
  data: null as unknown,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {}, useLocation: () => "/" }));
vi.mock("../hooks/useSettings", () => ({ useClientSettings: () => DEFAULT_SERVER_SETTINGS }));
vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({
    theme: "dark",
    resolvedTheme: "dark",
    themeHalves: { light: "light", dark: "dark" },
  }),
}));
vi.mock("../hooks/useCustomThemes", () => ({ useCustomThemes: () => [] }));
vi.mock("../hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: null,
    handleNewThread: () => {},
  }),
}));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      {
        environmentId: "mate",
        label: "Mate",
        connection: { phase: "connected" },
        entry: { target: { _tag: "PrimaryConnectionTarget" } },
        serverConfig: { providers: [], environment: { platform: { os: "linux" } } },
      },
    ],
  }),
  usePrimaryEnvironmentId: () => "mate",
}));
vi.mock("../state/entities", () => ({
  useProjects: () => [],
  useThreadShells: () => [],
  useAllEnvironmentShellsBootstrapped: () => true,
  waitForProject: () => {},
}));
vi.mock("../state/queries", () => ({
  useThreadSearch: () => ({ matches: [], isPending: false, incomplete: false }),
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => async () => {} }));
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => async () => {} }));
vi.mock("../routes/-environmentTargets", () => ({
  useEnvironmentLinks: () => ({ linkable: () => true }),
}));
vi.mock("../zerops/useHqMatesRead", () => ({
  useHqMatesRead: () => ({ organizationId: "org", settled: true }),
}));
vi.mock("../zerops/hqGate", () => ({ useHqGate: () => ({ gate: { kind: "open" } }) }));
vi.mock("../uiStateStore", () => ({
  useUiStateStore: (select: (store: unknown) => unknown) =>
    select({ projectOrder: [], threadLastVisitedAtById: {} }),
  legacyProjectCwdPreferenceKey: () => "",
}));
vi.mock("../state/filesystem", () => ({ filesystemEnvironment: { browse: () => "browse" } }));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
  useEnvironmentQuery: (key: unknown) => ({
    data: key === "browse" ? input.data : null,
    error: key === "browse" ? input.error : null,
    isPending: key === "browse" && input.pending,
    refresh: () => {},
  }),
}));
vi.mock("./files/ProjectFilePicker", () => ({ ProjectFilePicker: () => null }));
vi.mock("./search/ProjectContentSearchDialog", () => ({ ProjectContentSearchDialog: () => null }));

it.each([
  {
    name: "failed",
    error: "Listing refused.",
    pending: false,
    data: null,
    expected: "Listing refused.",
    create: false,
  },
  {
    name: "loading",
    error: null,
    pending: true,
    data: null,
    expected: "Loading folders...",
    create: false,
  },
  {
    name: "unavailable",
    error: null,
    pending: false,
    data: null,
    expected: "Folder listing unavailable.",
    create: false,
  },
  {
    name: "empty",
    error: null,
    pending: false,
    data: { parentPath: "/work", entries: [] },
    expected: "Create &amp; Add",
    create: true,
  },
  {
    name: "retained after failure",
    error: "Listing refused.",
    pending: false,
    data: { parentPath: "/work", entries: [] },
    expected: "Listing refused.",
    create: false,
  },
])(
  "CommandPalette distinguishes $name before suggesting folder creation",
  ({ error, pending, data, expected, create }) => {
    Object.assign(input, { error, pending, data });
    const html = renderToStaticMarkup(
      <OpenCommandPaletteDialog
        initialQuery="/work/new"
        openIntent={null}
        setOpen={() => {}}
        openOverlayMode={() => {}}
        clearOpenIntent={() => {}}
      />,
    );
    expect(html).toContain(expected);
    expect(html.includes("Create &amp; Add")).toBe(create);
    if (!create) expect(html).not.toContain("Press Enter to create");
  },
);
