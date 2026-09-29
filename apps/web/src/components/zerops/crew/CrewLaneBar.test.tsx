import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId, ThreadId, type CrewSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { buttonsLabelled, press, TestNode } from "../../../zerops/__fixtures__/testDom";

const state = vi.hoisted(() => ({ snapshot: null as CrewSnapshot | null, current: true }));

vi.mock("~/zerops/crew/useCrew", () => ({
  useCrew: () => ({
    snapshot: state.snapshot,
    current: state.current,
    view:
      state.snapshot === null
        ? null
        : deriveCrewView(state.snapshot, [], () => {
            throw new Error("no shells here");
          }),
  }),
}));
vi.mock("~/zerops/crew/useCrewCommand", () => ({
  useCrewCommand: () => ({ send: vi.fn(), pending: false, error: null, clearError: vi.fn() }),
}));
vi.mock("~/zerops/useAskMate", () => ({ useAskMate: () => vi.fn() }));
vi.mock("~/zerops/useZeropsFeeds", () => ({
  useEnvironmentProjectRef: () => null,
  useZeropsTopology: () => undefined,
}));
vi.mock("~/zerops/useZeropsMates", () => ({
  useZeropsMate: () => ({ kind: "mate", mate: { name: "Fen", tint: "amber", connected: true } }),
}));

// The test DOM draws no SVG.
vi.mock("lucide-react", async (original) => ({
  ...(await original<typeof import("lucide-react")>()),
  ExternalLinkIcon: () => null,
}));

import { CrewLaneBar } from "./CrewLaneBar";

const THREAD = {
  environmentId: EnvironmentId.make("env-fen"),
  threadId: ThreadId.make("thread-crew-backend-2"),
};

const render = (handle: string) =>
  renderToStaticMarkup(
    <CrewLaneBar handle={handle} onOpenChanges={() => undefined} threadRef={THREAD} />,
  );

describe("CrewLaneBar", () => {
  it("draws a writer's copy against your tree, its app and its presses", () => {
    state.snapshot = crewSnapshotFixture();
    const html = render("backend");
    expect(html).toContain('data-crew-lane-bar="backend"');
    expect(html).toContain("crew/backend");
    expect(html).toContain("3 changes ahead of your tree");
    expect(html).toContain("Check passed");
    expect(html).toContain("App on :3001");
    expect(html).toContain('href="https://appdev-1df2-3001.prg1.zerops.app"');
    expect(html).toContain(">Show on dev<");
    // The door to the task's review, which lands it now: the bar lands nothing itself.
    expect(html).toContain(">Review<");
    expect(html).not.toContain(">Land now<");
  });

  it("offers what only the Mate can do: crew ports, and committing your edit", () => {
    const snapshot = crewSnapshotFixture();
    state.snapshot = {
      ...snapshot,
      hosts: snapshot.hosts.map((host) => ({ ...host, crewPorts: [] })),
      attention: snapshot.attention.map((row) =>
        row.kind === "landing-wait" ? { ...row, handle: "backend" } : row,
      ),
    };
    const html = render("backend");
    expect(html).toContain("No crew ports on appdev");
    expect(html).toContain(">Add crew ports<");
    expect(html).toContain(">Commit my edit<");
  });

  it("draws nothing for a crewmate without a copy of the code", () => {
    state.snapshot = crewSnapshotFixture();
    expect(render("lead")).toBe("");
  });

  it("presses nothing on a snapshot that is no longer current", () => {
    state.snapshot = crewSnapshotFixture();
    state.current = false;
    const html = render("backend");
    state.current = true;
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Review<\/button>/u);
  });
});

describe("CrewLaneBar Changes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the copy's diff against the tip of your tree the engine read", async () => {
    state.snapshot = crewSnapshotFixture();
    const opened: Array<string | null> = [];
    const document = new TestNode("#document", null, 9);
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", {
      document,
      Element: TestNode,
      HTMLElement: TestNode,
      HTMLIFrameElement: TestNode,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener() {},
      removeEventListener() {},
    });
    vi.stubGlobal("HTMLIFrameElement", TestNode);
    vi.stubGlobal("Element", TestNode);
    vi.stubGlobal("HTMLElement", TestNode);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    const root = createRoot(container as unknown as Element);
    try {
      await act(async () =>
        root.render(
          <CrewLaneBar
            handle="backend"
            onOpenChanges={(baseRef) => opened.push(baseRef)}
            threadRef={THREAD}
          />,
        ),
      );
      await act(async () => press(buttonsLabelled(container, "Changes")[0]!));
    } finally {
      await act(async () => root.unmount());
    }
    expect(opened).toEqual(["a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"]);
  });
});
