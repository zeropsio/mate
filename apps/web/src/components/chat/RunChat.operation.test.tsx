import { EnvironmentId, TurnId } from "@t3tools/contracts";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { MessagesTimelineRow, RecordItem, RunStatus } from "./MessagesTimeline.logic";
import { RunChat } from "./RunChat";
import { SLOT_MIN_SHOW_MS } from "./liveSlot.logic";
import { at as fixtureAt, operation } from "./conversationFixtures";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./timelineContext";

// The account store, faked where the card's hooks read it: what it holds of
// the project's processes, whether a card asked it to read the project, which
// builds' logs were read and their lines. Everything above it — the card's
// hooks, the line, the slot, the plop — is the real path.
const store = vi.hoisted(() => ({
  processes: [] as ReadonlyArray<unknown>,
  /** Whether a card asks the store to read the project, as of the last draw. */
  reading: false,
  logLines: [] as ReadonlyArray<{ id: string; at: string; text: string; severity: number }>,
}));

vi.mock("../../zerops/activity/useProjectActivity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../zerops/activity/useProjectActivity")>();
  const read = (projectId: string | null) =>
    projectId === null
      ? actual.EMPTY_PROJECT_ACTIVITY_SNAPSHOT
      : { processes: store.processes, atMs: Date.now(), live: true };
  const demand = (projectId: string | null) => {
    if (projectId !== null) store.reading = true;
  };
  return {
    ...actual,
    useProjectActivityRead: read,
    useProjectActivityDemand: demand,
    useProjectActivity: (projectId: string | null) => {
      demand(projectId);
      return read(projectId);
    },
  };
});

vi.mock("../../zerops/activity/useBuildLog", () => ({
  useBuildLog: ({ query, live }: { query: unknown; live: boolean }) =>
    query === null
      ? { lines: [], status: "idle" }
      : { lines: live ? store.logLines : [], status: live ? "live" : "ended" },
}));

vi.mock("../../zerops/useZeropsFeeds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../zerops/useZeropsFeeds")>();
  return {
    ...actual,
    useZeropsBrowserStream: () => undefined,
    useZeropsTopology: () => ({
      project: { id: "proj-7", name: "orchard" },
      services: [
        { hostname: "appdev", serviceId: "svc-app", typeName: "Node.js", routes: [] },
        { hostname: "apidev", serviceId: "svc-api", typeName: "Go", routes: [] },
      ],
      warnings: [],
      usageRead: true,
    }),
  };
});

vi.mock("../../zerops/sessionContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../zerops/sessionContext")>();
  return { ...actual, useZeropsSessionOptional: () => ({ status: "signed-in" }) };
});

// The whole log's dialog, drawn in place: what is open is there to count.
vi.mock("~/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div data-dialog-open="">{children}</div> : null,
    DialogDescription: Pass,
    DialogHeader: Pass,
    DialogPanel: Pass,
    DialogPopup: Pass,
    DialogTitle: Pass,
  };
});

const LOG_LINES = ["> npm ci", "added 212 packages", "> npm run build"].map((text, index) => ({
  id: `line-${index}`,
  at: `2026-09-24T20:01:0${index}.000Z`,
  text,
  severity: 6,
}));

