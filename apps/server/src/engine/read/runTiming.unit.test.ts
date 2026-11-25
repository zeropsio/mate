import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { initialState } from "../domain/state.ts";
import { makeEngineStore } from "../store/EngineStore.ts";
import {
  conversation,
  drive,
  ended,
  opened,
  prepared,
  r,
  send,
  sent,
  signal,
  sqliteWithEngineTables,
  turn,
} from "../testing/fixtures.ts";
import {
  readRunTrace,
  RUN_TRACE_SQL,
  runTiming,
  toolClass,
  type RunTraceRow,
} from "./runTiming.ts";

const row = (type: string, at: number, fields: Partial<RunTraceRow> = {}): RunTraceRow => ({
  type,
  at,
  item: null,
  kind: null,
  step: null,
  tool: null,
  input: null,
  marker: null,
  trigger: null,
  cause: null,
  ...fields,
});
const call = (item: string, at: number, tool: string, step = "tool", input: string | null = null) =>
  row("ItemOpened", at, { item, kind: "call", step, tool, input });
const close = (
  item: string,
  at: number,
  tool: string,
  step = "tool",
  input: string | null = null,
) => row("ItemClosed", at, { item, kind: "call", step, tool, input });
const tool = (name: string, step: string | null = null, input: string | null = null) => ({
  step,
  tool: name,
  input,
});

// witness: apps/server/src/engine/read/runTiming.ts | const name = bareToolName(tool ?? ""); → const name = tool ?? "";
it("RS+1: A call's time goes to its class by its tool's name with the MCP prefix read past and, for a command, by the line it ran: a Zerops deploy, the agent's browser, a zcp run, git, any other zcp tool, else other; breaks: a deploy's minutes are counted as the model's, so a release that removes a build shows no gain", () => {
  expect([
    toolClass(tool("mcp__zerops__zerops_deploy")),
    toolClass(tool("zerops_deploy_batch")),
    toolClass(tool("mcp__zerops__zerops_browser")),
    toolClass(tool("mcp__zerops__zerops_workflow")),
    toolClass(tool("mcp__github__create_issue")),
    toolClass(tool("ToolSearch")),
    toolClass(tool("Bash", "command", 'Bash: {"command":"zcp run app -- npm test"}')),
    toolClass(tool("Bash", "command", 'Bash: {"command":"cd /var/www/app && zcp git app push"}')),
    toolClass(tool("Bash", "command", 'Bash: {"command":"git status"}')),
    toolClass(tool("Bash", "command", 'Bash: {"command":"cat digit.txt"}')),
    toolClass(
      tool("Bash", "command", 'Bash: {"command":"zcp git app commit -m x && zcp run app test"}'),
    ),
    toolClass(tool("Bash", "command")),
  ]).toEqual([
    "deploy",
    "deploy",
    "browser",
    "zcp",
    "other",
    "other",
    "zcp_run",
    "git",
    "git",
    "other",
    "zcp_run",
    "other",
  ]);
});

