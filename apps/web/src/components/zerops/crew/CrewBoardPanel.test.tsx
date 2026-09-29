import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import {
  deriveCrewView,
  type CrewShellInput,
  type CrewThreadRead,
} from "@t3tools/client-runtime/zerops/projections/crew";
import { ThreadId, type CrewSnapshot, type EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { buttonsLabelled, elementsOf, press, TestNode } from "../../../zerops/__fixtures__/testDom";

import { Sheet } from "~/components/ui/sheet";
import type { CrewRead } from "~/zerops/crew/useCrew";

import { CrewBoard, CrewBoardHost, CrewNewTaskBody, CrewTaskSheetBody } from "./CrewBoardPanel";
import {
  crewBoardModel,
  crewDependencyOptions,
  crewTaskOwners,
  crewTaskSheet,
  type CrewBoardFace,
  type CrewBoardModel,
} from "./CrewBoardPanel.logic";

// The run dialog the board mounts closed reads the live feed: nothing read here.
vi.mock("~/zerops/crew/useCrew", () => ({
  useCrew: () => ({ status: null, snapshot: null, view: null, current: false }),
}));
vi.mock("~/zerops/crew/useCrewCommand", () => ({
  useCrewCommand: () => ({
    send: async () => null,
    readFiles: async () => null,
    writeFiles: async () => false,
    pending: false,
    isPending: () => false,
    error: null,
    clearError: () => undefined,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate: async () => undefined }),
}));

const IDLE: CrewThreadRead = {
  status: { kind: "idle", toneId: "neutral" },
  word: null,
  working: false,
};

function viewOf(snapshot: CrewSnapshot) {
  const shells: ReadonlyArray<CrewShellInput> = snapshot.crewmates.flatMap((crewmate) =>
    crewmate.currentThreadId === null
      ? []
      : [{ id: crewmate.currentThreadId, archivedAt: null, crew: null }],
  );
  return deriveCrewView(snapshot, shells, (shell) =>
    shell.id === ThreadId.make("thread-crew-backend-2")
      ? { status: { kind: "working", toneId: "active" }, word: "Working", working: true }
      : IDLE,
  );
}

function renderBoard(
  snapshot: CrewSnapshot,
  overrides: Partial<Parameters<typeof CrewBoard>[0]> = {},
): string {
  return renderToStaticMarkup(
    <CrewBoard
      model={crewBoardModel(snapshot, viewOf(snapshot))}
      canAct
      error={null}
      planEditing={false}
      onNewTask={() => undefined}
      onOpenTask={() => undefined}
      onSend={() => undefined}
      onStartPlan={() => undefined}
      onTogglePlanEditing={() => undefined}
      {...overrides}
    />,
  );
}

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

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Mounts `element` in the test DOM, hands its container to `use`, and unmounts. */
async function mounted(element: ReactElement, use: (container: TestNode) => void): Promise<void> {
  const document = installTestDom();
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  const root = createRoot(container as unknown as Element);
  try {
    await act(async () => root.render(element));
    await act(async () => use(container));
  } finally {
    await act(async () => root.unmount());
  }
}

/** The test DOM draws no SVG, and a face says nothing its handle does not: draw none. */
function faceless(model: CrewBoardModel): CrewBoardModel {
  const noFace = (owner: CrewBoardFace): CrewBoardFace => ({ ...owner, tint: null });
  return {
    ...model,
    columns: model.columns.map((column) => ({
      ...column,
      cards: column.cards.map((card) => ({ ...card, owner: noFace(card.owner) })),
    })),
    plan: model.plan && {
      ...model.plan,
      rows: model.plan.rows.map((row) => ({ ...row, owner: noFace(row.owner) })),
    },
  };
}

/** The visible text, tags stripped, whitespace folded. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();

describe("CrewBoard", () => {
  const fixture = crewSnapshotFixture();

  it("heads its tasks with + New task, and leaves the crew's name to the section above it", () => {
    const text = textOf(renderBoard(fixture));
    expect(text.startsWith("Board + New task Waiting on you 4")).toBe(true);
    expect(text).not.toContain("Camera and HUD rework");
    expect(text).not.toContain("Running · 1 h 12 m");
    for (const heading of [
      "Waiting on you 4",
      "Working 1",
      "In review 0",
      "Queued 1",
      "Landed 2",
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("Nothing in review");
  });

  it("draws a card as its number, owner, title, status word and detail line", () => {
    const html = renderBoard(fixture);
    const card = html.slice(html.indexOf('data-crew-task="12"'));
    expect(textOf(card.slice(card.indexOf(">") + 1, card.indexOf("</button>")))).toBe(
      "#12 @backend Add pagination to /api/items Working +214 \u221212 · from a message",
    );
    expect(card).toContain('data-mate-face-tint="sky"');
    expect(card).toContain('data-mate-face-state="working"');
  });

  it("puts the lead's plan first in Waiting on you, with Start, Edit and Discard", () => {
    const html = renderBoard(fixture);
    const column = html.slice(html.indexOf('data-crew-board-column="waiting-on-you"'));
    expect(column.indexOf("data-crew-plan")).toBeLessThan(column.indexOf("data-crew-task="));
    const plan = column.slice(column.indexOf("data-crew-plan"), column.indexOf("data-crew-task="));
    expect(textOf(plan.slice(plan.indexOf(">") + 1))).toContain(
      "Plan · 1 task Lead proposes 1 task Rate-limit the public API Start Edit Discard",
    );
    expect(plan).not.toContain("Remove #16 from the plan");
    expect(renderBoard(fixture, { planEditing: true })).toContain(
      'aria-label="Remove #16 from the plan"',
    );
  });

  it("draws no plan at all while nothing is proposed", () => {
    const html = renderBoard(
      crewSnapshotFixture({
        board: { tasks: fixture.board.tasks.filter((task) => task.state !== "proposed") },
      }),
    );
    expect(html).not.toContain("data-crew-plan");
    expect(textOf(html)).not.toContain("Plan ·");
  });

  it("holds every press while the snapshot is stale or a press is in flight", () => {
    const html = renderBoard(fixture, { canAct: false });
    const disabled = (label: string) =>
      new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`, "u").test(html);
    expect(disabled("\\+ New task")).toBe(true);
    expect(disabled("Start")).toBe(true);
    expect(disabled("Discard")).toBe(true);
    // Editing the plan sends nothing; it stays open to read.
    expect(disabled("Edit")).toBe(false);
  });

  it("starts the plan, sends its Discard, and opens a card's sheet", async () => {
    const onSend = vi.fn();
    const onStartPlan = vi.fn();
    const onOpenTask = vi.fn();
    const model = faceless(crewBoardModel(fixture, viewOf(fixture)));
    await mounted(
      <CrewBoard
        model={model}
        canAct
        error={null}
        planEditing={false}
        onNewTask={() => undefined}
        onOpenTask={onOpenTask}
        onSend={onSend}
        onStartPlan={onStartPlan}
        onTogglePlanEditing={() => undefined}
      />,
      (container) => {
        press(buttonsLabelled(container, "Start")[0]!);
        const plan = elementsOf(container, "div").find((node) =>
          node.hasAttribute("data-crew-plan"),
        );
        press(buttonsLabelled(plan!, "Discard")[0]!);
        press(
          elementsOf(container, "button").find(
            (node) => node.getAttribute("data-crew-task") === "12",
          )!,
        );
      },
    );
    expect(onStartPlan.mock.calls).toEqual([[{ _tag: "planAccept", taskIds: ["task-16"] }]]);
    expect(onSend.mock.calls).toEqual([[{ _tag: "planDiscard", taskIds: ["task-16"] }]]);
    expect(onOpenTask.mock.calls).toEqual([["task-12"]]);
  });
});

describe("CrewTaskSheetBody", () => {
  const snapshot = crewSnapshotFixture({
    board: {
      tasks: crewSnapshotFixture().board.tasks.map((task) =>
        task.id === "task-13" ? { ...task, state: "ready" as const } : task,
      ),
    },
  });
  const view = viewOf(snapshot);
  const sheet = crewTaskSheet(snapshot, view, "task-13")!;
  const task = view.tasks.find((row) => row.task.id === "task-13")!.task;

  function renderSheet(
    onSend = () => undefined,
    onOpenChat = () => undefined,
    onReview: (taskId: string) => void = () => undefined,
  ) {
    return (
      <Sheet open>
        <CrewTaskSheetBody
          sheet={{ ...sheet, owner: { ...sheet.owner, tint: null } }}
          task={task}
          canAct
          error={null}
          onSend={onSend}
          onReview={onReview}
          onOpenChat={onOpenChat}
        />
      </Sheet>
    );
  }

  it("reads the task: brief, done-when, attempts, report, check and change", () => {
    expect(textOf(renderToStaticMarkup(renderSheet()))).toBe(
      [
        "#13 HUD shows the ammo count",
        "Frontend Ready to land from you",
        "Brief HUD shows the ammo count",
        "Done when The HUD shows ammo; npm test passes",
        "Attempts Attempt 1 Open Frontend's chat",
        "Report Ammo counter in the HUD, updated on fire and reload.",
        "Check Check passed Tests 31 passed (31)",
        "Changes +88 \u221230",
        "Review Discard Edit",
      ].join(" "),
    );
  });

  it("reads a fan-out task's note before its brief", () => {
    const note = "Also sent to @frontend. Your part is what is addressed to @backend.";
    const text = textOf(
      renderToStaticMarkup(
        <Sheet open>
          <CrewTaskSheetBody
            sheet={{ ...sheet, note, owner: { ...sheet.owner, tint: null } }}
            task={task}
            canAct
            error={null}
            onSend={() => undefined}
            onReview={() => undefined}
            onOpenChat={() => undefined}
          />
        </Sheet>,
      ),
    );
    expect(text).toContain(`Note ${note} Brief HUD shows the ammo count`);
  });

  it("opens the task's review, discards and opens the owner's chat — and never lands itself", async () => {
    const onSend = vi.fn();
    const onOpenChat = vi.fn();
    const onReview = vi.fn();
    await mounted(renderSheet(onSend, onOpenChat, onReview), (container) => {
      expect(buttonsLabelled(container, "Land")).toEqual([]);
      press(buttonsLabelled(container, "Review")[0]!);
      press(buttonsLabelled(container, "Discard")[0]!);
      press(buttonsLabelled(container, "Open Frontend's chat")[0]!);
    });
    expect(onReview.mock.calls).toEqual([["task-13"]]);
    expect(onSend.mock.calls).toEqual([[{ _tag: "discard", taskId: "task-13" }]]);
    expect(onOpenChat.mock.calls).toEqual([["thread-crew-frontend-1"]]);
  });
});

describe("CrewNewTaskBody", () => {
  const view = viewOf(crewSnapshotFixture());

  it("asks for an owner, a title, a brief, a done-when and what it depends on", () => {
    const html = renderToStaticMarkup(
      <Sheet open>
        <CrewNewTaskBody
          owners={crewTaskOwners(view)}
          dependencies={crewDependencyOptions(view)}
          canAct
          error="That task is no longer on the board."
          onCreate={() => undefined}
        />
      </Sheet>,
    );
    const text = textOf(html);
    expect(text).toContain("New task Owner Choose a crewmate Title Brief Done when Depends on");
    expect(text).toContain("#12 Add pagination to /api/items");
    expect(text).toContain("That task is no longer on the board.");
    // Nothing to create until it has an owner and a title.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create task<\/button>/u);
  });

  it("starts with the owner a crewmate's chat asked for", () => {
    const text = textOf(
      renderToStaticMarkup(
        <Sheet open>
          <CrewNewTaskBody
            owner="backend"
            owners={crewTaskOwners(view)}
            dependencies={crewDependencyOptions(view)}
            canAct
            error={null}
            onCreate={() => undefined}
          />
        </Sheet>,
      ),
    );
    expect(text).toContain("Owner Backend Title");
  });
});

describe("CrewBoardHost", () => {
  it("draws the board of the crew it is handed, under the section in the Crew tab", () => {
    const snapshot = crewSnapshotFixture();
    const html = renderToStaticMarkup(
      <CrewBoardHost
        current
        environmentId={"env-1" as EnvironmentId}
        snapshot={snapshot}
        view={viewOf(snapshot) as NonNullable<CrewRead["view"]>}
      />,
    );
    expect(html).toContain("data-crew-board");
    expect(textOf(html)).toContain("Board + New task Waiting on you 4");
    // The tab scrolls as one: the board has no scroll box of its own.
    expect(html).not.toContain('data-slot="scroll-area-viewport"');
  });

  it("scrolls its columns sideways on its own where they stand wider than the tab", () => {
    const snapshot = crewSnapshotFixture();
    const html = renderToStaticMarkup(
      <CrewBoardHost
        current
        environmentId={"env-1" as EnvironmentId}
        snapshot={snapshot}
        view={viewOf(snapshot) as NonNullable<CrewRead["view"]>}
      />,
    );
    const row = /<div class="([^"]*@3xl\/board:flex-row[^"]*)"/u.exec(html)?.[1] ?? "";
    // Side by side the columns scroll within the board: the section above stays put.
    expect(row.split(" ")).toContain("@3xl/board:overflow-x-auto");
  });
});
