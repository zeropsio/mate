import { assembleRecordCard } from "./MessagesTimeline.logic";
import { EnvironmentId, TurnId } from "@t3tools/contracts";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import type { MessagesTimelineRow, RecordItem, RunStatus } from "./MessagesTimeline.logic";
import { RunChat } from "./RunChat";
import { SLOT_HOLD_MS } from "./liveSlot.logic";
import { stepOf } from "./workSteps.logic";
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
  /** The builds whose log a card asks for, as of the last draw. */
  logReads: new Set<string>(),
  /** Where the project's newest process history read stands. */
  history: "read" as "unread" | "reading" | "read" | "failed",
  /** Why the store's read of the project failed, if it did. */
  failure: undefined as string | undefined,
  /** The dev service's subdomain, where the topology knows one. */
  subdomainUrl: undefined as string | undefined,
}));

vi.mock("../../zerops/activity/useProjectActivity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../zerops/activity/useProjectActivity")>();
  const read = (projectId: string | null) =>
    projectId === null
      ? actual.EMPTY_PROJECT_ACTIVITY_SNAPSHOT
      : {
          processes: store.processes,
          live: true,
          processHistory: store.history,
          ...(store.failure === undefined ? {} : { unavailableReason: store.failure }),
        };
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
  useBuildLog: ({ query, live }: { query: { appVersionId: string } | null; live: boolean }) => {
    if (query === null) return { lines: [], status: "idle" };
    store.logReads.add(query.appVersionId);
    return { lines: live ? store.logLines : [], status: live ? "live" : "ended" };
  },
}));

