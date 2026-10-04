import {
  classifyTaskAgentKind,
  EnvironmentId,
  ThreadId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { AgentsPanel } from "./AgentsPanel";
import { showHelper } from "./chat/helperFocus";

vi.mock("~/zerops/useZeropsMates", () => ({ useKnownMate: () => undefined }));
// The card a row opens onto has tests of its own: here, only which row opens.
vi.mock("~/components/chat/HelperCard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/components/chat/HelperCard")>()),
  HelperCard: () => null,
}));

const ENVIRONMENT = EnvironmentId.make("environment-panel");
const THREAD = ThreadId.make("thread-panel");
const KEY = scopedThreadKey({ environmentId: ENVIRONMENT, threadId: THREAD });
const at = (second: number) => new Date(Date.UTC(2026, 9, 4, 7, 0, second)).toISOString();

let sequence = 0;
function row(kind: string, second: number, payload: Record<string, unknown>) {
  sequence += 1;
  return {
    id: `row-${sequence}`,
    kind,
    tone: "info",
    summary: kind,
    turnId: null,
    createdAt: at(second),
    payload: kind.startsWith("task.")
      ? {
          ...payload,
          agentKind: classifyTaskAgentKind({
            taskType: payload.taskType as string | undefined,
            agentId: payload.agentId as string | undefined,
          }),
        }
      : payload,
  } as unknown as OrchestrationThreadActivity;
}

const done = (id: string, from: number, to: number) => [
  row("task.started", from, { taskId: id, taskType: "local_agent", title: `Helper ${id}` }),
  row("task.completed", to, { taskId: id, status: "completed", summary: `Report of ${id}` }),
];

/** Two helpers done before a third started: they fold as "2 earlier, done". */
const EARLIER = [
  ...done("early-1", 1, 2),
  ...done("early-2", 3, 4),
  row("task.started", 10, { taskId: "now-1", taskType: "local_agent", title: "Helper now-1" }),
];

/** A settled workflow: its section stands collapsed. */
const WORKFLOW = [
  row("task.started", 1, {
    taskId: "wf",
    taskType: "local_workflow",
    title: "Review",
    phases: [{ index: 0, title: "Read" }],
  }),
  row("task.progress", 2, {
    taskId: "wf:wf:0",
    parentAgentId: "wf",
    agentIndex: 0,
    phaseIndex: 0,
    title: "Reader",
    status: "running",
  }),
  row("task.completed", 5, { taskId: "wf", status: "completed", summary: "Reviewed" }),
];

// The panel brings an asked-for row into view on the next frame.
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;

const drawn: ReactTestRenderer[] = [];
function panel(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  const model = deriveAgentPanelModel({ agents: foldSubagentActivities(activities) });
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <AgentsPanel
        activities={activities}
        environmentId={ENVIRONMENT}
        model={model}
        threadId={THREAD}
      />,
    );
  });
  drawn.push(renderer);
  return renderer;
}
afterEach(() => {
  act(() => {
    for (const renderer of drawn.splice(0)) renderer.unmount();
  });
});

/** The helper rows drawn, and whether each is open. */
function rows(renderer: ReactTestRenderer) {
  return renderer.root
    .findAll((node) => node.type === "li" && node.props["data-helper-row"] !== undefined)
    .map((node) => [node.props["data-helper-row"], node.props["data-open"] !== undefined]);
}

describe("AgentsPanel, asked for a helper", () => {
  it.each([
    { name: "folded among the earlier ones", activities: EARLIER, id: "early-1" },
    { name: "in a collapsed workflow", activities: WORKFLOW, id: "wf:wf:0" },
  ])("opens a helper $name", ({ activities, id }) => {
    showHelper(KEY, id);
    const renderer = panel(activities);
    expect(rows(renderer)).toContainEqual([id, true]);
  });

  it("opens on what was asked once, never again on the next opening", () => {
    showHelper(KEY, "early-2");
    const first = panel(EARLIER);
    expect(rows(first)).toContainEqual(["early-2", true]);
    act(() => first.unmount());
    drawn.splice(drawn.indexOf(first), 1);
    const again = panel(EARLIER);
    expect(rows(again).filter(([, open]) => open)).toEqual([]);
  });
});
