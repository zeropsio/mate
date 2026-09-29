import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { CrewCommand, CrewSnapshot, EnvironmentId } from "@t3tools/contracts";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buttonsLabelled,
  elementsOf,
  press,
  readableText,
  TestNode,
} from "../../../zerops/__fixtures__/testDom";

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
    errorAt: () => null,
    clearError: () => undefined,
  }),
}));
vi.mock("~/zerops/useZeropsMates", () => ({
  useZeropsMate: () => ({ kind: "mate", mate: { name: "Fen" } }),
}));
// The test DOM draws no SVG and no portal: faces, icons and tooltips are left
// out, the run dialog drawn in place as the press that ends it.
vi.mock("../primitives", async (original) => ({
  ...(await original<typeof import("../primitives")>()),
  MateFace: () => null,
}));
vi.mock("lucide-react", async (original) => ({
  ...(await original<typeof import("lucide-react")>()),
  XIcon: () => null,
}));
vi.mock("./CrewRunDialog", () => ({
  CrewRunDialog: ({
    ask,
    onDone,
  }: {
    readonly ask: { readonly after: CrewCommand | null } | null;
    readonly onDone: (after: CrewCommand | null) => void;
  }) =>
    ask === null ? null : (
      <button onClick={() => onDone(ask.after)} type="button">
        Working on its own
      </button>
    ),
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

/**
 * Presses a button a tooltip wraps: its trigger reads the event, so the press
 * carries one, as React's would.
 */
function pressWithEvent(button: TestNode): void {
  const propsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"));
  const props = propsKey === undefined ? undefined : (button as never)[propsKey];
  const onClick = (props as { readonly onClick?: (event: unknown) => void } | undefined)?.onClick;
  if (onClick === undefined) throw new Error(`"${button.textContent}" has no click handler.`);
  onClick({
    nativeEvent: {},
    currentTarget: button,
    target: button,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    isDefaultPrevented: () => false,
    isPropagationStopped: () => false,
  });
}

const PLAN = <CrewLeadPlan environmentId={"env-fen" as EnvironmentId} />;
const ACCEPT = { _tag: "planAccept", taskIds: ["task-16"] };
const DROP = { _tag: "planDiscard", taskIds: ["task-16"] };

describe("CrewLeadPlan — the lead's plan in its chat", () => {
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

  it("draws a line per task, says what Start lets the crew do, then Start and Drop the plan", async () => {
    await mounted(PLAN, (container) => {
      const text = readableText(container);
      expect(text).toContain("Backend");
      expect(text).toContain("Rate-limit the public API");
      expect(text).toContain("Start lets the crew work on its own: up to $20, for up to 8 hours.");
      expect(buttonsLabelled(container, "Start")).toHaveLength(1);
      expect(buttonsLabelled(container, "Drop the plan")).toHaveLength(1);
      // Never a number, a handle, or the old board's presses.
      expect(text).not.toMatch(/#\d+|@[a-z]|Review plan|Discard|Edit/u);
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

  it("Start adds the plan to the crew's work at once while it works on its own", async () => {
    await mounted(PLAN, (container) => press(buttonsLabelled(container, "Start")[0]!));
    expect(sent).toEqual([ACCEPT]);
  });

  it("Start with the crew stopped by you goes on first, then adds the plan", async () => {
    const fixture = crewSnapshotFixture();
    state.snapshot = { ...fixture, run: { ...fixture.run!, state: "paused", reason: "person" } };
    await mounted(PLAN, (container) => press(buttonsLabelled(container, "Start")[0]!));
    expect(sent).toEqual([{ _tag: "resume", runId: "run-3" }, ACCEPT]);
  });

  it("Start before the crew ever worked on its own asks its limits first, then adds the plan", async () => {
    state.snapshot = crewSnapshotFixture({ run: null });
    await mounted(
      PLAN,
      (container) => press(buttonsLabelled(container, "Start")[0]!),
      (container) => {
        expect(sent).toEqual([]);
        press(buttonsLabelled(container, "Working on its own")[0]!);
      },
    );
    expect(sent).toEqual([ACCEPT]);
  });

  it("Drop the plan drops every line, and a line's × leaves that one out", async () => {
    await mounted(PLAN, (container) =>
      pressWithEvent(buttonsLabelled(container, "Drop the plan")[0]!),
    );
    expect(sent).toEqual([DROP]);
    sent.length = 0;
    await mounted(PLAN, (container) =>
      pressWithEvent(
        elementsOf(container, "button").find(
          (node) =>
            node.getAttribute("aria-label") === "Leave this one out: Rate-limit the public API",
        )!,
      ),
    );
    expect(sent).toEqual([DROP]);
  });
});
