/**
 * A project's Automation section, from what is read: its pool of automated Mates with what each
 * is on, and its sources of tasks, one row each — with Edit and Stop for an Owner or Admin, read
 * alone by anyone else.
 */
import { act, type ReactElement } from "react";
import { create, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { ProjectAutomationView, type AutomationControls, type PoolMate } from "./ProjectAutomation";
import type { SourceRow } from "./projectAutomation.logic";

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

function controls(): AutomationControls & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onAddMate: vi.fn(),
    onTakeFrom: vi.fn(),
    onEdit: vi.fn(),
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
        onOpenMate={vi.fn()}
        pool={[NOVA, JUNO]}
        sources={{ rows: [], reading: false }}
        workingOf={(projectId) => projectId === "p-nova"}
      />,
    );
    const text = words(root);
    expect(text).toContain("Nova #1 Add a search box · PR #2 open");
    expect(text).toContain("Juno Waiting for a task");
    act(() => {
      buttons(root, "Add an automated Mate")[0]?.props.onClick();
    });
    expect(admin.onAddMate).toHaveBeenCalledOnce();
  });

  it("opens an automated Mate from its row", () => {
    const onOpenMate = vi.fn();
    const root = rendered(
      <ProjectAutomationView
        onOpenMate={onOpenMate}
        pool={[NOVA]}
        sources={{ rows: [], reading: false }}
        workingOf={() => false}
      />,
    );
    act(() => {
      root
        .find((node) => node.props["data-zerops-surface"] === "project-automation-mate")
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
        sources={{ rows: [], reading: false }}
        workingOf={() => false}
      />,
    );
    expect(words(root)).toContain("No automated Mates yet.");
    expect(words(root)).toContain("Nowhere yet.");
  });

  it("names each source on its own row, with its own Edit and Stop", () => {
    const admin = controls();
    const root = rendered(
      <ProjectAutomationView
        admin={admin}
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: ROWS, reading: false }}
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
    expect(admin.onStop).toHaveBeenCalledWith(ROWS[0]);
    // A schedule is removed; webhooks are each deleted in their form, never all at once.
    expect(buttons(sourceRow(root, "schedule"), "Remove")).toHaveLength(1);
    expect(buttons(sourceRow(root, "webhook"), "Stop")).toHaveLength(0);
  });

  it("says a channel takes no tasks while its app isn't connected, with the way to connect it", () => {
    const admin = controls();
    const root = rendered(
      <ProjectAutomationView
        admin={admin}
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: ROWS, reading: false }}
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
        sources={{ rows: [], reading: false }}
        workingOf={() => false}
      />,
    );
    expect(words(root)).toContain("Take tasks from…");
  });

  it("is read alone by anyone but an Owner or Admin: no Add, Edit, Stop or Take tasks from…", () => {
    const root = rendered(
      <ProjectAutomationView
        onOpenMate={vi.fn()}
        pool={[NOVA]}
        sources={{ rows: ROWS, reading: false }}
        workingOf={() => false}
      />,
    );
    const text = words(root);
    expect(text).toContain("#1 Add a search box · PR #2 waiting for review");
    for (const label of ["Add an automated Mate", "Edit", "Stop", "Remove", "Connect"])
      expect(buttons(root, label)).toHaveLength(0);
    expect(text).not.toContain("Take tasks from…");
  });

  it("says it reads its sources until they are read", () => {
    const root = rendered(
      <ProjectAutomationView
        onOpenMate={vi.fn()}
        pool={[]}
        sources={{ rows: [], reading: true }}
        workingOf={() => false}
      />,
    );
    expect(words(root)).toContain("Reading…");
  });
});