// witness: apps/server/src/engine/read/runTiming.ts | const CLASSES = ["deploy", "browser", "zcp_run", "git", "zcp", "other"] as const; → const CLASSES = ["other", "zcp", "git", "zcp_run", "browser", "deploy"] as const;
it("RS+2: A started run's time is split with nothing counted twice or left out: waiting on the person first, then each call by its class in priority where calls overlap, then the gap holding a compaction, the rest the model's, its round-trips the stretches a call was open; a run that never started has no timing and a call still open counts to the run's end; breaks: the parts do not add up to the run, so time moved by a change hides in another part", () => {
  const scenes = [
    {
      rows: [
        row("RunQueued", 0, { trigger: "person" }),
        row("RunStarted", 1000),
        call("git", 3000, "Bash", "command"),
        close("git", 3500, "Bash", "command", 'Bash: {"command":"git status"}'),
        call("deploy", 5000, "mcp__zerops__zerops_deploy"),
        close("deploy", 65000, "mcp__zerops__zerops_deploy"),
        row("RunEnded", 70000),
      ],
      want: {
        queued: 1000,
        wall: 69000,
        firstCall: 2000,
        roundTrips: 2,
        calls: 2,
        model: 8500,
        waiting: 0,
        compaction: 0,
        tools: { git: { ms: 500, calls: 1 }, deploy: { ms: 60000, calls: 1 } },
      },
    },
    {
      rows: [
        row("RunStarted", 0),
        call("a", 2000, "Read"),
        call("b", 3000, "zerops_browser"),
        close("a", 4000, "Read"),
        close("b", 6000, "zerops_browser"),
        row("RunEnded", 7000),
      ],
      want: {
        roundTrips: 1,
        model: 3000,
        tools: { other: { ms: 1000, calls: 1 }, browser: { ms: 3000, calls: 1 } },
      },
    },
    {
      rows: [
        row("RunStarted", 0),
        call("a", 2000, "Read"),
        row("RunWaiting", 3000),
        row("RunResumed", 8000),
        close("a", 9000, "Read"),
        row("RunEnded", 10000),
      ],
      want: { waiting: 5000, model: 3000, tools: { other: { ms: 2000, calls: 1 } } },
    },
    {
      rows: [
        row("RunStarted", 0),
        call("a", 1000, "Read"),
        close("a", 10000, "Read"),
        row("ItemOpened", 40000, { item: "marker", marker: "compacted" }),
        row("ItemClosed", 40000, { item: "marker", marker: "compacted" }),
        row("ItemOpened", 41000, { item: "note", kind: "note" }),
        row("RunEnded", 50000),
      ],
      want: {
        compaction: 31000,
        compactions: 1,
        model: 10000,
        tools: { other: { ms: 9000, calls: 1 } },
      },
    },
    {
      rows: [row("RunStarted", 0), call("a", 5000, "Read"), row("RunEnded", 9000)],
      want: { roundTrips: 1, tools: { other: { ms: 4000, calls: 1 } } },
    },
    {
      rows: [
        row("RunQueued", 0, { trigger: "wake", cause: "self" }),
        row("RunStarted", 100),
        call("a", 200, "Read"),
        close("a", 200, "Read"),
        call("b", 200, "Read"),
        close("b", 300, "Read"),
        row("RunWaiting", 400),
        row("RunEnded", 500),
      ],
      want: {
        trigger: "wake:self",
        queued: 100,
        roundTrips: 1,
        calls: 2,
        waiting: 100,
        model: 200,
        tools: { other: { ms: 100, calls: 2 } },
      },
    },
  ];
  for (const { rows, want } of scenes) {
    const timing = runTiming(rows)!;
    expect(timing).toMatchObject(want);
    expect(
      timing.waiting +
        timing.compaction +
        timing.model +
        Object.values(timing.tools).reduce((sum, part) => sum + part.ms, 0),
    ).toBe(timing.wall);
  }
  expect(runTiming([row("RunQueued", 0), row("RunEnded", 1000)])).toBeUndefined();
});

const openedCall = (n: number, key: string) =>
  signal({
    kind: "item-opened",
    turn: turn(n),
    key,
    by: { kind: "mate" },
    body: {
      kind: "call",
      step: "command",
      tool: { name: "Bash" },
      words: null,
      state: "running",
      endedAt: null,
    },
  });
const closedCall = (n: number, key: string) =>
  signal({
    kind: "item-closed",
    turn: turn(n),
    key,
    body: {
      kind: "call",
      step: "command",
      tool: { name: "Bash" },
      words: null,
      state: "done",
      endedAt: 2,
      input: "git status",
    },
  });

// witness: apps/server/src/engine/read/runTiming.ts | AND run_id = ? → AND run_id IS NOT NULL AND ? IS NOT NULL
it.effect(
  "RS+3: A run's trace is its own events only, oldest first, read from its queueing on; breaks: another run's calls are counted into this run's time, or one line reads the whole conversation",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* makeEngineStore();
      yield* drive(store, initialState(conversation), [
        send("first"),
        prepared(1),
        opened(1),
        sent(1),
        openedCall(1, "first-call"),
        send("second"),
        closedCall(1, "first-call"),
        ended(1),
        prepared(2),
        sent(2),
        openedCall(2, "second-call"),
        closedCall(2, "second-call"),
        ended(2),
      ]);
      const trace = yield* readRunTrace(sql, conversation, r(2));
      expect(trace[0]?.type).toBe("RunQueued");
      expect(trace.filter((event) => event.kind === "call").map((event) => event.type)).toEqual([
        "ItemOpened",
        "ItemClosed",
      ]);
      expect(trace.at(-1)?.type).toBe("RunEnded");
      const plan = yield* sql.unsafe<{ readonly detail: string }>(
        `EXPLAIN QUERY PLAN ${RUN_TRACE_SQL}`,
        [conversation, r(2), r(2)],
      );
      expect(plan.find((line) => /engine_event/u.test(line.detail))?.detail).toMatch(/^SEARCH /u);
    }).pipe(Effect.provide(sqliteWithEngineTables)),
);
