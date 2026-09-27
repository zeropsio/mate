import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId, ThreadId, type CrewSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

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

import { CrewLaneBar } from "./CrewLaneBar";

const THREAD = {
  environmentId: EnvironmentId.make("env-fen"),
  threadId: ThreadId.make("thread-crew-backend-2"),
};

const render = (handle: string) =>
  renderToStaticMarkup(<CrewLaneBar handle={handle} threadRef={THREAD} />);

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
    expect(html).toContain(">Land now<");
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
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Land now<\/button>/u);
  });
});
