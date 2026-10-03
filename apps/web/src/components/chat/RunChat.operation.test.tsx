import { EnvironmentId, TurnId } from "@t3tools/contracts";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  PipelineReadout,
  PipelineSpokenState,
} from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { OperationCardRegions } from "../../zerops/activity/useOperationCard";
import { ZeropsBuildLog } from "../zerops/ZeropsBuildLog";
import type { MessagesTimelineRow, RecordItem, RunStatus } from "./MessagesTimeline.logic";
import { RunChat } from "./RunChat";
import { SLOT_MIN_SHOW_MS } from "./liveSlot.logic";
import { operation } from "./conversationFixtures";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./timelineContext";

// What the account store reads of a deploy, as the card's hook hands it on:
// its pipeline and its build's newest lines. The store itself is the hook's.
const STEPS = [
  ["INIT_BUILD_CONTAINER", "Build container"],
  ["RUN_BUILD_COMMANDS", "Build"],
  ["INIT_PREPARE_CONTAINER", "Prepare container"],
  ["RUN_PREPARE_COMMANDS", "Prepare runtime"],
  ["DEPLOY", "Deploy"],
] as const;

function pipeline(states: ReadonlyArray<PipelineSpokenState>): PipelineReadout {
  const steps = states.map((state, index) => ({
    id: STEPS[index]![0],
    label: STEPS[index]![1],
    state,
    sentence: `${STEPS[index]![1]}: ${state}`,
  }));
  const current = steps.find((step) => step.state === "running");
  return {
    status: { tone: "running", word: "Running" },
    calculating: false,
    ...(current === undefined ? {} : { currentStepId: current.id }),
    steps,
  };
}

const LOG_LINES = ["> npm ci", "added 212 packages", "> npm run build"].map((text, index) => ({
  id: `line-${index}`,
  at: `2026-09-27T10:01:0${index}.000Z`,
  text,
  severity: 6,
}));

const read = vi.hoisted(() => ({ regions: null as null | ((op: ZeropsOperation) => unknown) }));

vi.mock("../../zerops/activity/useOperationCard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../zerops/activity/useOperationCard")>();
  return {
    ...actual,
    useOperationCard: (op: ZeropsOperation) => read.regions?.(op) ?? {},
  };
});

/** The card's regions while the store has read the deploy: running, or as it ended. */
function regionsOf(op: ZeropsOperation): OperationCardRegions {
  const running = op.phase === "running";
  return {
    observed: {
      steps: [],
      chips: [],
      provenance: "",
      pipeline: pipeline(
        running
          ? ["finished", "running", "waiting", "waiting", "waiting"]
          : ["finished", "finished", "finished", "finished", "finished"],
      ),
      log: createElement(ZeropsBuildLog, {
        lines: LOG_LINES,
        onToggle: () => undefined,
        open: false,
        status: running ? "live" : "ended",
        subject: op.subject,
      }),
    },
  };
}

const at = (second: number) => new Date(Date.UTC(2026, 8, 27, 10, 0, second)).toISOString();

const SHARED: TimelineRowSharedState = {
  timestampFormat: "24-hour",
  routeThreadKey: "environment-local:thread-1",
  threadRef: null,
  markdownCwd: undefined,
  resolvedTheme: "light",
  workspaceRoot: undefined,
  skills: [],
  activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
  onRevertToTurnCount: () => undefined,
  onRunShellCommand: undefined,
  onImageExpand: () => undefined,
  onOpenTurnDiff: () => undefined,
  speaker: { name: "Nova", tint: "sky" },
  standUpAsk: null,
  livePauseId: null,
  usagePause: null,
  onUsageAutoResumeChange: null,
  agentPanelModel: emptyAgentPanelModel(),
  onOpenAgents: () => undefined,
  onStopBackgroundWork: () => undefined,
  onSteerQueuedMessage: () => undefined,
  steerQueuedMessageShortcutLabel: null,
  onRemoveQueuedMessage: () => undefined,
  arrivedAfter: null,
  syncing: false,
  onHoldReading: () => undefined,
};

const ACTIVITY: TimelineRowActivityState = {
  isWorking: true,
  isCompacting: false,
  isRevertingCheckpoint: false,
  latestTurnId: TurnId.make("turn-1"),
  workingStepLabel: null,
  stoppingBackgroundWork: false,
};

function Rows({ children }: { readonly children: ReactNode }) {
  return (
    <TimelineRowCtx value={SHARED}>
      <TimelineRowActivityCtx value={ACTIVITY}>{children}</TimelineRowActivityCtx>
    </TimelineRowCtx>
  );
}

