import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type {
  PipelineReadout,
  PipelineSpokenState,
} from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import {
  deriveZeropsThreadModel,
  reduceZeropsOperations,
} from "@t3tools/client-runtime/zerops/model";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import {
  importLines,
  lineSegments,
  detailLines,
  liveOperationBar,
  observedLinesOf,
  operationLineWord,
  operationSubject,
  processReasons,
  settledOperationBar,
  settledOperationWords,
  showsCardInSlot,
  slotOpenDeployLine,
} from "./operationBar.logic";

type Step = ZeropsOperation["steps"][number];

function step(label: string, state: Step["state"], note?: string): Step {
  return { id: label, label, state, stateLabel: state, ...(note === undefined ? {} : { note }) };
}

function operation(overrides: Partial<ZeropsOperation>): ZeropsOperation {
  return {
    key: "op:i",
    kind: "import",
    phase: "done",
    anchorAt: "2026-09-02T10:00:00.000Z",
    anchorActivityId: "i",
    turnId: "t1",
    subject: "apidev, apistage",
    kicker: "Import · apidev, apistage",
    voice: "Importing.",
    voiceSource: "mate",
    statusWord: "Imported",
    steps: [],
    links: [],
    callIds: ["i"],
    hasResult: true,
    ...overrides,
  };
}

describe("the docked bar of an operation", () => {
  it.each([
    {
      name: "live: every service creating, its own word on the bar",
      op: operation({
        phase: "running",
        statusWord: "Importing",
        steps: [step("apidev", "running"), step("apistage", "running")],
      }),
      subject: "Import · 2 services",
      words: null,
      tones: ["running", "running"],
      lines: ["apidev Creating", "apistage Creating"],
    },
    {
      name: "one failed: how many, the reason on its line",
      op: operation({
        phase: "failed",
        statusWord: "Import failed",
        steps: [step("apidev", "failed", "Out of disk\nat node 3"), step("apistage", "done")],
      }),
      subject: "Import · 2 services",
      words: "1 of 2 failed",
      tones: ["failed", "done"],
      lines: ["apidev Out of disk", "apistage Created"],
    },
    {
      name: "one failed with no reason in the tool's result: the call's error, when it failed alone",
      op: operation({
        phase: "failed",
        statusWord: "Import failed",
        steps: [step("apidev", "failed"), step("apistage", "done")],
        explanation: { reason: "Service apidev: build container crashed" },
      }),
      subject: "Import · 2 services",
      words: "1 of 2 failed",
      tones: ["failed", "done"],
      lines: ["apidev Service apidev: build container crashed", "apistage Created"],
    },
    {
      name: "all done: its own word",
      op: operation({ steps: [step("apidev", "done"), step("apistage", "done")] }),
      subject: "Import · 2 services",
      words: "Imported",
      tones: ["done", "done"],
      lines: ["apidev Created", "apistage Created"],
    },
    {
      name: "all failed: failed, said once; nothing known of why says only that",
      op: operation({
        phase: "failed",
        statusWord: "Import failed",
        steps: [step("apidev", "failed"), step("apistage", "failed")],
        explanation: { reason: "one error for both" },
      }),
      subject: "Import · 2 services",
      words: "Failed",
      tones: ["failed", "failed"],
      lines: ["apidev Failed", "apistage Failed"],
    },
    {
      name: "one service: named",
      op: operation({ subject: "apidev", steps: [step("apidev", "done")] }),
      subject: "Import · apidev",
      words: "Imported",
      tones: ["done"],
      lines: ["apidev Created"],
    },
  ])("$name", ({ op, subject, words, tones, lines }) => {
    const read = importLines(op);
    expect(operationSubject(op)).toBe(subject);
    expect(settledOperationWords(op, read)).toBe(words);
    expect(lineSegments(read).map((segment) => segment.tone)).toEqual(tones);
    expect(read.map((line) => `${line.host} ${operationLineWord(line).word}`)).toEqual(lines);
  });

  it("takes the platform's reason for a failed service the tool gave none", () => {
    const op = operation({
      phase: "failed",
      steps: [step("apidev", "failed"), step("apistage", "done")],
    });
    const lines = importLines(op, new Map([["apidev", "serviceStackCreateFailed: disk"]]));
    expect(operationLineWord(lines[0]!).word).toBe("serviceStackCreateFailed: disk");
  });

  it.each([
    { kind: "standup", subject: "development", shows: "Development" },
    { kind: "standup", subject: "stage", shows: "Stage" },
    { kind: "deploy", subject: "appdev", shows: "Deploy · appdev" },
  ] as const)("names a $kind as $shows", ({ kind, subject, shows }) => {
    expect(
      operationSubject(
        operation({
          kind,
          subject,
          ...(kind === "deploy" ? { target: { hostname: subject } } : {}),
        }),
      ),
    ).toBe(shows);
  });
});

