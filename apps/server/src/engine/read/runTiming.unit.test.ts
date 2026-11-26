// @effect-diagnostics nodeBuiltinImport:off globalConsoleInEffect:off -- the trace is a temporary file and its line is the receipt.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import {
  makeLocalFileTracer,
  makeTraceSink,
  type EffectTraceRecord,
} from "@t3tools/shared/observability";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ConversationsModule from "../Conversations.ts";
import { Conversations } from "../Conversations.ts";
import { initialState } from "../domain/state.ts";
import { toolClass } from "../domain/toolTiming.ts";
import { callFacts } from "../bridge/callFacts.ts";
import { makeToCore } from "../pump/toCore.ts";
import type { ItemKey } from "../bridge/spi3.ts";
import { hostEvent } from "../testing/pump/hostHarness.ts";
import * as EngineSignals from "../EngineSignals.ts";
import { EngineStore, makeEngineStore } from "../store/EngineStore.ts";
import { testTempDir } from "../../testing/testTempDir.ts";
import {
  conversation,
  drive,
  ended,
  envelope,
  opened,
  prepared,
  r,
  send,
  sent,
  signal,
  sqliteWithEngineTables,
  s1,
  T0,
  turn,
} from "../testing/fixtures.ts";
import { readRunTrace, RUN_TRACE_SQL, runTiming, type RunTraceRow } from "./runTiming.ts";

const row = (type: string, at: number, fields: Partial<RunTraceRow> = {}): RunTraceRow => ({
  type,
  at,
  item: null,
  kind: null,
  step: null,
  tool: null,
  input: null,
  action: null,
  inputComplete: null,
  command: null,
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

// witness: apps/server/src/engine/read/runTiming.ts | const callStart = call.ready ?? (call.opened.inputComplete === 0 ? closedAt : call.opened.at); → const callStart = call.opened.at;
it("RS25: A streamed call's input time belongs to the model until its input is complete, and its execution time belongs to the tool; breaks: the model writing a long command looks like a slow tool", () => {
  const timing = runTiming([
    row("RunStarted", 0),
    { ...call("shell", 0, "Bash", "command"), inputComplete: 0 },
    { ...row("ItemUpdated", 10000, { item: "shell", kind: "call" }), inputComplete: 1 },
    { ...close("shell", 11000, "Bash", "command", "zcp run app test"), inputComplete: 1 },
    row("RunEnded", 11000),
  ]);
  expect(timing).toMatchObject({
    model: 10000,
    firstCall: 10000,
    tools: { zcp_run: { ms: 1000, calls: 1 } },
  });
  const interrupted = runTiming([
    row("RunStarted", 0),
    { ...call("shell", 0, "Bash", "command"), inputComplete: 0 },
    close("shell", 10000, "Bash", "command"),
    row("RunEnded", 10000),
  ]);
  expect(interrupted).toMatchObject({ model: 10000, tools: { other: { ms: 0, calls: 1 } } });
  const stillRunning = runTiming([
    row("RunStarted", 0),
    { ...call("shell", 0, "Bash", "command"), inputComplete: 0 },
    row("ItemUpdated", 10000, {
      item: "shell",
      kind: "call",
      step: "command",
      tool: "Bash",
      inputComplete: 1,
      command: "zcp_run",
    }),
    row("RunEnded", 11000),
  ]);
  expect(stillRunning).toMatchObject({
    model: 10000,
    tools: { zcp_run: { ms: 1000, calls: 1 } },
  });
});

// witness: apps/server/src/engine/bridge/callFacts.ts | ? { commandClass: commandClass(command) } → ? { commandClass: commandClass(command.slice(0, 180)) }
it.effect(
  "RS26: A command is timed by its whole text even when the displayed line is cut; breaks: a zcp run on a later line is counted as another tool",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* makeEngineStore();
      let { state } = yield* drive(store, initialState(conversation), [
        send(),
        prepared(1),
        opened(1),
        sent(1),
      ]);
      const core = makeToCore();
      const command = `printf '%s' ${"x".repeat(2200)}\nzcp run app test`;
      const event = (type: string, input: Record<string, unknown>, inputComplete: boolean) =>
        hostEvent(type, {
          payload: {
            itemType: "command_execution",
            title: "Bash",
            detail: `Bash: ${String(input.command ?? "")}`,
            data: { toolName: "Bash", input, inputComplete },
          },
        });
      const start = callFacts(event("item.started", {}, false));
      const ready = callFacts(event("item.updated", { command }, true), start);
      const end = callFacts(event("item.completed", { command }, true), ready);
      const tell = (
        facts: typeof start,
        status: "running" | "completed",
        seq: number,
        at: number,
      ) =>
        core.step(
          {
            type: "item.upsert",
            session: s1,
            seq,
            turn: turn(1),
            item: "shell" as ItemKey,
            status,
            body: { kind: "tool", toolKind: "command_execution", title: "Bash", facts },
          },
          at,
        ).signals;
      ({ state } = yield* drive(store, state, [signal(...tell(start, "running", 1, T0))], T0));
      ({ state } = yield* drive(
        store,
        state,
        [signal(...tell(ready, "running", 2, T0 + 10000))],
        T0 + 10000,
      ));
      ({ state } = yield* drive(
        store,
        state,
        [signal(...tell(end, "completed", 3, T0 + 11000))],
        T0 + 11000,
      ));
      yield* drive(store, state, [ended(1)], T0 + 11000);
      const trace = yield* readRunTrace(sql, conversation, r(1));
      expect(
        trace.find((entry) => entry.type === "ItemUpdated" && entry.kind === "call")?.command,
      ).toBe("zcp_run");
      expect(
        trace.find((entry) => entry.type === "ItemOpened" && entry.kind === "call")?.inputComplete,
      ).toBe(0);
      expect(
        trace.find((entry) => entry.type === "ItemUpdated" && entry.kind === "call")?.inputComplete,
      ).toBe(1);
      expect(runTiming(trace)?.tools.zcp_run.calls).toBe(1);
      expect(
        trace.find((entry) => entry.type === "ItemClosed" && entry.kind === "call")?.input?.length,
      ).toBeLessThan(2200);
    }).pipe(Effect.provide(sqliteWithEngineTables)),
);

