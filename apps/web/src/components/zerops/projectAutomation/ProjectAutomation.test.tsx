/**
 * A project's Automation section, from what is read: its pool of automated Mates with what each
 * is on, its tasks in one ledger, and its sources of tasks, one row each — a row opening its form
 * for an Owner or Admin, read alone by anyone else.
 */
import { act, type ReactElement } from "react";
import { create, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import type { HqAppTask } from "@t3tools/shared/hqIntake";

import {
  ProjectAutomationView,
  type AutomationControls,
  type BoardView,
  type PoolMate,
} from "./ProjectAutomation";
import type { SourceRow } from "./projectAutomation.logic";
import { boardOf, RECENT_SHOWN } from "./taskBoard.logic";

const NOVA: PoolMate = {
  projectId: "p-nova",
  name: "Nova",
  tint: "sky",
  shape: undefined,
  automation: {
    task: {
      number: 1,
      title: "Add a search box",
      pullRequest: { number: 2, state: "open" },
    },
  },
};
const JUNO: PoolMate = {
  projectId: "p-juno",
  name: "Juno",
  tint: "slate",
  shape: undefined,
  automation: { task: null },
};
const ROWS: ReadonlyArray<SourceRow> = [
  {
    key: "github",
    kind: "github",
    title: "GitHub issues labelled",
    label: "mate",
    detail: "acme/tea-shop",
    meta: null,
  },
  {
    key: "slack",
    kind: "slack",
    title: "#support",
    detail: "Slack",
    meta: null,
    disconnected: true,
  },
  { key: "webhook", kind: "webhook", title: "2 webhooks", detail: null, meta: null },
  {
    key: "schedule:s1",
    kind: "schedule",
    id: "s1",
    title: "Update dependencies",
    detail: "Every Monday 09:00",
    meta: null,
  },
];

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const TASK: HqAppTask = {
  id: "t1",
  title: "Add a search box",
  label: "acme/tea-shop#1",
  url: "https://github.com/acme/tea-shop/issues/1",
  state: "working",
  mate: { projectId: "p-nova", name: "Nova" },
  requestedBy: "nova-dev",
  createdAt: "2026-10-18T11:40:00.000Z",
  startedAt: "2026-10-18T11:48:00.000Z",
  endedAt: null,
  spentUsd: 0.42,
  workedMs: 600_000,
  detail: null,
  change: null,
  pullRequest: null,
  link: "https://mate.zerops.io/env-1/conversation-1",
};
const TASKS: ReadonlyArray<HqAppTask> = [
  TASK,
  {
    ...TASK,
    id: "t2",
    title: "Show prices in euros",
    label: "acme/tea-shop#3",
    state: "queued",
    position: 1,
    mate: null,
    createdAt: "2026-10-18T11:56:00.000Z",
    startedAt: null,
    spentUsd: null,
    link: null,
  },
  {
    ...TASK,
    id: "t0",
    title: "List six teas",
    state: "merged",
    endedAt: "2026-10-18T08:00:00.000Z",
    spentUsd: 0.31,
    change: { repo: "web", number: 1 },
    pullRequest: { number: 2, url: "https://github.com/acme/tea-shop/pull/2" },
  },
];

function boardView(patch: Partial<BoardView> = {}): BoardView {
  return {
    read: { state: "known", board: boardOf(TASKS, NOW, "tea-shop") },
    spend: "$6.44 of $50 this month",
    onReadAgain: vi.fn(),
    onOpen: vi.fn(),
    ...patch,
  };
}

function controls(): AutomationControls & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onAddMate: vi.fn(),
    onTakeFrom: vi.fn(),
    onEdit: vi.fn(),
    onReadAgain: vi.fn(),
    onOpenSettings: vi.fn(),
  };
}

function rendered(element: ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(element);
  });
  return tree!.root;
}

const words = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();

const buttons = (root: ReactTestInstance, label: string) =>
  root.findAll((node) => node.type === "button" && words(node) === label);

const sourceRow = (root: ReactTestInstance, kind: string) =>
  root.find((node) => node.type === "li" && node.props["data-zerops-source"] === kind);

const taskRow = (root: ReactTestInstance, id: string) =>
  root.find((node) => node.type === "li" && node.props["data-zerops-task"] === id);