type RecordRow = Extract<MessagesTimelineRow, { kind: "record" }>;

const status = (): RunStatus => ({
  live: true,
  face: "working",
  startedAt: at(0),
  endedAt: null,
  waitedMs: 0,
  waitingSince: null,
  worked: true,
});

function record(items: ReadonlyArray<RecordItem>, overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    kind: "record",
    id: "record:turn-1",
    createdAt: at(0),
    turnKey: "turn-1",
    live: true,
    items,
    now: null,
    answering: false,
    status: status(),
    outcome: null,
    ...overrides,
  };
}

/** A deploy of the dev service, as its call left it: running, or ended. */
function deploy(phase: "running" | "done"): ZeropsOperation {
  const entry = operation("d1", "turn-1", 1, {
    kind: "deploy",
    phase,
    subject: "appdev",
    voice: "Deploying appdev.",
    statusWord: phase === "running" ? "Deploying" : "Deployed",
    steps: STEPS.map(([id, label]) => ({
      id,
      label,
      state: phase === "running" ? "queued" : "done",
      stateLabel: phase === "running" ? "Waiting" : "Done",
    })),
  });
  if (entry.kind !== "operation") throw new Error("an operation");
  if (phase === "done") return entry.operation;
  const { settledAt: _settled, ...taking } = entry.operation;
  return taking;
}

const running = record([], { now: { kind: "operation", operation: deploy("running") } });
const ended = record([
  { kind: "operation", key: "operation:op:d1", at: at(60), operation: deploy("done") },
]);

describe("RunChat — a deploy's card while it runs and once it ended", () => {
  const saved = { resize: globalThis.ResizeObserver, frame: globalThis.requestAnimationFrame };
  const drawn: ReactTestRenderer[] = [];
  beforeEach(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof requestAnimationFrame;
    read.regions = regionsOf;
  });
  afterEach(() => {
    act(() => {
      for (const renderer of drawn.splice(0)) renderer.unmount();
    });
    globalThis.ResizeObserver = saved.resize;
    globalThis.requestAnimationFrame = saved.frame;
    read.regions = null;
  });

  const mount = (row: RecordRow) => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Rows>
          <RunChat row={row} />
        </Rows>,
      );
    });
    drawn.push(renderer);
    return renderer;
  };
  const redraw = (renderer: ReactTestRenderer, row: RecordRow) =>
    act(() =>
      renderer.update(
        <Rows>
          <RunChat row={row} />
        </Rows>,
      ),
    );
  /** How many of what the card draws: its pipeline's steps, its build's lines, the way to the whole log. */
  const count = (renderer: ReactTestRenderer) => {
    const all = (attribute: string) =>
      renderer.root.findAll((node) => typeof node.type === "string" && attribute in node.props)
        .length;
    return {
      steps: all("data-zerops-pipeline-step"),
      log: all("data-zerops-build-log-line"),
      whole: all("data-zerops-build-log-toggle"),
    };
  };

  it("stands open in the live slot on its pipeline and its build's newest lines", () => {
    const renderer = mount(running);
    expect(count(renderer)).toEqual({ steps: 5, log: 2, whole: 1 });
    // The line says the step it is on, as the pipeline reads it.
    expect(JSON.stringify(renderer.toJSON())).toContain('"Build"');
  });

  it("says only its line while the store has read nothing of it", () => {
    read.regions = () => ({});
    const renderer = mount(running);
    expect(count(renderer)).toEqual({ steps: 0, log: 0, whole: 0 });
  });

  it("lands in the history as it stood once it ended, its pipeline and log still there", () => {
    vi.useFakeTimers();
    try {
      const renderer = mount(running);
      redraw(renderer, ended);
      act(() => vi.advanceTimersByTime(SLOT_MIN_SHOW_MS + 100));
      expect(count(renderer)).toEqual({ steps: 5, log: 0, whole: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens from the history onto its pipeline and the way to its log", () => {
    const renderer = mount(record(ended.items, { live: false, status: null }));
    expect(count(renderer)).toEqual({ steps: 0, log: 0, whole: 0 });
    const opener = renderer.root.find(
      (node) =>
        node.type === "button" && String(node.props["aria-label"] ?? "").includes("Show it"),
    );
    act(() => opener.props.onClick());
    expect(count(renderer)).toEqual({ steps: 5, log: 0, whole: 1 });
  });
});