/** The deploy's process as the platform states it: building, or as it ended. */
function process(
  phase: "building" | "finished",
  overrides: { serviceId?: string; appVersionId?: string } = {},
): ActivityProcess {
  const appVersionId = overrides.appVersionId ?? "av-41";
  return {
    id: `proc-${appVersionId}`,
    projectId: "proj-7",
    serviceStackIds: [overrides.serviceId ?? "svc-app"],
    status: phase === "building" ? "RUNNING" : "FINISHED",
    actionName: "stack.build",
    created: fixtureAt(1),
    started: fixtureAt(1),
    ...(phase === "finished" ? { finished: fixtureAt(2) } : {}),
    appVersion: {
      id: appVersionId,
      status: phase === "building" ? "BUILDING" : "ACTIVE",
      build: {
        serviceStackId: "svc-builder",
        pipelineStart: fixtureAt(1),
        startDate: fixtureAt(1, 4),
        ...(phase === "finished"
          ? { endDate: fixtureAt(1, 40), pipelineFinish: fixtureAt(2) }
          : {}),
      },
      ...(phase === "finished" ? { activationDate: fixtureAt(2) } : {}),
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

const STEPS = ["Build", "Prepare", "Deploy"] as const;

/** A deploy of the dev service, as its call left it: running, or ended naming its version. */
function deploy(
  phase: "running" | "done",
  overrides: Partial<ZeropsOperation> = {},
): ZeropsOperation {
  const entry = operation("d1", "turn-1", 1, {
    kind: "deploy",
    phase,
    subject: "appdev",
    voice: "Deploying appdev.",
    statusWord: phase === "running" ? "Deploying" : "Deployed",
    steps: STEPS.map((label) => ({
      id: label,
      label,
      state: phase === "running" ? "queued" : "done",
      stateLabel: phase === "running" ? "Waiting" : "Done",
    })),
    ...(phase === "done" ? { version: { id: "av-41" } } : {}),
    ...overrides,
  });
  if (entry.kind !== "operation") throw new Error("an operation");
  if (phase === "done") return entry.operation;
  const { settledAt: _settled, ...taking } = entry.operation;
  return taking;
}

/** A batch deploy of two services, the first building, the second waiting its turn. */
function batch(): ZeropsOperation {
  return deploy("running", {
    batch: true,
    subject: "2 services",
    target: { hostname: "appdev" },
    steps: [
      { id: "appdev", label: "appdev", state: "running", stateLabel: "Building" },
      { id: "apidev", label: "apidev", state: "queued", stateLabel: "Waiting" },
    ],
  });
}

const inSlot = (op: ZeropsOperation) => record([], { now: { kind: "operation", operation: op } });
const inRecord = (op: ZeropsOperation, overrides: Partial<RecordRow> = {}) =>
  record([{ kind: "operation", key: `operation:${op.key}`, at: at(60), operation: op }], overrides);

describe("RunChat — an operation's card, read from the account store", () => {
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
    // The page's clock stands where the deploy runs: half a minute in.
    vi.useFakeTimers();
    vi.setSystemTime(fixtureAt(1, 30));
    store.processes = [process("building")];
    store.reading = false;
    store.logLines = LOG_LINES;
  });
  afterEach(() => {
    act(() => {
      for (const renderer of drawn.splice(0)) renderer.unmount();
    });
    globalThis.ResizeObserver = saved.resize;
    globalThis.requestAnimationFrame = saved.frame;
    vi.useRealTimers();
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
  const redraw = (renderer: ReactTestRenderer, row: RecordRow) => {
    store.reading = false;
    act(() =>
      renderer.update(
        <Rows>
          <RunChat row={row} />
        </Rows>,
      ),
    );
  };
  const nodes = (renderer: ReactTestRenderer, attribute: string) =>
    renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props[attribute] !== undefined,
    );
  /** How many of what the card draws: its pipeline's steps, its build's lines, the way to the whole log. */
  const count = (renderer: ReactTestRenderer) => ({
    steps: nodes(renderer, "data-zerops-pipeline-step").length,
    log: nodes(renderer, "data-zerops-build-log-line").length,
    whole: nodes(renderer, "data-zerops-build-log-toggle").length,
  });
  const operationRows = (renderer: ReactTestRenderer) =>
    renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        String(node.props["data-chat-kind"] ?? "").startsWith("operation:"),
    ).length;
  const opener = (renderer: ReactTestRenderer) =>
    renderer.root.findAll(
      (node) =>
        node.type === "button" && String(node.props["aria-label"] ?? "").includes("Show it"),
    );
  /** The plop: the call ended, and the slot's minimum show ran out. */
  const plop = (renderer: ReactTestRenderer, row: RecordRow) => {
    redraw(renderer, row);
    act(() => vi.advanceTimersByTime(SLOT_MIN_SHOW_MS + 100));
  };

  it("a running deploy stands open in the live slot on its pipeline and its build's newest lines", () => {
    const renderer = mount(inSlot(deploy("running")));
    expect(count(renderer)).toMatchObject({ log: 2, whole: 1 });
    expect(count(renderer).steps).toBeGreaterThan(0);
    expect(store.reading).toBe(true);
  });

  it("says only its line while the store holds nothing of it", () => {
    store.processes = [];
    const renderer = mount(inSlot(deploy("running")));
    expect(count(renderer)).toEqual({ steps: 0, log: 0, whole: 0 });
  });

  it("a running batch deploy stands as a line per service, the one building open on its pipeline and log", () => {
    const renderer = mount(inSlot(batch()));
    expect(operationRows(renderer)).toBe(2);
    expect(count(renderer)).toMatchObject({ log: 2, whole: 1 });
    expect(count(renderer).steps).toBeGreaterThan(0);
  });

  it.each([
    { kind: "subdomain" as const },
    { kind: "scale" as const },
    { kind: "manage" as const },
    { kind: "delete" as const },
  ])("a running $kind in the slot asks the store to read nothing", ({ kind }) => {
    mount(inSlot(deploy("running", { kind, steps: [] })));
    expect(store.reading).toBe(false);
  });

  it("keeps reading after its call settled until its outcome is read", () => {
    const renderer = mount(inSlot(deploy("running")));
    redraw(renderer, inSlot(deploy("done")));
    redraw(renderer, inSlot(deploy("done")));
    expect(store.reading).toBe(true);
    store.processes = [process("finished")];
    redraw(renderer, inSlot(deploy("done")));
    expect(store.reading).toBe(false);
  });

  it("lands in the history as it stood, the way to its log there from the first draw", () => {
    const renderer = mount(inSlot(deploy("running")));
    store.processes = [process("finished")];
    redraw(renderer, inSlot(deploy("done")));
    const settled = count(renderer);
    plop(renderer, inRecord(deploy("done")));
    expect(count(renderer)).toEqual(settled);
    expect(settled).toMatchObject({ log: 0, whole: 1 });
    expect(settled.steps).toBeGreaterThan(0);
  });

  it("keeps the build log's dialog open through the plop", () => {
    const renderer = mount(inSlot(deploy("running")));
    const toggle = nodes(renderer, "data-zerops-build-log-toggle")[0]!;
    act(() => toggle.props.onClick());
    expect(nodes(renderer, "data-dialog-open")).toHaveLength(1);
    store.processes = [process("finished")];
    plop(renderer, inRecord(deploy("done")));
    expect(nodes(renderer, "data-dialog-open")).toHaveLength(1);
  });

  it("a landed card is simply there; one the person opens rises", () => {
    const renderer = mount(inSlot(deploy("running")));
    store.processes = [process("finished")];
    plop(renderer, inRecord(deploy("done")));
    expect(nodes(renderer, "data-chat-detail")).toHaveLength(1);
    expect(nodes(renderer, "data-chat-detail-rises")).toHaveLength(0);

    const fresh = mount(inRecord(deploy("done", { key: "op:d2" }), { live: false, status: null }));
    act(() => opener(fresh)[0]!.props.onClick());
    expect(nodes(fresh, "data-chat-detail-rises")).toHaveLength(1);
  });

  it("opened after a reload, a settled deploy reads its details from the store by its id", () => {
    store.processes = [];
    const renderer = mount(
      inRecord(deploy("done", { key: "op:d9" }), { live: false, status: null }),
    );
    expect(count(renderer)).toEqual({ steps: 0, log: 0, whole: 0 });
    act(() => opener(renderer)[0]!.props.onClick());
    // Not held yet: the store is asked to read it.
    expect(store.reading).toBe(true);
    store.processes = [process("finished")];
    redraw(renderer, inRecord(deploy("done", { key: "op:d9" }), { live: false, status: null }));
    expect(count(renderer).steps).toBeGreaterThan(0);
    expect(count(renderer).whole).toBe(1);
    // Read: the store is asked no further.
    expect(store.reading).toBe(false);
  });

  it("one whose call returned while its build runs on lands closed and opens onto nothing", () => {
    const renderer = mount(inSlot(deploy("running")));
    const returned = deploy("running", { returnedAt: fixtureAt(1, 20) });
    plop(renderer, inRecord(returned));
    redraw(renderer, inRecord(returned));
    expect(count(renderer)).toEqual({ steps: 0, log: 0, whole: 0 });
    expect(opener(renderer)).toHaveLength(0);
    expect(store.reading).toBe(false);
  });
});