describe("processReasons — why the platform says each service failed", () => {
  const process = (
    id: string,
    serviceId: string,
    created: string,
    failReason?: string,
  ): ActivityProcess => ({
    id,
    projectId: "proj",
    serviceStackIds: [serviceId],
    status: failReason === undefined ? "FINISHED" : "FAILED",
    actionName: "stack.create",
    created,
    ...(failReason === undefined ? {} : { failReason }),
  });

  it.each([
    {
      name: "the latest failed process of each service",
      processIds: undefined,
      shows: [["apidev", "second"]],
    },
    {
      name: "only the operation's own processes",
      processIds: ["p1"],
      shows: [["apidev", "first"]],
    },
  ])("$name", ({ processIds, shows }) => {
    const reasons = processReasons(
      [
        process("p1", "s-apidev", "2026-09-02T10:00:00.000Z", "first"),
        process("p2", "s-apidev", "2026-09-02T10:05:00.000Z", "second"),
        process("p3", "s-apistage", "2026-09-02T10:05:00.000Z"),
      ],
      new Map([
        ["apidev", "s-apidev"],
        ["apistage", "s-apistage"],
      ]),
      processIds,
    );
    expect([...reasons]).toEqual(shows);
  });
});

// A bar says what its line, its mark and its time do not: where a call
// failed among its steps, how its services went. A bar of one segment, or one
// whose only news is "done", says nothing and is not drawn (pass 43).
describe("settledOperationBar — a settled operation's bar carries what it found", () => {
  const two = [step("appdev", "done"), step("apidev", "done")];
  it.each([
    {
      name: "a call of one step: none",
      op: { kind: "env", phase: "done", steps: [step("env", "done")] },
      undone: false,
      tones: [],
    },
    {
      name: "a call with no steps: none",
      op: { kind: "discover", phase: "done", steps: [] },
      undone: false,
      tones: [],
    },
    {
      name: "a one-step finding, its mark and words say it: none",
      op: { kind: "devServer", phase: "done", steps: [step("dev-server", "failed")] },
      undone: false,
      tones: [],
    },
    {
      name: "a one-step failure, its mark and reason say it: none",
      op: { kind: "manage", phase: "failed", steps: [step("restart", "failed")] },
      undone: false,
      tones: [],
    },
    {
      name: "a call that failed: cut red where it failed",
      op: {
        kind: "deploy",
        phase: "failed",
        steps: [step("build", "done"), step("deploy", "failed"), step("ready", "queued")],
      },
      undone: false,
      tones: ["done", "failed", "waiting"],
    },
    {
      name: "that failure undone by a later call: quiet",
      op: {
        kind: "deploy",
        phase: "failed",
        steps: [step("build", "done"), step("deploy", "failed")],
      },
      undone: true,
      tones: ["done", "waiting"],
    },
    {
      name: "every check passed, only done: none",
      op: { kind: "verify", phase: "done", steps: two },
      undone: false,
      tones: [],
    },
    {
      name: "a check that found something wrong: amber where",
      op: { kind: "verify", phase: "done", steps: [step("a", "done"), step("b", "failed")] },
      undone: false,
      tones: ["done", "attention"],
    },
    {
      name: "a batch deploy: a segment per service",
      op: { kind: "deploy", phase: "done", batch: true, steps: two },
      undone: false,
      tones: ["done", "done"],
    },
    {
      name: "a batch of one service: none",
      op: { kind: "deploy", phase: "done", batch: true, steps: [step("appdev", "done")] },
      undone: false,
      tones: [],
    },
    {
      name: "an import: a segment per service",
      op: { kind: "import", phase: "done", steps: two },
      undone: false,
      tones: ["done", "done"],
    },
    {
      name: "a check of all services: a segment per service",
      op: { kind: "verify", phase: "done", subject: "all services", steps: two },
      undone: false,
      tones: ["done", "done"],
    },
  ] as const)("$name", ({ op, undone, tones }) => {
    expect(
      settledOperationBar(operation(op as Partial<ZeropsOperation>), undone).map(
        (segment) => segment.tone,
      ),
    ).toEqual(tones);
  });
});

