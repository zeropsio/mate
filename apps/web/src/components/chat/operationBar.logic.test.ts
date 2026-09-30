import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import {
  importLines,
  lineSegments,
  operationLineWord,
  operationSubject,
  processReasons,
  settledOperationBar,
  settledOperationWords,
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

describe("settledOperationBar — a settled operation's bar carries what it found", () => {
  it.each([
    {
      name: "a dev server found running: green",
      op: { kind: "devServer", phase: "done", steps: [step("dev-server", "done")] },
      undone: false,
      tones: ["done"],
    },
    {
      name: "a dev server found not running, from a call that went through: amber, never green",
      op: { kind: "devServer", phase: "done", steps: [step("dev-server", "failed")] },
      undone: false,
      tones: ["attention"],
    },
    {
      name: "that finding undone by a later call: quiet",
      op: { kind: "devServer", phase: "done", steps: [step("dev-server", "failed")] },
      undone: true,
      tones: ["waiting"],
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
      name: "all checks passed: whole",
      op: { kind: "verify", phase: "done", steps: [step("a", "done"), step("b", "done")] },
      undone: false,
      tones: ["done", "done"],
    },
    {
      name: "no steps, landed: one green",
      op: { kind: "deploy", phase: "done", steps: [] },
      undone: false,
      tones: ["done"],
    },
  ] as const)("$name", ({ op, undone, tones }) => {
    expect(
      settledOperationBar(operation(op as Partial<ZeropsOperation>), undone).map(
        (segment) => segment.tone,
      ),
    ).toEqual(tones);
  });
});
