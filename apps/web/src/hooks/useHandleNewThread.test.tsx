import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const ENVIRONMENT = EnvironmentId.make("environment-1");

const state = vi.hoisted(() => ({
  servers: new Map<string, { readonly environment: { readonly zerops?: unknown } }>(),
  navigate: vi.fn(async (_to: { readonly to: string }) => {}),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ state: { matches: [] }, navigate: state.navigate }),
}));

// The environment already holds one conversation; nobody has archived it.
vi.mock("../state/entities", () => ({
  readEnvironmentAllowsWorktrees: () => false,
  readThreadShell: () => null,
  readThreadShells: () => [
    {
      id: "thread-existing",
      environmentId: "environment-1",
      archivedAt: null,
      pinned: false,
      latestUserMessageAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      createdAt: "2026-09-01T09:00:00.000Z",
    },
  ],
  useProjects: () => [],
}));

vi.mock("../state/server", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return { primaryServerSettingsAtom: Atom.make(DEFAULT_SERVER_SETTINGS) };
});

vi.mock("../state/zerops", () => ({}));

// No list read yet: only a server that runs outside Zerops is known to hold nobody.
vi.mock("../zerops/useZeropsMates", () => ({
  useZeropsMateDirectory: () =>
    new Map(
      [...state.servers].flatMap(([environmentId, server]) =>
        server.environment.zerops === undefined ? [[environmentId, null] as const] : [],
      ),
    ),
}));

vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import { useNewThreadHandler } from "./useHandleNewThread";

type NewThreadHandler = ReturnType<typeof useNewThreadHandler>;

function Probe({ receive }: { readonly receive: (handler: NewThreadHandler) => void }) {
  receive(useNewThreadHandler());
  return null;
}

function captureHandler(): NewThreadHandler {
  const handlers: NewThreadHandler[] = [];
  renderToStaticMarkup(<Probe receive={(handler) => handlers.push(handler)} />);
  return handlers[0]!;
}

describe("New thread before the candidate list is read", () => {
  beforeEach(() => {
    state.servers.clear();
    state.navigate.mockClear();
  });

  it.each<{
    readonly name: string;
    readonly environment: { readonly zerops?: unknown };
    readonly to: string;
  }>([
    {
      name: "outside Zerops creates a new draft",
      environment: {},
      to: "/draft/$draftId",
    },
    {
      name: "in Zerops, where a Mate may live, opens the conversation already there",
      environment: { zerops: { projectId: "project-1" } },
      to: "/$environmentId/$threadId",
    },
  ])("in an environment whose server runs $name", async ({ environment, to }) => {
    state.servers.set(ENVIRONMENT, { environment });

    await captureHandler()({ environmentId: ENVIRONMENT, projectId: ProjectId.make("project") });

    expect(state.navigate).toHaveBeenCalledTimes(1);
    expect(state.navigate.mock.calls[0]![0].to).toBe(to);
  });
});