// Nothing moves while an item stands in the live slot (pass 43): a call that
// wore a bar while it ran keeps a bar as it settles there, so its reason or
// detail never jumps left by the bar's width. The rule that drops a bar
// saying nothing applies once it stands in the log.
describe("settledOperationBar — the slot's line keeps its parts from live to settled", () => {
  const settled = (overrides: Partial<ZeropsOperation>) =>
    operation({ phase: "done", ...overrides });
  it.each([
    { name: "a call of one step", op: { kind: "env", steps: [step("env", "done")] } },
    { name: "a call with no steps", op: { kind: "discover", steps: [] } },
    {
      name: "a failed call of one step",
      op: { kind: "manage", phase: "failed", steps: [step("x", "failed")] },
    },
    {
      name: "checks that all passed",
      op: { kind: "verify", steps: [step("a", "done"), step("b", "done")] },
    },
  ] as const)("$name", ({ op }) => {
    const running = operation({ ...(op as Partial<ZeropsOperation>), phase: "running" });
    const ended = settled(op as Partial<ZeropsOperation>);
    expect(liveOperationBar(running).segments.length).toBeGreaterThan(0);
    expect(settledOperationBar(ended, false, "slot").length).toBeGreaterThan(0);
    expect(settledOperationBar(ended, false, "log")).toEqual([]);
  });
});

describe("detailLines — how much an operation opens to", () => {
  it.each([
    {
      name: "a deploy with no steps, no log and no version yet",
      overrides: { kind: "deploy" as const },
      lines: 0,
    },
    {
      name: "a deploy with its pipeline's steps",
      overrides: {
        kind: "deploy" as const,
        steps: [step("Build", "done"), step("Deploy", "running")],
      },
      lines: 2,
    },
    {
      name: "a deploy whose version names the pipeline and log it reads",
      overrides: { kind: "deploy" as const, version: { id: "v-1", name: "v0.1.2" } },
      lines: 1,
    },
    {
      name: "a failure with its reason",
      overrides: {
        kind: "deploy" as const,
        phase: "failed" as const,
        explanation: { reason: "Build failed" },
      },
      lines: 1,
    },
    { name: "an import: its services", overrides: { steps: [step("db", "done")] }, lines: 1 },
  ])("$name", ({ overrides, lines }) => {
    expect(detailLines(operation(overrides as Partial<ZeropsOperation>), null)).toBe(lines);
  });
});

// The count of what an operation opens to agrees with what its card draws,
// kind by kind: a chevron that opens onto nothing is a defect (pass 43).
describe("detailLines — the links a card adds of its own", () => {
  it.each([
    { name: "a dev server whose address is known: its Open link", url: "https://a.test", lines: 1 },
    { name: "a dev server whose address is not known: nothing", url: undefined, lines: 0 },
  ])("$name", ({ url, lines }) => {
    const op = operation({ kind: "devServer", steps: [step("appdev", "done")] });
    expect(detailLines(op, null, null, url)).toBe(lines);
  });

  it("an address counts only for a dev server", () => {
    const op = operation({ kind: "env", steps: [step("appdev", "done")] });
    expect(detailLines(op, null, null, "https://a.test")).toBe(0);
  });
});