vi.mock("../../zerops/useZeropsFeeds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../zerops/useZeropsFeeds")>();
  return {
    ...actual,
    useZeropsBrowserStream: () => undefined,
    useZeropsTopology: () => ({
      project: { id: "proj-7", name: "orchard" },
      services: [
        {
          hostname: "appdev",
          serviceId: "svc-app",
          typeName: "Node.js",
          routes: [],
          ...(store.subdomainUrl === undefined ? {} : { subdomainUrl: store.subdomainUrl }),
        },
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

/**
 * The deploy's process as the platform states it: making its build container,
 * building, deploying what it built, or as it ended.
 */
function process(
  phase: "container" | "building" | "deploying" | "finished",
  overrides: { serviceId?: string; appVersionId?: string; minute?: number } = {},
): ActivityProcess {
  const appVersionId = overrides.appVersionId ?? "av-41";
  const minute = overrides.minute ?? 1;
  return {
    id: `proc-${appVersionId}`,
    projectId: "proj-7",
    serviceStackIds: [overrides.serviceId ?? "svc-app"],
    status: phase === "finished" ? "FINISHED" : "RUNNING",
    actionName: "stack.build",
    created: fixtureAt(minute),
    started: fixtureAt(minute),
    ...(phase === "finished" ? { finished: fixtureAt(minute + 1) } : {}),
    appVersion: {
      id: appVersionId,
      status: phase === "finished" ? "ACTIVE" : phase === "deploying" ? "DEPLOYING" : "BUILDING",
      build: {
        serviceStackId: "svc-builder",
        pipelineStart: fixtureAt(minute),
        ...(phase === "container" ? {} : { startDate: fixtureAt(minute, 4) }),
        ...(phase === "deploying" ? { endDate: fixtureAt(minute, 20) } : {}),
        ...(phase === "finished"
          ? { endDate: fixtureAt(minute, 40), pipelineFinish: fixtureAt(minute + 1) }
          : {}),
      },
      ...(phase === "finished" ? { activationDate: fixtureAt(minute + 1) } : {}),
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
  const row = {
    kind: "record" as const,
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
  return { ...row, ...assembleRecordCard(row) };
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

/**
 * A batch deploy of two services, as the builder draws it: while it runs
 * every service's step runs (its call says nothing until it returns); ended,
 * each done, and the versions its entries named.
 */
function batch(phase: "running" | "done"): ZeropsOperation {
  const { version: _single, ...entry } = deploy(phase, {
    batch: true,
    subject: "appdev, apidev",
    target: { hostname: "appdev" },
    statusWord: phase === "running" ? "Deploying" : "Deployed",
    steps: ["appdev", "apidev"].map((hostname) => ({
      id: hostname,
      label: hostname,
      state: phase === "running" ? "running" : "done",
      stateLabel: phase === "running" ? "Running" : "Deployed",
    })),
    ...(phase === "done" ? { appVersionIds: ["av-41", "av-42"] } : {}),
  });
  return entry;
}

/** The batch's processes: the dev service's build ended, the API's builds after it. */
const batchProcesses = (api: "building" | "finished") => [
  process("finished"),
  process(api, { serviceId: "svc-api", appVersionId: "av-42", minute: 2 }),
];

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
    store.logReads = new Set();
    store.logLines = LOG_LINES;
    store.history = "read";
    store.failure = undefined;
    store.subdomainUrl = undefined;
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
    act(() => vi.advanceTimersByTime(SLOT_HOLD_MS + 100));
  };

  // Its steps are its progress, every one from the first frame, and the way
  // to the build's log stands at the end of the build's line: no lines held
  // under it (the owner, 2026-10-05: "it should be steps, but they should be
  // visible … without a premade space for logs").
  it("a running deploy stands open in the live slot on its steps, the way to its log on the build's line", () => {
    const renderer = mount(inSlot(deploy("running")));
    expect(count(renderer)).toMatchObject({ log: 0, whole: 1 });
    expect(count(renderer).steps).toBeGreaterThan(0);
    expect(store.reading).toBe(true);
  });

  it("holds no room for the build's lines, before or after its first one", () => {
    store.logLines = [];
    const renderer = mount(inSlot(deploy("running")));
    const height = () => ({ ...count(renderer), steps: undefined });
    const before = height();
    store.logLines = LOG_LINES;
    redraw(renderer, inSlot(deploy("running")));
    expect(height()).toEqual(before);
    expect(nodes(renderer, "data-zerops-build-log-glance")).toHaveLength(0);
  });

  it("says only its line while the store holds nothing of it", () => {
    store.processes = [];
    const renderer = mount(inSlot(deploy("running")));
    expect(count(renderer)).toEqual({ steps: 0, log: 0, whole: 0 });
  });

  it("a running batch deploy is one line, its card on the service the store says is building", () => {
    store.processes = batchProcesses("building");
    vi.setSystemTime(fixtureAt(2, 30));
    const renderer = mount(inSlot(batch("running")));
    expect(operationRows(renderer)).toBe(1);
    // Its card is the API's, the one building: its pipeline and the way to its log.
    expect([...store.logReads]).toEqual(["av-42"]);
    expect(count(renderer)).toMatchObject({ log: 0, whole: 1 });
    expect(count(renderer).steps).toBeGreaterThan(0);
  });

  it("a batch lands in the history as it stood, its dialog open", () => {
    store.processes = batchProcesses("building");
    vi.setSystemTime(fixtureAt(2, 30));
    const renderer = mount(inSlot(batch("running")));
    act(() => nodes(renderer, "data-zerops-build-log-toggle")[0]!.props.onClick());
    store.processes = batchProcesses("finished");
    redraw(renderer, inSlot(batch("done")));
    const settled = { rows: operationRows(renderer), ...count(renderer) };
    store.logReads = new Set();
    plop(renderer, inRecord(batch("done")));
    expect({ rows: operationRows(renderer), ...count(renderer) }).toEqual(settled);
    expect(settled).toMatchObject({ rows: 1, whole: 1 });
    expect(settled.steps).toBeGreaterThan(0);
    expect(nodes(renderer, "data-dialog-open")).toHaveLength(1);
    // The API's log, the one its card stood on: no other.
    expect([...store.logReads]).toEqual(["av-42"]);
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

  const settledRow = (op: ZeropsOperation) => inRecord(op, { live: false, status: null });
  /** A row of the history, opened by the person. */
  const openSettled = (op: ZeropsOperation) => {
    const renderer = mount(settledRow(op));
    act(() => opener(renderer)[0]!.props.onClick());
    return renderer;
  };

  // Only an open the person made rises (pass 36): what a command printed
  // opens on the person's press alone (run 11), so it lands from the slot
  // closed, and their open rises.
  it("a bare command lands from the slot with its output closed, and the person's open rises", () => {
    const entry = (running: boolean): WorkLogEntry => ({
      id: "c1",
      createdAt: at(2),
      startedAt: at(2),
      updatedAt: at(9),
      label: "Command run",
      tone: "tool",
      itemType: "command_execution",
      command: "pnpm install\npnpm build",
      detail: "built in 4s",
      sourceActivityKind: running ? "tool.updated" : "tool.completed",
      toolLifecycleStatus: running ? "inProgress" : "completed",
    });
    const landed = (live: boolean): RecordItem => ({
      kind: "step",
      key: "step:c1",
      at: at(9),
      step: stepOf(entry(false), undefined, live),
    });
    const renderer = mount(record([], { now: { kind: "step", step: stepOf(entry(true)) } }));
    plop(renderer, record([landed(true)]));
    expect(nodes(renderer, "data-chat-detail")).toHaveLength(0);
    expect(nodes(renderer, "data-chat-detail-rises")).toHaveLength(0);

    const fresh = mount(record([landed(false)], { live: false, status: null }));
    const shows = fresh.root.findAll(
      (node) =>
        node.type === "button" &&
        String(node.props["aria-label"] ?? "").includes("Show what it returned"),
    );
    act(() => shows[0]!.props.onClick());
    expect(nodes(fresh, "data-chat-detail-rises").length).toBeGreaterThan(0);
  });

  it("opened after a reload, a settled deploy reads its details from the store by its id", () => {
    // Its own build, and a later deploy of the same service beside it.
    store.processes = [];
    store.history = "unread";
    const settled = deploy("done", { key: "op:d9" });
    const renderer = mount(settledRow(settled));
    expect(count(renderer)).toEqual({ steps: 0, log: 0, whole: 0 });
    act(() => opener(renderer)[0]!.props.onClick());
    // Not held yet: the store is asked to read it.
    expect(store.reading).toBe(true);
    store.processes = [
      process("finished"),
      process("building", { appVersionId: "av-50", minute: 5 }),
    ];
    store.history = "read";
    store.logReads = new Set();
    redraw(renderer, settledRow(settled));
    expect(count(renderer).steps).toBeGreaterThan(0);
    expect(count(renderer).whole).toBe(1);
    expect([...store.logReads]).toEqual(["av-41"]);
  });

  it("a failed deploy that named nothing never takes on a later deploy of its service", () => {
    // It failed at once; a later deploy of the same service is building.
    store.processes = [process("building", { appVersionId: "av-50", minute: 5 })];
    vi.setSystemTime(fixtureAt(6));
    const failed = deploy("done", {
      key: "op:d3",
      phase: "failed",
      statusWord: "Failed",
      explanation: { reason: "The build failed" },
      steps: [],
    });
    const { version: _named, ...unnamed } = failed;
    const renderer = openSettled(unnamed);
    expect(count(renderer)).toEqual({ steps: 0, log: 0, whole: 0 });
    expect(store.logReads.size).toBe(0);
    expect(store.reading).toBe(false);
  });

  it.each([
    { kind: "subdomain" as const },
    { kind: "scale" as const },
    { kind: "manage" as const },
    { kind: "delete" as const },
  ])("a settled $kind opened in the history asks the store to read nothing", ({ kind }) => {
    openSettled(deploy("done", { key: `op:${kind}`, kind, processIds: ["proc-av-41"] }));
    expect(store.reading).toBe(false);
  });

  it("a settled deploy found mid-run shows its build as the store holds it, past any ceiling", () => {
    // Its call returned while the platform still says it builds.
    const settled = deploy("done", { key: "op:d4" });
    const renderer = openSettled(settled);
    expect(store.reading).toBe(true);
    vi.setSystemTime(fixtureAt(1, 30 * 60 + 1));
    act(() => vi.advanceTimersByTime(1_000));
    redraw(renderer, settledRow(settled));
    expect(count(renderer).steps).toBeGreaterThan(0);
  });

  it.each([
    { name: "its history read", fail: () => (store.history = "failed") },
    { name: "the store's read of the project", fail: () => (store.failure = "refused") },
  ])("a settled deploy whose read failed ($name) says so", ({ fail }) => {
    store.processes = [];
    store.history = "reading";
    const settled = settledRow(deploy("done", { key: "op:d5" }));
    const renderer = mount(settled);
    act(() => opener(renderer)[0]!.props.onClick());
    expect(store.reading).toBe(true);
    fail();
    redraw(renderer, settled);
    expect(nodes(renderer, "data-zerops-operation-provenance")).toHaveLength(1);
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

  // A control that opens opens onto something, kind by kind (pass 43: an env
  // call wore a chevron that opened onto nothing).
  const said = (renderer: ReactTestRenderer) =>
    nodes(renderer, "data-chat-detail")
      .flatMap((node) => node.findAll(() => true))
      .flatMap((node) => node.children.filter((child) => typeof child === "string"))
      .join("")
      .trim();
  const kindOp = (overrides: Partial<ZeropsOperation> & Pick<ZeropsOperation, "kind">) => {
    const entry = operation("k1", "turn-0", 1, overrides);
    if (entry.kind !== "operation") throw new Error("an operation");
    return entry.operation;
  };
  const one = (state: "done" | "failed") => [
    { id: "apidev", label: "apidev", state, stateLabel: state === "done" ? "Done" : "Failed" },
  ];
  it.each([
    {
      name: "a failed env call",
      op: kindOp({
        kind: "env",
        phase: "failed",
        steps: one("failed"),
        explanation: { reason: "quota exceeded" },
      }),
    },
    {
      name: "a failed restart",
      op: kindOp({
        kind: "manage",
        phase: "failed",
        steps: one("failed"),
        explanation: { reason: "quota exceeded" },
      }),
    },
    { name: "a mount", op: kindOp({ kind: "mount", steps: one("done") }) },
    { name: "a check", op: kindOp({ kind: "verify", steps: one("done") }) },
    {
      name: "a subdomain",
      op: kindOp({
        kind: "subdomain",
        steps: one("done"),
        links: [{ label: "app.example", url: "https://app.example" }],
      }),
    },
    {
      name: "an error",
      op: kindOp({ kind: "error", phase: "failed", explanation: { reason: "No such tool" } }),
    },
    {
      name: "a look at the services",
      op: kindOp({
        kind: "discover",
        readResult: {
          kind: "discover",
          pending: false,
          rows: [{ hostname: "apidev", status: { tone: "ok", word: "Running" } }],
        },
      }),
    },
    {
      name: "a log read",
      op: kindOp({
        kind: "logs",
        readResult: {
          kind: "logs",
          pending: false,
          service: "apidev",
          lines: [{ id: "l1", severity: "info", text: "listening" }],
        },
      }),
    },
    {
      name: "the events read",
      op: kindOp({
        kind: "events",
        readResult: {
          kind: "events",
          pending: false,
          rows: [{ id: "e1", action: "Deploy", status: { tone: "ok", word: "Finished" } }],
        },
      }),
    },
    {
      name: "a process followed",
      op: kindOp({
        kind: "process",
        steps: one("done"),
        readResult: { kind: "process", pending: false },
      }),
    },
    // A deploy's steps are its pipeline's, as the store read them.
    { name: "a deploy", op: deploy("done", { key: "op:d9" }), processes: [process("finished")] },
  ] as ReadonlyArray<{
    name: string;
    op: ZeropsOperation;
    processes?: ReadonlyArray<ActivityProcess>;
  }>)("$name opens onto what it shows", ({ op, processes = [] }) => {
    store.processes = processes;
    const renderer = openSettled(op);
    expect(said(renderer)).not.toBe("");
  });

  it.each([
    ...(["env", "delete", "scale", "manage", "devServer"] as const).map((kind) => ({
      name: `a ${kind} call that went through`,
      op: kindOp({ kind, steps: one("done") }),
    })),
    {
      name: "a look that found no service",
      op: kindOp({
        kind: "discover",
        steps: one("done"),
        readResult: { kind: "discover", pending: false, rows: [] },
      }),
    },
  ])("$name has nothing to open", ({ op }) => {
    store.processes = [];
    const renderer = mount(settledRow(op));
    expect(opener(renderer)).toHaveLength(0);
  });

  // A settled call of one step wears no bar: its mark and its time say it (pass 43).
  it.each([
    { name: "a call of one step", op: kindOp({ kind: "env", steps: one("done") }), bars: 0 },
    {
      name: "a look at the services",
      op: kindOp({
        kind: "discover",
        readResult: { kind: "discover", pending: false, rows: [] },
      }),
      bars: 0,
    },
    {
      name: "a batch, a segment per service",
      op: kindOp({
        kind: "deploy",
        batch: true,
        steps: [...one("done"), { id: "web", label: "web", state: "done", stateLabel: "Done" }],
      }),
      bars: 1,
    },
  ])("$name: bars $bars", ({ op, bars }) => {
    store.processes = [];
    const renderer = mount(settledRow(op));
    expect(nodes(renderer, "data-status-bar")).toHaveLength(bars);
  });

  // A settled dev server opens onto the way to its service when the topology
  // knows its subdomain: the card draws an "Open" chip there (pass 43).
  it("a dev server opens onto its Open link when the topology knows its address", () => {
    store.processes = [];
    store.subdomainUrl = "https://appdev.example.test";
    const op = kindOp({ kind: "devServer", subject: "appdev", steps: one("done") });
    const renderer = openSettled(op);
    expect(said(renderer)).toContain("Open");
  });
});