const pool = (root: ReactTestInstance) =>
  root.find((node) => node.props["data-zerops-surface"] === "project-automation-pool");

const groups = (root: ReactTestInstance) =>
  root
    .findAll((node) => typeof node.props["data-zerops-board"] === "string")
    .map((node) => node.props["data-zerops-board"] as string);

describe("a project's Automation section", () => {
  it("lists its automated Mates, each with what it is on, and the way to add one", () => {
    const admin = controls();
    const root = rendered(
      <ProjectAutomationView
        admin={admin}
        board={boardView()}
        onOpenMate={vi.fn()}
        pool={[NOVA, JUNO]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={(projectId) => projectId === "p-nova"}
      />,
    );
    const text = words(root);
    expect(text).toContain("2 automated Mates · 1 at work");
    expect(text).toContain("Add a search box Nova · worked 10m $0.42");
    // Each face says what its Mate is on.
    expect(
      root
        .findAll((node) => node.props["data-zerops-surface"] === "project-automation-mate")
        .map((node) => node.props["aria-label"] as string),
    ).toContain("Nova: #1 Add a search box · PR #2 open");
    act(() => {
      buttons(root, "+ Add a Mate")[0]?.props.onClick();
    });
    expect(admin.onAddMate).toHaveBeenCalledOnce();
  });

  it("opens an automated Mate from its row", () => {
    const onOpenMate = vi.fn();
    const root = rendered(
      <ProjectAutomationView
        onOpenMate={onOpenMate}
        pool={[NOVA]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    act(() => {
      root
        .find(
          (node) =>
            node.type === "button" &&
            node.props["data-zerops-surface"] === "project-automation-mate",
        )
        .props.onClick();
    });
    expect(onOpenMate).toHaveBeenCalledWith("p-nova");
  });

  it("says in one sentence that a project has no automated Mates yet", () => {
    const root = rendered(
      <ProjectAutomationView
        admin={controls()}
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    expect(words(pool(root))).toContain("No automated Mates yet");
  });

  // witness: apps/web/src/components/zerops/projectAutomation/ProjectAutomation.tsx | admin.onEdit(row); → admin.onTakeFrom("github");
  it("names each source on its own row, which opens its form: its Stop and its Delete are there", () => {
    const admin = controls();
    const root = rendered(
      <ProjectAutomationView
        admin={admin}
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: ROWS, reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    expect(words(sourceRow(root, "github"))).toBe("GitHub issues labelled mate acme/tea-shop");
    expect(words(sourceRow(root, "webhook"))).toBe("2 webhooks");
    expect(words(sourceRow(root, "schedule"))).toBe("Update dependencies Every Monday 09:00");
    act(() => {
      sourceRow(root, "schedule")
        .find((node) => node.type === "button")
        .props.onClick();
    });
    expect(admin.onEdit).toHaveBeenCalledWith(ROWS[3]);
    for (const label of ["Edit", "Stop", "Remove", "Delete"])
      expect(buttons(root, label)).toHaveLength(0);
  });

  it("says a channel takes no tasks while its app isn't connected, with the way to connect it", () => {
    const admin = controls();
    const root = rendered(
      <ProjectAutomationView
        admin={admin}
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: ROWS, reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    const slack = sourceRow(root, "slack");
    expect(words(slack)).toContain("Not connected");
    act(() => {
      buttons(slack, "Connect")[0]?.props.onClick();
    });
    expect(admin.onOpenSettings).toHaveBeenCalledOnce();
  });

  // witness: apps/web/src/components/zerops/projectAutomation/ProjectAutomation.tsx | ) : admin === undefined ? null : ( → ) : admin !== undefined ? null : (
  it("offers each kind of source where the project takes tasks from none yet", () => {
    const admin = controls();
    const root = rendered(
      <ProjectAutomationView
        admin={admin}
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    for (const label of [
      "GitHub issues",
      "Slack channel",
      "Discord channel",
      "Webhook",
      "Schedule",
    ])
      expect(buttons(root, label)).toHaveLength(1);
    act(() => {
      buttons(root, "Schedule")[0]?.props.onClick();
    });
    expect(admin.onTakeFrom).toHaveBeenCalledWith("schedule");
  });

  it("is read alone by anyone but an Owner or Admin: no Add, Edit, Stop or Take tasks from…", () => {
    const root = rendered(
      <ProjectAutomationView
        board={boardView()}
        onOpenMate={vi.fn()}
        pool={[NOVA]}
        sources={{ rows: ROWS, reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    const text = words(root);
    expect(text).toContain("Add a search box Nova · worked 10m");
    for (const label of ["+ Add a Mate", "+ Add", "Edit", "Stop", "Remove", "Connect"])
      expect(buttons(root, label)).toHaveLength(0);
    // A source's row opens nothing for the reader.
    expect(sourceRow(root, "github").findAll((node) => node.type === "button")).toHaveLength(0);
  });

  it("never says a project takes tasks from nowhere while some of its sources are refused to the reader", () => {
    const root = rendered(
      <ProjectAutomationView
        onOpenMate={vi.fn()}
        pool={[NOVA]}
        sources={{ rows: [], reading: false, withheld: true }}
        workingOf={() => false}
      />,
    );
    expect(words(root)).not.toContain("Nowhere yet.");
    expect(words(root)).toContain("Owners and admins see every source.");
  });

  it("shows the sources the reader may see, and says Owners and admins see the rest", () => {
    const root = rendered(
      <ProjectAutomationView
        onOpenMate={vi.fn()}
        pool={[NOVA]}
        sources={{ rows: ROWS.slice(0, 1), reading: false, withheld: true }}
        workingOf={() => false}
      />,
    );
    expect(words(root)).toContain("GitHub issues labelled mate acme/tea-shop");
    expect(words(root)).toContain("Owners and admins see every source.");
  });

  it("keeps its place where HQ predates automated Mates, saying HQ needs updating", () => {
    const root = rendered(
      <ProjectAutomationView
        admin={controls()}
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: [], reading: false, withheld: false }}
        update
        workingOf={() => false}
      />,
    );
    expect(words(root)).toContain("HQ needs an update to set up automated Mates.");
    expect(words(root)).not.toContain("Takes tasks from");
    expect(buttons(root, "+ Add a Mate")).toHaveLength(0);
  });

  it("says it reads its sources until they are read", () => {
    const root = rendered(
      <ProjectAutomationView
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: [], reading: true, withheld: false }}
        workingOf={() => false}
      />,
    );
    expect(words(root)).toContain("Reading…");
  });

  it("lists what its automated Mates are on, what waits by its place, and what ended, each with its time, cost and change", () => {
    const board = boardView();
    const root = rendered(
      <ProjectAutomationView
        board={board}
        onOpenMate={vi.fn()}
        pool={[NOVA]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => true}
      />,
    );
    const block = (name: string) =>
      words(root.find((node) => node.props["data-zerops-board"] === name));
    expect(block("Queued")).toContain("1 Show prices in euros acme/tea-shop#3 Waited 4m");
    expect(block("Finished")).toContain("List six teas Merged Ended Nova · 4h ago $0.31 PR #2");
    expect(words(root)).toContain("$6.44 of $50 this month");
    // A task's row opens its conversation inside Mate.
    act(() => {
      taskRow(root, "t1")
        .find((node) => node.type === "a")
        .props.onClick({ button: 0, preventDefault: vi.fn() });
    });
    expect(board.onOpen).toHaveBeenCalledWith("/env-1/conversation-1");
  });

  it("asks on the row before it stops a task at work, and stops it only once confirmed", () => {
    const stop = {
      pressOf: vi.fn(() => ({ kind: "idle" as const })),
      onAsk: vi.fn(),
      onKeep: vi.fn(),
      onStop: vi.fn(),
    };
    const view = (press: "idle" | "asking") =>
      rendered(
        <ProjectAutomationView
          board={boardView({ stop: { ...stop, pressOf: () => ({ kind: press }) } })}
          onOpenMate={vi.fn()}
          pool={[NOVA]}
          sources={{ rows: [], reading: false, withheld: false }}
          workingOf={() => true}
        />,
      );
    const idle = view("idle");
    act(() => {
      buttons(idle, "Stop")[0]?.props.onClick();
    });
    expect(stop.onAsk).toHaveBeenCalledWith("t1");
    expect(stop.onStop).not.toHaveBeenCalled();
    const asking = view("asking");
    expect(words(asking)).toContain("Stop this task? Nova stops where it got to.");
    act(() => {
      buttons(asking, "Stop")[0]?.props.onClick();
    });
    expect(stop.onStop).toHaveBeenCalledWith("t1");
  });

  it("offers Stop on a queued task too, asked on its row", () => {
    const stop = {
      pressOf: () => ({ kind: "idle" as const }),
      onAsk: vi.fn(),
      onKeep: vi.fn(),
      onStop: vi.fn(),
    };
    const root = rendered(
      <ProjectAutomationView
        board={boardView({ stop })}
        onOpenMate={vi.fn()}
        pool={[NOVA]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => true}
      />,
    );
    const queued = root.find(
      (node) => node.type === "li" && node.props["data-zerops-task"] === "t2",
    );
    act(() => {
      buttons(queued, "Stop")[0]?.props.onClick();
    });
    expect(stop.onAsk).toHaveBeenCalledWith("t2");
  });

  it("offers no Stop of a task HQ already stops, and says it is stopping", () => {
    const stopping = TASKS.map((task) =>
      task.id === "t1" ? { ...task, state: "stopping" as const } : task,
    );
    const root = rendered(
      <ProjectAutomationView
        board={boardView({
          read: { state: "known", board: boardOf(stopping, NOW, "tea-shop") },
          stop: {
            pressOf: () => ({ kind: "idle" }),
            onAsk: vi.fn(),
            onKeep: vi.fn(),
            onStop: vi.fn(),
          },
        })}
        onOpenMate={vi.fn()}
        pool={[NOVA]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => true}
      />,
    );
    const row = root.find((node) => node.type === "li" && node.props["data-zerops-task"] === "t1");
    expect(words(row)).toContain("Stopping");
    expect(buttons(row, "Stop")).toHaveLength(0);
  });

  // witness: apps/web/src/components/zerops/projectAutomation/ProjectAutomation.tsx | board?.read.state === "known" ? board.read.board.blocked.map((line) => line.projectId) : [], → [],
  it("says a Mate HQ holds on its change waits for review, never that it is free, and opens the change from Review", () => {
    const done = [
      {
        ...TASK,
        state: "done" as const,
        endedAt: "2026-10-18T11:58:00.000Z",
        change: { repo: "web", number: 3 },
      },
    ];
    const live = new Map([["t1", { id: "t1", title: TASK.title, url: null, done: true as const }]]);
    const board = boardView({
      // Nova runs a Mate older than HQ's change per task: HQ holds it on its change.
      read: { state: "known", board: boardOf(done, NOW, "tea-shop", live, () => true) },
    });
    const root = rendered(
      <ProjectAutomationView
        board={board}
        onOpenMate={vi.fn()}
        pool={[{ ...NOVA, automation: { task: { title: TASK.title, done: true } } }, JUNO]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    expect(words(pool(root))).toContain("2 automated Mates · 1 waits for review");
    expect(words(taskRow(root, "t1"))).toContain("Up for review");
    act(() => {
      taskRow(root, "t1")
        .find((node) => node.type === "a" && words(node) === "Review")
        .props.onClick({ button: 0, preventDefault: vi.fn() });
    });
    expect(board.onOpen).toHaveBeenCalledWith("/change/tea-shop/web/3");
  });

  // Live: "Raya waits for change #12 to be merged or closed" while Raya took #12 holding #8's change.
  it("says a Mate whose changes wait for review, and whom HQ does not hold, waits for a task", () => {
    const done = [
      {
        ...TASK,
        state: "done" as const,
        endedAt: "2026-10-18T11:58:00.000Z",
        change: { repo: "web", number: 3 },
      },
      {
        ...TASK,
        id: "t2",
        state: "done" as const,
        endedAt: "2026-10-18T11:40:00.000Z",
        change: { repo: "web", number: 4 },
      },
    ];
    const live = new Map([["t1", { id: "t1", title: TASK.title, url: null }]]);
    const root = rendered(
      <ProjectAutomationView
        board={boardView({ read: { state: "known", board: boardOf(done, NOW, "tea-shop", live) } })}
        onOpenMate={vi.fn()}
        pool={[NOVA, JUNO]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    // Its changes wait in Finished; the pool never says it waits for one of them.
    expect(words(pool(root))).not.toContain("waits for review");
    expect(words(taskRow(root, "t1"))).toContain("Up for review");
    expect(words(taskRow(root, "t2"))).toContain("Up for review");
  });

  it("offers no Stop of a task to anyone but an Owner or Admin", () => {
    const root = rendered(
      <ProjectAutomationView
        board={boardView()}
        onOpenMate={vi.fn()}
        pool={[NOVA]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => true}
      />,
    );
    expect(buttons(root, "Stop")).toHaveLength(0);
  });

  it("holds a placeholder row for each task navigation knows of while the board reads", () => {
    const root = rendered(
      <ProjectAutomationView
        board={boardView({
          read: { state: "reading", predicted: { atWork: 2, queued: 3, recent: 1 } },
        })}
        onOpenMate={vi.fn()}
        pool={[NOVA, JUNO]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => true}
      />,
    );
    const placeholders = (name: string) =>
      root
        .find((node) => node.props["data-zerops-board"] === name)
        .findAll((node) => node.type === "li").length;
    expect([placeholders("At work"), placeholders("Queued"), placeholders("Finished")]).toEqual([
      2, 3, 1,
    ]);
  });

  // witness: apps/web/src/components/zerops/projectAutomation/ProjectAutomation.tsx | {queued.length === 0 ? null : ( → {queued.length < 0 ? null : (
  it("draws no group that holds no task: an idle board is its pool, what finished and its sources", () => {
    const root = rendered(
      <ProjectAutomationView
        admin={controls()}
        board={boardView({
          read: { state: "known", board: boardOf(TASKS.slice(2), NOW, "tea-shop") },
        })}
        onOpenMate={vi.fn()}
        pool={[JUNO]}
        sources={{ rows: ROWS, reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    expect(groups(root)).toEqual(["Finished", "Takes tasks from"]);
    expect(words(pool(root))).toContain("1 automated Mate · free");
  });

  // witness: apps/web/src/components/zerops/projectAutomation/ProjectAutomation.tsx | const finished = all ? recent : recent.slice(0, RECENT_SHOWN); → const finished = recent;
  it(`lists the latest ${String(RECENT_SHOWN)} that ended, and says how many more there are`, () => {
    const ended = Array.from({ length: RECENT_SHOWN + 3 }, (_, at) => ({
      ...TASK,
      id: `e${String(at)}`,
      state: "merged" as const,
      endedAt: "2026-10-18T10:00:00.000Z",
    }));
    const root = rendered(
      <ProjectAutomationView
        board={boardView({ read: { state: "known", board: boardOf(ended, NOW, "tea-shop") } })}
        onOpenMate={vi.fn()}
        pool={[NOVA]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    const finished = () =>
      root
        .find((node) => node.props["data-zerops-board"] === "Finished")
        .findAll((node) => node.type === "li").length;
    expect(finished()).toBe(RECENT_SHOWN);
    // The rest open in place.
    act(() => {
      buttons(root, "+ 3 more")[0]?.props.onClick({ currentTarget: null });
    });
    expect(finished()).toBe(RECENT_SHOWN + 3);
    expect(buttons(root, "Show fewer")).toHaveLength(1);
  });

  // witness: apps/web/src/components/zerops/projectAutomation/ProjectAutomation.tsx | why={row.detail} → why={null}
  it("says why a task failed, and who stopped one, under its title", () => {
    const ended = [
      {
        ...TASK,
        id: "f1",
        state: "failed" as const,
        endedAt: "2026-10-18T10:00:00.000Z",
        detail: "The catalogue file was not in the repository.",
      },
      {
        ...TASK,
        id: "s1",
        state: "stopped" as const,
        endedAt: "2026-10-18T09:00:00.000Z",
        detail: "Mara stopped it.",
      },
    ];
    const root = rendered(
      <ProjectAutomationView
        board={boardView({ read: { state: "known", board: boardOf(ended, NOW, "tea-shop") } })}
        onOpenMate={vi.fn()}
        pool={[NOVA]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    expect(words(taskRow(root, "f1"))).toContain(
      "Add a search box The catalogue file was not in the repository. Failed",
    );
    expect(words(taskRow(root, "s1"))).toContain("Add a search box Mara stopped it. Stopped");
  });
});
