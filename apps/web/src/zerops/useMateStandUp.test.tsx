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
}));

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
async function holdsComposer(threadRef: ScopedThreadRef | null, messageCount: number) {
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
  function View() {
    held.push(
      useMateStandUp({ environmentId: ENVIRONMENT, threadRef, messageCount }).holdsComposer,
    );
    return null;
  }
  const root = createRoot(document.createElement("div") as unknown as Element);
  await act(async () => root.render(createElement(View)));
  await act(async () => root.unmount());
  return held.at(-1);
}

beforeEach(() => {
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
    expect(await holdsComposer(MAIN, 0)).toBe(true);
  });

  it("gives the composer back once the conversation holds a message", async () => {
    expect(await holdsComposer(MAIN, 1)).toBe(false);
  });

  it("holds nothing for a colleague, whose ask it is not", async () => {
    world.viewer = "u-otto";
    expect(await holdsComposer(MAIN, 0)).toBe(false);
  });

  it("holds nothing on a Mate HQ names nobody as asking for", async () => {
    world.standUp = undefined;
    expect(await holdsComposer(MAIN, 0)).toBe(false);
  });
});
