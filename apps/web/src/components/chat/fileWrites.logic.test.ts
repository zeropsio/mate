import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import {
  filesTarget,
  removedWords,
  stepWriteCalls,
  writtenAtWords,
  writtenFileRefusalWords,
} from "./fileWrites.logic";
import { stepOf } from "./workSteps.logic";

const call = (overrides: Partial<WorkLogEntry>): WorkLogEntry => ({
  id: "w1",
  createdAt: "2026-10-06T10:00:00.000Z",
  turnId: TurnId.make("t1"),
  label: "Write",
  tone: "tool",
  toolCallId: "call-1",
  itemType: "file_change",
  changedFiles: ["/srv/app/notes.md"],
  toolLifecycleStatus: "completed",
  sourceActivityKind: "tool.completed",
  ...overrides,
});

describe("stepWriteCalls — the calls a row opens onto, by what they sent", () => {
  it.each<{
    readonly name: string;
    readonly entry: Partial<WorkLogEntry>;
    readonly calls: string[];
  }>([
    { name: "a write that sent what it wrote", entry: { wroteFile: true }, calls: ["call-1"] },
    { name: "a write that sent nothing of it", entry: {}, calls: [] },
    {
      name: "a write still running: it opens once it has written",
      entry: {
        wroteFile: true,
        toolLifecycleStatus: "inProgress",
        sourceActivityKind: "tool.started",
      },
      calls: [],
    },
    {
      name: "a failed write wrote nothing",
      entry: { wroteFile: true, toolLifecycleStatus: "failed" },
      calls: [],
    },
    {
      name: "a command never opens onto a write",
      entry: { wroteFile: true, itemType: "command_execution", command: "ls" },
      calls: [],
    },
  ])("$name", ({ entry, calls }) => {
    expect(stepWriteCalls(stepOf(call(entry), undefined, false))).toEqual(calls);
  });
});

describe("filesTarget — where Open in Files goes", () => {
  it.each([
    { path: "/srv/app/src/a.ts", cwd: "/srv/app", target: { kind: "workspace", path: "src/a.ts" } },
    { path: "/srv/app/", cwd: "/srv/app", target: null },
    { path: "src/a.ts", cwd: "/srv/app", target: { kind: "workspace", path: "src/a.ts" } },
    {
      path: "/srv/appendix/a.ts",
      cwd: "/srv/app",
      target: { kind: "outside", path: "/srv/appendix/a.ts" },
    },
    { path: "/tmp/plan.md", cwd: "/srv/app/", target: { kind: "outside", path: "/tmp/plan.md" } },
    { path: "/tmp/plan.md", cwd: null, target: { kind: "outside", path: "/tmp/plan.md" } },
    { path: "../up.md", cwd: "/srv/app", target: null },
  ] as const)("$path in $cwd", ({ path, cwd, target }) => {
    expect(filesTarget(path, cwd)).toEqual(target);
  });
});

describe("removedWords — a change that only removes, as a count", () => {
  it.each([
    [1, "Removed 1 line"],
    [3, "Removed 3 lines"],
  ])("%i", (count, words) => {
    expect(removedWords(count)).toBe(words);
  });
});

describe("writtenAtWords — the Files tab's label on what the Mate wrote", () => {
  it.each([
    ["Sage", "01:23", "As Sage wrote it at 01:23"],
    [null, "01:23", "As your Mate wrote it at 01:23"],
  ] as const)("%s at %s", (mate, time, words) => {
    expect(writtenAtWords(mate, time)).toBe(words);
  });
});

describe("writtenFileRefusalWords — why the Files tab shows no written file", () => {
  it.each([
    ["not_written", "Sage", "Sage didn't write this file in this conversation, so it isn't shown."],
    [
      "not_written",
      null,
      "Your Mate didn't write this file in this conversation, so it isn't shown.",
    ],
    ["not_absolute", "Sage", "This file can't be shown here."],
    [null, "Sage", "This file can't be shown here."],
  ] as const)("%s, %s", (reason, mate, words) => {
    expect(writtenFileRefusalWords(reason, mate)).toBe(words);
  });
});