describe("detailLines — what its card draws, kind by kind", () => {
  const done = step("apidev", "done");
  const failed = step("apidev", "failed");
  const link = { label: "app.example", url: "https://app.example" };
  const discover = (rows: number) => ({
    kind: "discover" as const,
    pending: false,
    rows: Array.from({ length: rows }, (_, index) => ({
      hostname: `svc${index}`,
      status: { tone: "ok" as const, word: "Running" },
    })),
  });
  it.each([
    // A result-line kind's one step repeats its line: drawn only when it failed.
    ...(["env", "delete", "scale", "manage", "devServer"] as const).flatMap((kind) => [
      { name: `${kind}, done: nothing`, overrides: { kind, steps: [done] }, lines: 0 },
      {
        name: `${kind}, failed: its step and why`,
        overrides: {
          kind,
          phase: "failed" as const,
          steps: [failed],
          explanation: { reason: "quota exceeded" },
        },
        lines: 2,
      },
    ]),
    {
      name: "a mount: its services",
      overrides: { kind: "mount" as const, steps: [done] },
      lines: 1,
    },
    {
      name: "a subdomain: its step and its address",
      overrides: { kind: "subdomain" as const, steps: [done], links: [link] },
      lines: 2,
    },
    {
      name: "a check: its checks",
      overrides: { kind: "verify" as const, steps: [done, done] },
      lines: 2,
    },
    {
      name: "an error: why",
      overrides: {
        kind: "error" as const,
        phase: "failed" as const,
        explanation: { reason: "No such tool" },
      },
      lines: 1,
    },
    // A read draws what it returned in place of its steps and its reason.
    {
      name: "a look at the services: a row each",
      overrides: { kind: "discover" as const, readResult: discover(2) },
      lines: 2,
    },
    {
      name: "a look that returned no service: nothing",
      overrides: { kind: "discover" as const, steps: [done], readResult: discover(0) },
      lines: 0,
    },
    {
      name: "a log: its lines and its note",
      overrides: {
        kind: "logs" as const,
        steps: [done],
        readResult: {
          kind: "logs" as const,
          pending: false,
          service: "apidev",
          lines: [{ id: "l1", text: "listening", severity: "info" as const }],
          note: "1 line",
        },
      },
      lines: 2,
    },
    {
      name: "the events: a row each and the rest",
      overrides: {
        kind: "events" as const,
        readResult: {
          kind: "events" as const,
          pending: false,
          rows: [{ id: "e1", action: "Deploy", status: { tone: "ok" as const, word: "Finished" } }],
          more: "3 more",
        },
      },
      lines: 2,
    },
    {
      name: "a process followed: its processes",
      overrides: {
        kind: "process" as const,
        steps: [done],
        readResult: { kind: "process" as const, pending: false },
      },
      lines: 1,
    },
  ])("$name", ({ overrides, lines }) => {
    expect(detailLines(operation(overrides as Partial<ZeropsOperation>), null)).toBe(lines);
  });
});

/** A deploy's pipeline as the card reads it off the platform: a step per id, in its state. */
function pipeline(
  states: ReadonlyArray<PipelineSpokenState>,
  calculating = false,
): PipelineReadout {
  const ids = [
    ["INIT_BUILD_CONTAINER", "Build container"],
    ["RUN_BUILD_COMMANDS", "Build"],
    ["INIT_PREPARE_CONTAINER", "Prepare container"],
    ["RUN_PREPARE_COMMANDS", "Prepare runtime"],
    ["DEPLOY", "Deploy"],
  ] as const;
  const steps = states.map((state, index) => ({
    id: ids[index]![0],
    label: ids[index]![1],
    state,
    sentence: `${ids[index]![1]} ${state}`,
  }));
  const current = steps.find((one) => one.state === "running" || one.state === "failed");
  return {
    status: { tone: "running", word: "Running" },
    calculating,
    ...(current === undefined ? {} : { currentStepId: current.id }),
    steps: calculating ? [] : steps,
  };
}

const LOG = { log: "the build log" };