// witness: apps/server/src/engine/read/runTiming.ts | if (active.person > 0) tools.person.ms += elapsed; → if (active.person > 0) waiting += elapsed;
it("RS27: A question to the person is timed as person even while the run is waiting; breaks: waiting for an answer is counted as another tool or lost among other waits", () => {
  const timing = runTiming([
    row("RunStarted", 0),
    call("question", 1000, "AskUserQuestion"),
    row("RunWaiting", 2000),
    row("RunResumed", 5000),
    close("question", 6000, "AskUserQuestion"),
    row("RunEnded", 7000),
  ]);
  expect(timing).toMatchObject({
    model: 2000,
    waiting: 0,
    tools: { person: { ms: 5000, calls: 1 } },
  });
});

// witness: apps/server/src/engine/domain/toolTiming.ts | if (leaseAction === "acquire" || leaseAction === "release") return "lease"; → if (leaseAction === "acquire" || leaseAction === "release") return "zcp";
it("RS24: A lease acquire or release call spends its run time in lease, whether the agent calls the Zerops tool or a direct zcp command is timed in the run, while other lease actions stay in their own class; breaks: lease acquisition time is hidden among other tools", () => {
  const calls = [
    { tool: "mcp__zerops__zerops_lease", step: "tool", input: null, action: "acquire" },
    { tool: "zerops_lease", step: "tool", input: null, action: "release" },
    {
      tool: "zerops_lease",
      step: "tool",
      input: 'zerops_lease: {"action":"acquire"}',
      action: null,
    },
    { tool: "Bash", step: "command", input: "zcp lease acquire --pool webpool", action: null },
    { tool: "Bash", step: "command", input: "zcp lease release --branch work", action: null },
    {
      tool: "Bash",
      step: "command",
      input: 'Bash: {"command":"zcp lease acquire --pool webpool"}',
      action: null,
    },
  ];
  for (const fields of calls) {
    const timing = runTiming([
      row("RunStarted", 0),
      row("ItemOpened", 100, { ...fields, kind: "call", item: "lease" }),
      row("ItemClosed", 1100, { ...fields, kind: "call", item: "lease" }),
      row("RunEnded", 1200),
    ]);
    expect(timing?.tools.lease).toEqual({ ms: 1000, calls: 1 });
  }
  expect(toolClass({ tool: "zerops_lease", step: "tool", input: null, action: "status" })).toBe(
    "zcp",
  );
  expect(
    toolClass({ tool: "Bash", step: "command", input: "zcp lease status", action: null }),
  ).toBe("other");
  expect(
    toolClass({
      tool: "Bash",
      step: "command",
      input: 'rg "zcp lease acquire" docs',
      action: null,
    }),
  ).toBe("other");
  const overlapping = runTiming([
    row("RunStarted", 0),
    call("deploy", 100, "zerops_deploy"),
    row("ItemOpened", 100, {
      tool: "zerops_lease",
      action: "acquire",
      kind: "call",
      item: "lease",
    }),
    close("deploy", 1100, "zerops_deploy"),
    row("ItemClosed", 1100, {
      tool: "zerops_lease",
      action: "acquire",
      kind: "call",
      item: "lease",
    }),
    row("RunEnded", 1200),
  ]);
  expect(overlapping?.tools.deploy).toEqual({ ms: 1000, calls: 1 });
  expect(overlapping?.tools.lease).toEqual({ ms: 0, calls: 1 });
});

