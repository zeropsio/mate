import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";

const ENVIRONMENT = EnvironmentId.make("environment-fen");
const MAIN = scopeThreadRef(ENVIRONMENT, ThreadId.make("thread-main"));
const ADA = "u-ada";

const world = vi.hoisted(() => ({
  viewer: "u-ada" as string | undefined,
  standUp: { by: "u-ada" } as { readonly by: string } | undefined,
  threads: [] as ReadonlyArray<Record<string, unknown>>,
  failed: false,
  retry: vi.fn(async (_input: unknown) => ({ _tag: "Success", value: true })),
}));

vi.mock("./accountEnvironments", () => ({
  useMateOfEnvironment: () => ({ origin: "https://mate.test" }),
}));
vi.mock("./useMateSetup", () => ({
  useMateSetup: () => ({
    setup: {
      at: "",
      standup: world.failed ? "failed" : "waiting",
      ...(world.failed ? { standupFailure: "send_failed" } : {}),
    },
    failure: undefined,
  }),
  refreshMateSetup: vi.fn(),
}));
vi.mock("../state/zeropsCommands", () => ({ zeropsCommands: { standUpRetry: {} } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => world.retry }));

vi.mock("./useZeropsMates", () => ({
  useZeropsMateDirectory: () =>
    new Map([
      [
        "environment-fen",
        {
          name: "Fen",
          tint: "olive",
          project: "Acme Docs",
          projectUrl: "https://app.zerops.io/project/p1",
          connected: true,
          ...(world.standUp === undefined ? {} : { standUp: world.standUp }),
        },
      ],
    ]),
}));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () =>
    world.viewer === undefined ? null : { user: { id: world.viewer } },
}));
vi.mock("../state/entities", () => ({
  useThreadShells: () => world.threads,
}));

function shell(ref: ScopedThreadRef, createdAt: string) {
  return {
    id: ref.threadId,
    environmentId: ref.environmentId,
    archivedAt: null,
    createdAt,
    updatedAt: createdAt,
    latestUserMessageAt: null,
  };
}

/** What the composer reads of the stand-up, for the conversation as `threadRef` holds it. */
async function holdsComposer(
  threadRef: ScopedThreadRef | null,
  messageCount: number,
  again = false,
) {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  const { createRoot } = await import("react-dom/client");
  const { useMateStandUp } = await import("./useMateStandUp");
  const held: Array<boolean> = [];
  const readings: Array<ReturnType<typeof useMateStandUp>> = [];
  function View() {
    const state = useMateStandUp({ environmentId: ENVIRONMENT, threadRef, messageCount });
    readings.push(state);
    held.push(state.holdsComposer);
    return null;
  }
  const root = createRoot(document.createElement("div") as unknown as Element);
  await act(async () => root.render(createElement(View)));
  if (again) await act(async () => readings.at(-1)?.retry());
  await act(async () => root.unmount());
  return { holds: held.at(-1), failed: readings.at(-1)?.sendFailed };
}

beforeEach(() => {
  world.failed = false;
  world.retry.mockClear();
  world.viewer = ADA;
  world.standUp = { by: ADA };
  world.threads = [shell(MAIN, "2026-09-29T10:00:00.000Z")];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The Mate's server sends the ask; the conversation only waits on it while its person does.
describe("useMateStandUp", () => {
  it("holds the composer for its person while the main conversation is empty", async () => {
    expect((await holdsComposer(MAIN, 0)).holds).toBe(true);
  });

  it("gives the composer back once the conversation holds a message", async () => {
    expect((await holdsComposer(MAIN, 1)).holds).toBe(false);
  });

  it("holds nothing for a colleague, whose ask it is not", async () => {
    world.viewer = "u-otto";
    expect((await holdsComposer(MAIN, 0)).holds).toBe(false);
  });

  it("holds nothing on a Mate HQ names nobody as asking for", async () => {
    world.standUp = undefined;
    expect((await holdsComposer(MAIN, 0)).holds).toBe(false);
  });
});

it("shows a failed send only for its asker in the empty main conversation", async () => {
  world.failed = true;
  expect((await holdsComposer(MAIN, 0)).failed).toBe(true);
  expect(world.retry).not.toHaveBeenCalled();
  world.viewer = "u-colleague";
  expect((await holdsComposer(MAIN, 0)).failed).toBe(false);
});

it("Try again issues one explicit attempt to this Mate and no attempt on its own", async () => {
  world.failed = true;
  await holdsComposer(MAIN, 0, true);
  expect(world.retry).toHaveBeenCalledExactlyOnceWith({ environmentId: ENVIRONMENT, input: {} });
});

it("returns the composer after a failed send while the main conversation remains empty", async () => {
  world.failed = true;
  expect((await holdsComposer(MAIN, 0)).holds).toBe(false);
});

it("holds no other chat's composer while the Mate's main stand-up waits", async () => {
  const second = scopeThreadRef(ENVIRONMENT, ThreadId.make("thread-second"));
  world.threads = [
    { ...shell(MAIN, "2026-09-29T10:00:00.000Z"), pinnedAt: "2026-09-29T10:00:00.000Z" },
    shell(second, "2026-09-29T10:01:00.000Z"),
  ];
  expect((await holdsComposer(second, 0)).holds).toBe(false);
});

it("keeps manual recovery visible when dispatch failed before creating its main conversation", async () => {
  world.failed = true;
  world.threads = [];
  expect((await holdsComposer(null, 0)).failed).toBe(true);
});