// The card of an operation the platform runs reads it off the account
// store: its pipeline's steps and its build log are there before the call
// returns, so they are what it opens to (pass 36: "the running builds,
// their logs ... seem to be completely gone").
describe("detailLines — what the card read of the platform counts", () => {
  const deploy = (overrides: Partial<ZeropsOperation> = {}) =>
    operation({ kind: "deploy", phase: "running", subject: "appdev", ...overrides });
  it.each([
    {
      name: "a running deploy whose pipeline is read: its steps",
      op: deploy(),
      observed: { steps: [], chips: [], pipeline: pipeline(["finished", "running", "waiting"]) },
      lines: 3,
    },
    {
      name: "and its build log",
      op: deploy(),
      observed: {
        steps: [],
        chips: [],
        pipeline: pipeline(["finished", "running", "waiting"]),
        ...LOG,
      },
      lines: 4,
    },
    {
      name: "a pipeline still calculating its steps: the steps the call reserved",
      op: deploy({ steps: [step("Build", "queued"), step("Deploy", "queued")] }),
      observed: { steps: [], chips: [], pipeline: pipeline([], true) },
      lines: 2,
    },
    {
      name: "a subdomain's observed steps and the processes beside it",
      op: deploy({ kind: "subdomain" }),
      observed: { steps: [step("Enable", "running")], chips: [step("Restart", "done")] },
      lines: 2,
    },
    {
      name: "nothing read yet: what the call says",
      op: deploy({ steps: [step("Build", "queued")] }),
      observed: undefined,
      lines: 1,
    },
  ])("$name", ({ op, observed, lines }) => {
    expect(detailLines(op, null, observedLinesOf(observed))).toBe(lines);
  });
});

describe("liveOperationBar — a running deploy's bar reads its pipeline", () => {
  const running = operation({
    kind: "deploy",
    phase: "running",
    steps: [step("Build", "queued"), step("Deploy", "queued")],
  });
  it.each([
    {
      name: "the call's reserved steps while nothing is read",
      read: undefined,
      tones: ["waiting", "waiting"],
      word: null,
    },
    {
      name: "a segment per pipeline step, the step it is on in words",
      read: pipeline(["finished", "running", "waiting", "waiting", "waiting"]),
      tones: ["done", "running", "waiting", "waiting", "waiting"],
      word: "Build",
    },
    {
      name: "a step activating runs",
      read: pipeline(["finished", "finished", "finished", "finished", "activating"]),
      tones: ["done", "done", "done", "done", "running"],
      word: "Deploy",
    },
    {
      name: "a step that failed says it failed",
      read: pipeline(["finished", "failed", "waiting", "waiting", "waiting"]),
      tones: ["done", "failed", "waiting", "waiting", "waiting"],
      word: "Build failed",
    },
    {
      name: "a pipeline working out its steps says so",
      read: pipeline([], true),
      tones: ["waiting", "waiting"],
      word: "Calculating steps",
    },
  ])("$name", ({ read, tones, word }) => {
    const bar = liveOperationBar(running, read);
    expect(bar.segments.map((segment) => segment.tone)).toEqual(tones);
    expect(bar.word).toBe(word);
  });
});

describe("showsCardInSlot — the live slot opens an operation onto what it read", () => {
  const read = { steps: [], chips: [], pipeline: pipeline(["running"]) };
  it.each([
    { name: "a running deploy whose pipeline is read", observed: read, open: true },
    {
      name: "a running deploy with only its log so far",
      observed: { steps: [], chips: [], ...LOG },
      open: true,
    },
    {
      name: "a running deploy nothing is read of yet: its line says it all",
      observed: undefined,
      open: false,
    },
    {
      name: "a pipeline still calculating: nothing new to show",
      observed: { steps: [], chips: [], pipeline: pipeline([], true) },
      open: false,
    },
    {
      name: "only the processes beside it: its line says it",
      observed: { steps: [], chips: [step("Restart", "done")] },
      open: false,
    },
  ] as const)("$name", ({ observed, open }) => {
    expect(showsCardInSlot(observedLinesOf(observed))).toBe(open);
  });
});

