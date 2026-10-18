/**
 * A project's Automation section, from what is read: its pool of automated Mates with what each
 * is on, and its sources of tasks, one row each — with Edit and Stop for an Owner or Admin, read
 * alone by anyone else.
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
import { boardOf } from "./taskBoard.logic";

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
  { key: "github", kind: "github", words: "GitHub issues labelled “mate” · acme/tea-shop" },
  { key: "slack", kind: "slack", words: "#support on Slack", disconnected: true },
  { key: "webhook", kind: "webhook", words: "2 webhooks" },
  {
    key: "schedule:s1",
    kind: "schedule",
    id: "s1",
    words: "Every Monday 09:00 · Update dependencies",
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

function controls(
  press: AutomationControls["pressOf"] = () => ({ kind: "idle" }),
): AutomationControls & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onAddMate: vi.fn(),
    onTakeFrom: vi.fn(),
    onEdit: vi.fn(),
    onAskStop: vi.fn(),
    onKeep: vi.fn(),
    pressOf: press as never,
    onStop: vi.fn(),
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
    expect(text).toContain("Nova and Juno take tasks from");
    expect(text).toContain("Nova Add a search box Worked 10m $0.42");
    expect(text).toContain("Juno waits for a task.");
    // Each face says what its Mate is on.
    expect(
      root
        .findAll((node) => node.props["data-zerops-surface"] === "project-automation-mate")
        .map((node) => node.props["aria-label"] as string),
    ).toContain("Nova: #1 Add a search box · PR #2 open");
    act(() => {
      buttons(root, "Add")[0]?.props.onClick();
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
    expect(words(root)).toContain("No automated Mates yet.");
    expect(words(root)).toContain("Tasks come from nowhere yet.");
  });

  it("names each source on its own row, with its own Edit and Stop", () => {
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
    for (const row of ROWS) expect(words(root)).toContain(row.words);
    const github = sourceRow(root, "github");
    act(() => {
      buttons(github, "Edit")[0]?.props.onClick();
      buttons(github, "Stop")[0]?.props.onClick();
    });
    expect(admin.onEdit).toHaveBeenCalledWith(ROWS[0]);
    // Stop asks before it stops.
    expect(admin.onAskStop).toHaveBeenCalledWith(ROWS[0]);
    expect(admin.onStop).not.toHaveBeenCalled();
    // A schedule is removed; webhooks are each deleted in their form, never all at once.
    expect(buttons(sourceRow(root, "schedule"), "Remove")).toHaveLength(1);
    expect(buttons(sourceRow(root, "webhook"), "Stop")).toHaveLength(0);
  });

  it("names its sources as chips after who takes their tasks: a chip opens its form, Edit shows each one's own controls", () => {
    const admin = controls();
    const rows = [ROWS[0]!, ROWS[3]!];
    const root = rendered(
      <ProjectAutomationView
        admin={admin}
        onOpenMate={vi.fn()}
        pool={[NOVA]}
        sources={{ rows, reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    const pool = root.find(
      (node) => node.props["data-zerops-surface"] === "project-automation-pool",
    );
    expect(words(pool)).toContain(`Nova takes tasks from ${ROWS[0]!.words} ${ROWS[3]!.words}`);
    expect(root.findAll((node) => node.props["data-zerops-source"] !== undefined)).toHaveLength(0);
    act(() => {
      buttons(pool, ROWS[0]!.words)[0]?.props.onClick();
    });
    expect(admin.onEdit).toHaveBeenCalledWith(ROWS[0]);
    act(() => {
      buttons(pool, "Edit")[0]?.props.onClick();
    });
    expect(buttons(sourceRow(root, "github"), "Stop")).toHaveLength(1);
    expect(words(root)).toContain("Take tasks from…");
  });

  it("asks on the row before it stops a source, and stops it only once confirmed", () => {
    const admin = controls((row) =>
      row.key === "schedule:s1" ? { kind: "asking" } : { kind: "idle" },
    );
    const root = rendered(
      <ProjectAutomationView
        admin={admin}
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: ROWS, reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    const schedule = sourceRow(root, "schedule");
    expect(words(schedule)).toContain("Remove this schedule and its brief?");
    act(() => {
      buttons(schedule, "Keep")[0]?.props.onClick();
    });
    expect(admin.onKeep).toHaveBeenCalledOnce();
    act(() => {
      buttons(schedule, "Remove")[0]?.props.onClick();
    });
    expect(admin.onStop).toHaveBeenCalledWith(ROWS[3]);
  });

  it("shows a stop under way on its row, and HQ's refusal there", () => {
    const root = rendered(
      <ProjectAutomationView
        admin={controls((row) =>
          row.key === "github"
            ? { kind: "working" }
            : row.key === "slack"
              ? { kind: "refused", words: "HQ refused it." }
              : { kind: "idle" },
        )}
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: ROWS, reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    const stopping = buttons(sourceRow(root, "github"), "Stopping…");
    expect(stopping).toHaveLength(1);
    expect(stopping[0]?.props.disabled).toBe(true);
    expect(words(sourceRow(root, "slack"))).toContain("HQ refused it.");
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
    expect(words(slack)).toContain("Slack isn't connected: no tasks come in.");
    act(() => {
      buttons(slack, "Connect")[0]?.props.onClick();
    });
    expect(admin.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("offers each kind of source from Take tasks from…", () => {
    const root = rendered(
      <ProjectAutomationView
        admin={controls()}
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: [], reading: false, withheld: false }}
        workingOf={() => false}
      />,
    );
    expect(words(root)).toContain("Take tasks from…");
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
    expect(text).toContain("Nova Add a search box Worked");
    for (const label of ["Add", "Add an automated Mate", "Edit", "Stop", "Remove", "Connect"])
      expect(buttons(root, label)).toHaveLength(0);
    expect(text).not.toContain("Take tasks from…");
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
    expect(words(root)).toContain("GitHub issues labelled “mate” · acme/tea-shop");
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
    expect(words(root)).toContain("Update HQ to set up automated Mates.");
    expect(words(root)).not.toContain("Take tasks from…");
    expect(words(root)).not.toContain("Add an automated Mate");
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
    expect(block("Queued")).toContain("GH acme/tea-shop#3 Show prices in euros Waited 4m");
    expect(block("Recent")).toContain("List six teas Nova · Ended 4h $0.31 PR #2");
    expect(words(root)).toContain("$6.44 of $50 this month");
    // A task's title opens its conversation inside Mate.
    act(() => {
      root
        .find((node) => node.type === "a" && words(node) === "Add a search box")
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
    expect(words(asking)).toContain("Stop this task? Its Mate stops where it got to.");
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

  it("says a Mate whose change waits for review waits for it to be merged or closed, the change linked", () => {
    const done = [
      {
        ...TASK,
        state: "done" as const,
        endedAt: "2026-10-18T11:58:00.000Z",
        change: { repo: "web", number: 3 },
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
    const atWork = words(root.find((node) => node.props["data-zerops-board"] === "At work"));
    expect(atWork).toContain("Nova waits for change #3 to be merged or closed.");
    expect(atWork).toContain("Juno waits for a task.");
    expect(atWork).not.toContain("Nova and Juno");
    const link = root.find((node) => node.type === "a" && words(node) === "change #3");
    expect(link.props.href).toBe("/change/tea-shop/web/3");
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
    expect([placeholders("At work"), placeholders("Queued"), placeholders("Recent")]).toEqual([
      2, 3, 1,
    ]);
  });
});
