import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AnyRouter } from "@tanstack/react-router";

const ENVIRONMENT = EnvironmentId.make("environment-1");

const state = {
  servers: new Map<string, { readonly environment: { readonly zerops?: unknown } }>(),
  navigate: vi.fn(async (_to: { readonly to: string }) => {}),
  latestUserMessageAt: "2026-09-01T10:00:00.000Z" as string | null,
};

import { useComposerDraftStore } from "../composerDraftStore";
import { bindAccountEnvironments } from "../zerops/accountEnvironments";
import { closeAccountLifetime, openAccountLifetime } from "../zerops/accountLifetime";
import { useNewThreadHandler } from "./useHandleNewThread";

const { RouterContextProvider } =
  await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
const router = {
  options: {},
  state: { matches: [] },
  navigate: state.navigate,
} as unknown as AnyRouter;

type NewThreadHandler = ReturnType<typeof useNewThreadHandler>;

function Probe({ receive }: { readonly receive: (handler: NewThreadHandler) => void }) {
  receive(useNewThreadHandler());
  return null;
}

function captureHandler(): NewThreadHandler {
  const handlers: NewThreadHandler[] = [];
  renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <Probe receive={(handler) => handlers.push(handler)} />
    </RouterContextProvider>,
  );
  return handlers[0]!;
}

describe("New thread before the candidate list is read", () => {
  beforeEach(async () => {
    state.servers.clear();
    state.navigate.mockClear();
    state.latestUserMessageAt = "2026-09-01T10:00:00.000Z";
    const entities = await import("../state/entities");
    const mates = await import("../zerops/useZeropsMates");
    const settings = await import("./useSettings");
    vi.spyOn(entities, "readEnvironmentAllowsWorktrees").mockReturnValue(false);
    vi.spyOn(entities, "readThreadShell").mockReturnValue(null);
    // The environment already holds one conversation; nobody has archived it.
    vi.spyOn(entities, "readThreadShells").mockImplementation(
      () =>
        [
          {
            id: "thread-existing",
            environmentId: "environment-1",
            archivedAt: null,
            pinnedAt: null,
            latestUserMessageAt: state.latestUserMessageAt,
            updatedAt: "2026-09-01T10:00:00.000Z",
            createdAt: "2026-09-01T09:00:00.000Z",
          },
        ] as unknown as ReturnType<typeof entities.readThreadShells>,
    );
    vi.spyOn(entities, "useProjects").mockReturnValue([]);
    // No list read yet: a server outside Zerops is known to hold nobody.
    vi.spyOn(mates, "useZeropsMateDirectory").mockImplementation(
      () =>
        new Map(
          [...state.servers].flatMap(([environmentId, server]) =>
            server.environment.zerops === undefined ? [[environmentId, null] as const] : [],
          ),
        ) as unknown as ReturnType<typeof mates.useZeropsMateDirectory>,
    );
    vi.spyOn(settings, "useClientSettings").mockImplementation(
      (() => ({})) as typeof settings.useClientSettings,
    );
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

  afterEach(() => {
    closeAccountLifetime();
    vi.restoreAllMocks();
  });

  it("opens a Mate's conversation nobody has spoken into on an empty composer", async () => {
    // Connected through the Zerops door a moment ago: the account holds its registration record.
    openAccountLifetime("user-1");
    bindAccountEnvironments({
      records: () => [
        {
          targetKey: "project-1:zcp",
          environmentId: ENVIRONMENT,
          origin: "https://zcp-1-8080.prg1.zerops.app",
          projectRef: { projectId: "project-1", orgId: "org-1" },
          name: "Todo - Vera",
        },
      ],
      subscribe: () => () => undefined,
    } as unknown as AccountEnvironments);
    state.servers.set(ENVIRONMENT, { environment: { zerops: { projectId: "project-1" } } });
    state.latestUserMessageAt = null;

    await captureHandler()({ environmentId: ENVIRONMENT, projectId: ProjectId.make("project") });

    expect(state.navigate.mock.calls[0]![0].to).toBe("/$environmentId/$threadId");
    const draft = useComposerDraftStore
      .getState()
      .getComposerDraft(scopeThreadRef(ENVIRONMENT, ThreadId.make("thread-existing")));
    expect(draft?.prompt ?? "").toBe("");
  });

  it("starts a fresh conversation where a Mate lives when the person starts over", async () => {
    state.servers.set(ENVIRONMENT, { environment: { zerops: { projectId: "project-1" } } });

    await captureHandler()(
      { environmentId: ENVIRONMENT, projectId: ProjectId.make("project") },
      { fresh: true },
    );

    expect(state.navigate.mock.calls[0]![0].to).toBe("/draft/$draftId");
  });
});