// Three deploys running at once in the live slot would outgrow its room: the
// newest running one stands open on its card, the others stay a line each.
describe("slotOpenDeployLine — the one deploy that stands open in the live slot", () => {
  const deploy = (key: string, overrides: Partial<ZeropsOperation> = {}) => ({
    key: `operation:${key}`,
    operation: operation({ key, kind: "deploy", phase: "running", subject: key, ...overrides }),
  });
  it.each([
    { name: "none in the slot", lines: [], open: null },
    { name: "the one running", lines: [deploy("d1")], open: "operation:d1" },
    {
      name: "the newest of those running",
      lines: [deploy("d1"), deploy("d2"), deploy("d3")],
      open: "operation:d3",
    },
    {
      name: "the newest running, not one that ended after it",
      lines: [deploy("d1"), deploy("d2", { phase: "done" })],
      open: "operation:d1",
    },
    {
      name: "none running: the newest, as it ended there",
      lines: [deploy("d1", { phase: "done" }), deploy("d2", { phase: "failed" })],
      open: "operation:d2",
    },
    { name: "never another kind", lines: [deploy("s1", { kind: "subdomain" })], open: null },
    {
      name: "a batch: one line, like any call",
      lines: [deploy("b1", { batch: true, subject: "apidev, webdev" })],
      open: "operation:b1",
    },
    {
      name: "the one standing open, ended before an older one: until it plops",
      lines: [deploy("d1"), deploy("d2", { phase: "done" })],
      held: "operation:d2",
      open: "operation:d2",
    },
    {
      name: "the one standing open, still running: gives way to a newer one running",
      lines: [deploy("d1"), deploy("d2")],
      held: "operation:d1",
      open: "operation:d2",
    },
    {
      name: "the one standing open plopped: the newest running",
      lines: [deploy("d1")],
      held: "operation:d2",
      open: "operation:d1",
    },
  ] as ReadonlyArray<{
    name: string;
    lines: ReadonlyArray<ReturnType<typeof deploy>>;
    held?: string;
    open: string | null;
  }>)("$name", ({ lines, held, open }) => {
    expect(slotOpenDeployLine(lines, held ?? null)).toBe(open);
  });
});

it.each(["FAILED", "FINISHED", "RUNNING"])(
  "a timed-out restart's transcript and detail drawer follow its process %s",
  (status) => {
    const process: ActivityProcess = {
      id: "restart",
      projectId: "p",
      serviceStackIds: ["s"],
      actionName: "stack.restart",
      status,
      created: "2026-10-08T10:00:00Z",
      ...(status === "RUNNING" ? {} : { finished: "2026-10-08T10:15:00Z" }),
      failReason: "serviceStack secret-id broke",
    };
    const activities = [
      {
        id: "a",
        tone: "tool",
        kind: "tool.completed",
        summary: "Tool call",
        turnId: "t",
        createdAt: "2026-10-08T10:01:00Z",
        payload: {
          toolCallId: "c",
          status: "completed",
          data: {
            toolName: "zerops_manage",
            input: { serviceHostname: "Eddy", action: "restart" },
            zerops: {
              toolName: "zerops_manage",
              resultText: JSON.stringify({
                process: { ...process, status: "RUNNING", finished: undefined },
                timedOut: true,
              }),
            },
          },
        },
      },
    ] as unknown as ReadonlyArray<OrchestrationThreadActivity>;
    const model = deriveZeropsThreadModel({
      activities,
      processes: (id) => (id === process.id ? process : undefined),
    });
    const entry = model.entries[0];
    expect(entry?.kind).toBe("operation");
    if (entry?.kind !== "operation") return;
    if (status === "RUNNING") {
      expect(model.running?.phase).toBe("running");
      expect(detailLines(entry.operation, null)).toBeGreaterThan(0);
      return;
    }
    expect(model.running).toBeUndefined();
    expect(entry.operation.phase).toBe(status === "FAILED" ? "failed" : "done");
    expect(entry.operation.statusWord).not.toContain("Restarting");
    if (status === "FAILED") {
      expect(detailLines(entry.operation, null)).toBeGreaterThan(0);
      expect(entry.operation.closing).toBe(
        "Zerops couldn't restart Eddy after 15 min — platform error.",
      );
      expect(entry.operation.steps[0]?.state).toBe("failed");
    }
  },
);
it("a completed restart with a failed process exposes its detail drawer before any card mounts", () => {
  const fields = reduceZeropsOperations(
    [
      {
        id: "c",
        toolName: "zerops_manage",
        turnId: "t",
        input: { serviceHostname: "Eddy" },
        status: "completed",
        resultText: JSON.stringify({ id: "r", actionName: "stack.restart", status: "FAILED" }),
        truncated: false,
        startedAt: "2026-10-08T10:00:00Z",
        anchorActivityId: "a",
        rowIds: new Set(["a"]),
        agentInternal: false,
      },
    ],
    { projectId: "p", builds: () => "unobservable" },
  ).operations[0]!;
  expect(detailLines(fields, null)).toBeGreaterThan(0);
});