// witness: apps/server/src/engine/domain/toolTiming.ts | const name = bareToolName(tool ?? ""); → const name = tool ?? "";
it("RS19: A call's time goes to its class by its tool's name with the MCP prefix read past and, for a command, by the whole text it ran: a question to the person, a Zerops deploy, the agent's browser, a zcp run, git, other zcp tools apart from lease acquire or release, else other; breaks: a deploy's minutes are counted as the model's, so a release that removes a build shows no gain", () => {
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

// witness: apps/server/src/engine/read/runTiming.ts | const tool = TOOL_CLASSES.find((name) => active[name] > 0); → const tool = TOOL_CLASSES.toReversed().find((name) => active[name] > 0);
it("RS20: A started run's time is split with nothing counted twice or left out: a call asking the person first, then other waiting, then each call by its class in priority where calls overlap, then the gap holding a compaction, the rest the model's, its round-trips the stretches a call was running; a run that never started has no timing and a call still running counts to the run's end; breaks: the parts do not add up to the run, so time moved by a change hides in another part", () => {
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

const openedCall = (n: number, key: string, shows?: Readonly<Record<string, unknown>>) =>
  signal({
    kind: "item-opened",
    turn: turn(n),
    key,
    by: { kind: "mate" },
    body: {
      kind: "call",
      step: shows === undefined ? "command" : "tool",
      tool: { name: shows === undefined ? "Bash" : "zerops_lease" },
      words: null,
      state: "running",
      endedAt: null,
      ...(shows === undefined ? {} : { shows }),
    },
  });
const closedCall = (n: number, key: string, shows?: Readonly<Record<string, unknown>>) =>
  signal({
    kind: "item-closed",
    turn: turn(n),
    key,
    body: {
      kind: "call",
      step: shows === undefined ? "command" : "tool",
      tool: { name: shows === undefined ? "Bash" : "zerops_lease" },
      words: null,
      state: "done",
      endedAt: 2,
      ...(shows === undefined ? { input: "git status" } : { shows }),
    },
  });

// witness: apps/server/src/engine/read/runTiming.ts | AND run_id = ? → AND run_id IS NOT NULL AND ? IS NOT NULL
it.effect(
  "RS21: A run's trace is its own events only, oldest first, read from its queueing on; breaks: another run's calls are counted into this run's time, or one line reads the whole conversation",
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
        openedCall(2, "second-call", { item: { arguments: { action: "acquire" } } }),
        closedCall(2, "second-call", { input: { action: "acquire" } }),
        ended(2),
      ]);
      const trace = yield* readRunTrace(sql, conversation, r(2));
      expect(trace[0]?.type).toBe("RunQueued");
      expect(trace.filter((event) => event.kind === "call").map((event) => event.type)).toEqual([
        "ItemOpened",
        "ItemClosed",
      ]);
      expect(trace.filter((event) => event.kind === "call").map((event) => event.action)).toEqual([
        "acquire",
        "acquire",
      ]);
      expect(runTiming(trace)?.tools.lease.calls).toBe(1);
      expect(trace.at(-1)?.type).toBe("RunEnded");
      const plan = yield* sql.unsafe<{ readonly detail: string }>(
        `EXPLAIN QUERY PLAN ${RUN_TRACE_SQL}`,
        [conversation, r(2), r(2)],
      );
      expect(plan.find((line) => /engine_event/u.test(line.detail))?.detail).toMatch(/^SEARCH /u);
    }).pipe(Effect.provide(sqliteWithEngineTables)),
);

