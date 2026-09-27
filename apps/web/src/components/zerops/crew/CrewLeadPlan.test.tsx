import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { CrewSnapshot, EnvironmentId } from "@t3tools/contracts";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { buttonsLabelled, elementsOf, press, TestNode } from "../../../zerops/__fixtures__/testDom";

const state = vi.hoisted(() => ({
  snapshot: null as CrewSnapshot | null,
  send: (() => Promise.resolve(null)) as (command: unknown) => Promise<unknown>,
}));

vi.mock("~/zerops/crew/useCrew", () => ({
  useCrew: () => ({
    snapshot: state.snapshot,
    current: true,
    view:
      state.snapshot === null
        ? null
        : deriveCrewView(state.snapshot, [], () => {
            throw new Error("no shells here");
          }),
  }),
}));
vi.mock("~/zerops/crew/useCrewCommand", () => ({
  useCrewCommand: () => ({
    send: (command: unknown) => state.send(command),
    pending: false,
    error: null,
    clearError: () => undefined,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate: async () => undefined }),
}));
// The test DOM draws no SVG and no portal: faces and icons are left out,
// sheets and the run dialog drawn in place.
vi.mock("../primitives", async (original) => ({
  ...(await original<typeof import("../primitives")>()),
  MateFace: () => null,
}));
vi.mock("lucide-react", async (original) => ({
  ...(await original<typeof import("lucide-react")>()),
  X: () => null,
}));
vi.mock("~/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { readonly open: boolean; readonly children: ReactNode }) =>
    open ? children : null,
  SheetPopup: ({ children }: { readonly children: ReactNode }) => children,
}));
vi.mock("./CrewBoardPanel", async (original) => ({
  ...(await original<typeof import("./CrewBoardPanel")>()),
  CrewTaskSheetBody: ({ task }: { readonly task: { readonly id: string } }) => (
    <div data-task-sheet={task.id} />
  ),
}));
vi.mock("./CrewRunDialog", () => ({
  CrewRunDialog: ({
    open,
    onStarted,
  }: {
    readonly open: boolean;
    readonly onStarted?: () => void;
  }) =>
    open ? (
      <button onClick={() => onStarted?.()} type="button">
        Run started
      </button>
    ) : null,
}));

import { CrewLeadPlan } from "./CrewLeadPlan";

function installTestDom(): TestNode {
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
  return document;
}

/** Mounts `element`, hands its container to each step in its own act, and unmounts. */
async function mounted(
  element: ReactElement,
  ...steps: ReadonlyArray<(container: TestNode) => void>
): Promise<void> {
  const document = installTestDom();
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  const root = createRoot(container as unknown as Element);
  try {
    await act(async () => root.render(element));
    for (const step of steps) await act(async () => step(container));
  } finally {
    await act(async () => root.unmount());
  }
}

const PLAN = <CrewLeadPlan environmentId={"env-fen" as EnvironmentId} />;
const ACCEPT = { _tag: "planAccept", taskIds: ["task-16"] };
const DISCARD = { _tag: "planDiscard", taskIds: ["task-16"] };

describe("CrewLeadPlan", () => {
  const sent: Array<unknown> = [];
  beforeEach(() => {
    sent.length = 0;
    state.snapshot = crewSnapshotFixture();
    state.send = (command) => {
      sent.push(command);
      return Promise.resolve({ _tag: "done" });
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws the lead's proposed tasks as one plan: a row per task, Start, Edit, Discard", async () => {
    await mounted(PLAN, (container) => {
      expect(container.textContent).toContain("Plan · 1 task");
      expect(container.textContent).toContain("Rate-limit the public API");
      for (const label of ["Start", "Edit", "Discard"]) {
        expect(buttonsLabelled(container, label)).toHaveLength(1);
      }
    });
  });

  it("draws nothing while the lead proposes nothing", async () => {
    const fixture = crewSnapshotFixture();
    state.snapshot = {
      ...fixture,
      board: { tasks: fixture.board.tasks.filter((task) => task.state !== "proposed") },
    };
    await mounted(PLAN, (container) => {
      expect(container.textContent).toBe("");
    });
  });

  it("Start accepts the plan at once while a run is on", async () => {
    await mounted(PLAN, (container) => press(buttonsLabelled(container, "Start")[0]!));
    expect(sent).toEqual([ACCEPT]);
  });

  it("Start with no run on starts a run first, then accepts the plan", async () => {
    state.snapshot = crewSnapshotFixture({ run: null });
    await mounted(
      PLAN,
      (container) => press(buttonsLabelled(container, "Start")[0]!),
      (container) => {
        expect(sent).toEqual([]);
        press(buttonsLabelled(container, "Run started")[0]!);
      },
    );
    expect(sent).toEqual([ACCEPT]);
  });

  it("Discard discards the plan's rows", async () => {
    await mounted(PLAN, (container) => press(buttonsLabelled(container, "Discard")[0]!));
    expect(sent).toEqual([DISCARD]);
  });

  it("Edit opens a row's task to edit, and takes a row out of the plan", async () => {
    await mounted(
      PLAN,
      (container) => press(buttonsLabelled(container, "Edit")[0]!),
      (container) => press(buttonsLabelled(container, "Rate-limit the public API")[0]!),
      (container) => {
        expect(
          elementsOf(container, "div").some(
            (node) => node.getAttribute("data-task-sheet") === "task-16",
          ),
        ).toBe(true);
        press(
          elementsOf(container, "button").find(
            (node) => node.getAttribute("aria-label") === "Remove #16 from the plan",
          )!,
        );
      },
    );
    expect(sent).toEqual([DISCARD]);
  });
});