// witness: apps/server/src/engine/watch.ts | if (event._tag === "RunEnded") yield* traceRun(sql, conversation, event); → if (event._tag === "RunEnded") yield* Effect.void;
it.effect(
  "RS22: A run's end writes one line to the trace, named for its conversation and run, whose start and end are the run's and whose attributes are the timing's and nothing else, and the same end told again writes none; breaks: a speed change cannot be seen, is counted twice, or a person's command line lands in the trace",
  () =>
    Effect.gen(function* () {
      const filePath = NodePath.join(testTempDir("engine-run-trace-"), "server.trace.ndjson");
      const options = { filePath, maxBytes: 1_000_000, maxFiles: 2, batchWindowMs: 3_600_000 };
      const sink = yield* makeTraceSink(options);
      const fileTracer = yield* makeLocalFileTracer({ ...options, sink });
      let failTiming = false;
      const tracer = Tracer.make({
        span: (options) => {
          if (failTiming && options.name === "engine.run") throw new Error("trace unavailable");
          return fileTracer.span(options);
        },
      });
      const layer = ConversationsModule.layer().pipe(
        Layer.provideMerge(
          Layer.mergeAll(Layer.effect(EngineStore, makeEngineStore()), EngineSignals.layer),
        ),
        Layer.provideMerge(sqliteWithEngineTables),
      );
      yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        for (const command of [send("private message"), prepared(1), opened(1), sent(1)]) {
          yield* conversations.tell(envelope(command));
        }
        yield* TestClock.adjust(1000);
        yield* conversations.tell(envelope(openedCall(1, "call")));
        yield* TestClock.adjust(3000);
        yield* conversations.tell(envelope(closedCall(1, "call")));
        yield* TestClock.adjust(6000);
        const end = envelope(
          signal({
            kind: "turn-ended",
            turn: turn(1),
            outcome: { kind: "completed" },
            source: "agent",
            context: { usedTokens: 91000, maxTokens: 1000000, autoCompactWindow: 400000 },
          }),
          { id: "finish-once" },
        );
        yield* conversations.tell(end);
        yield* conversations.tell(end);
        yield* sink.flush;
        const lines = NodeFS.readFileSync(filePath, "utf8").trim().split("\n");
        const records = lines.map((line) => ({
          line,
          record: JSON.parse(line) as EffectTraceRecord,
        }));
        const runs = records.filter(({ record }) => record.name === "engine.run");
        expect(runs).toHaveLength(1);
        const { line, record } = runs[0]!;
        expect(record).toMatchObject({
          name: "engine.run",
          durationMs: 10000,
          startTimeUnixNano: "0",
          endTimeUnixNano: "10000000000",
          attributes: {
            "conversation.id": conversation,
            "run.id": r(1),
            "run.trigger": "person",
            "run.end": "completed",
            "run.queued_ms": 0,
            "run.wall_ms": 10000,
            "run.model_ms": 7000,
            "run.waiting_ms": 0,
            "run.compaction_ms": 0,
            "run.compactions": 0,
            "run.round_trips": 1,
            "run.calls": 1,
            "run.first_call_ms": 1000,
            "run.context_tokens": 91000,
            "run.tool.git_ms": 3000,
            "run.tool.git_calls": 1,
          },
        });
        expect(record.parentSpanId).toBeUndefined();
        expect(Object.keys(record.attributes).sort()).toEqual(
          [
            "conversation.id",
            "run.id",
            "run.trigger",
            "run.end",
            "run.queued_ms",
            "run.wall_ms",
            "run.model_ms",
            "run.waiting_ms",
            "run.compaction_ms",
            "run.compactions",
            "run.round_trips",
            "run.calls",
            "run.first_call_ms",
            "run.context_tokens",
            "run.tool.person_ms",
            "run.tool.person_calls",
            "run.tool.deploy_ms",
            "run.tool.deploy_calls",
            "run.tool.lease_ms",
            "run.tool.lease_calls",
            "run.tool.browser_ms",
            "run.tool.browser_calls",
            "run.tool.zcp_run_ms",
            "run.tool.zcp_run_calls",
            "run.tool.git_ms",
            "run.tool.git_calls",
            "run.tool.zcp_ms",
            "run.tool.zcp_calls",
            "run.tool.other_ms",
            "run.tool.other_calls",
          ].sort(),
        );
        expect(line).not.toContain("git status");
        expect(line).not.toContain("private message");
        console.log(`RS+4 trace: ${line}`);

        // A run with no calls or context leaves both optional attributes out.
        for (const command of [send("second"), prepared(2), sent(2)]) {
          yield* conversations.tell(envelope(command));
        }
        yield* TestClock.adjust(1000);
        yield* conversations.tell(envelope(ended(2)));
        yield* sink.flush;
        const noCalls = NodeFS.readFileSync(filePath, "utf8")
          .trim()
          .split("\n")
          .map((entry) => JSON.parse(entry) as EffectTraceRecord)
          .filter((entry) => entry.name === "engine.run");
        expect(noCalls).toHaveLength(2);
        expect(noCalls[1]!.attributes).toMatchObject({
          "run.id": r(2),
          "run.calls": 0,
          "run.wall_ms": 1000,
        });
        expect(noCalls[1]!.attributes).not.toHaveProperty("run.first_call_ms");
        expect(noCalls[1]!.attributes).not.toHaveProperty("run.context_tokens");

        // A tracer defect after the next commit must not make that committed end fail.
        for (const command of [send("third"), prepared(3), sent(3)]) {
          yield* conversations.tell(envelope(command));
        }
        failTiming = true;
        const result = yield* conversations.tell(envelope(ended(3)));
        expect(result._tag).toBe("Accepted");
        expect((yield* conversations.state(conversation)).runs[r(3)]?.state).toBe("ended");
        yield* sink.flush;
        const after = NodeFS.readFileSync(filePath, "utf8").trim().split("\n");
        expect(
          after
            .map((entry) => JSON.parse(entry) as EffectTraceRecord)
            .filter((entry) => entry.name === "engine.run"),
        ).toHaveLength(2);
      }).pipe(Effect.provide(layer), Effect.provideService(Tracer.Tracer, tracer));
    }),
);
