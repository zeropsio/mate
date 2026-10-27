// @effect-diagnostics nodeBuiltinImport:off -- real workspace files and isolated server state.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  RuntimeItemId,
  RuntimeTaskId,
  TurnId,
  type ServerProvider,
  type EngineConversationFrame,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { makeScriptedProvider, type ScriptedStep } from "./scriptedProviderDriver.ts";
import { startScenarioMate } from "./scenarioMate.ts";

const protocol = MATE_ENGINE_PROTOCOLS[0]!;
const conversationId = ConversationId.make("vocabulary");
const caller = { subject: "scenario-person", environmentId: "scenario", epoch: 1 };
const start = Effect.gen(function* () {
  const provider = yield* makeScriptedProvider();
  const mate = yield* Effect.acquireRelease(
    Effect.promise(() =>
      startScenarioMate({
        projectId: "vocabulary",
        serviceId: "service-vocabulary",
        hostname: "zcp",
        zeropsApiBaseUrl: "http://127.0.0.1:9/api/rest/public",
        zeropsApiToken: "scenario-key",
        publicOrigin: "https://scenario.invalid",
        now: Date.now,
        drivers: [provider.driver],
      }),
    ),
    (mate) => Effect.promise(() => mate.stop().then(mate.remove)),
  );
  yield* mate.engine.assignAgent(conversationId, {
    instanceId: "opencode",
    driver: "opencode",
    model: "gpt-5.4",
    profile: { kind: "mate" },
  });
  return { provider, mate, wire: mate.engine.wire };
});
// Authored OpenCode shape, not a native recording. The real SPI reader and call projection own it.
const openCodeData = (data: unknown) => {
  const facts = data as { toolName: string; input?: unknown; result?: unknown };
  return {
    tool:
      facts.toolName === "mcp__zerops__zerops_browser" ? "zerops_zerops_browser" : facts.toolName,
    state: {
      status: facts.result === undefined ? "running" : "completed",
      input: facts.input,
      output:
        typeof facts.result === "string"
          ? facts.result
          : (
              facts.result as { content?: Array<{ type: string; text?: string }> } | undefined
            )?.content
              ?.filter((b) => b.type === "text")
              .map((b) => b.text)
              .join(""),
      attachments: (
        facts.result as
          | { content?: Array<{ type: string; source?: { data: string; media_type: string } }> }
          | undefined
      )?.content
        ?.filter((b) => b.type === "image")
        .map((b) => ({
          type: "file",
          mime: b.source?.media_type,
          url: "data:" + b.source?.media_type + ";base64," + b.source?.data,
        })),
    },
    ...facts,
  };
};
const item = (
  type: "item.started" | "item.updated" | "item.completed",
  id: string,
  itemType: "command_execution" | "file_change" | "mcp_tool_call" | "image_view",
  data: unknown,
): ScriptedStep => ({
  kind: "event",
  event: {
    type,
    itemId: RuntimeItemId.make(id),
    payload: {
      itemType,
      detail:
        (data as { input?: { command?: string; file_path?: string } }).input?.command ??
        (data as { input?: { file_path?: string } }).input?.file_path,
      status: type === "item.completed" ? "completed" : "inProgress",
      data: openCodeData(data),
    },
  },
});
const completed = (
  world: Effect.Success<typeof start>,
  command: string,
  steps: ReadonlyArray<ScriptedStep>,
  end = "completed",
) =>
  Effect.gen(function* () {
    const { wire, provider } = world;
    const frames = yield* Queue.unbounded<EngineConversationFrame>();
    yield* wire.subscribe({ protocol, conversationId }, caller).pipe(
      Stream.runForEach((frame) => Queue.offer(frames, frame)),
      Effect.forkScoped,
    );
    while ((yield* Queue.take(frames)).type !== "synchronized") {}
    yield* provider.turn(steps);
    expect(
      (yield* wire.send(
        { protocol, conversationId, commandId: CommandId.make(command), text: command },
        caller,
      ))._tag,
    ).toBe("Accepted");
    while (true) {
      const frame = yield* Queue.take(frames);
      if (frame.type === "changes" && frame.runs.some((run) => run.state === "ended")) {
        const run = frame.runs.find((run) => run.state === "ended")!;
        expect(
          JSON.stringify(run.end),
          "ASSERTION: scripted provider turn reaches the real engine",
        ).toContain(`"kind":"${end}"`);
        const page = yield* wire.readRun({ protocol, conversationId, runId: run.id });
        if (page._tag !== "Page") throw new Error("Run is unserved");
        return { run, page };
      }
    }
  });

describe("scripted vocabulary through the real client wire", () => {
  it.live("overlapping commands keep independent full outputs and file-write facts", () =>
    Effect.gen(function* () {
      const world = yield* start;
      const output = Array.from({ length: 4000 }, (_, i) => `Build log line ${i}`).join("\n");
      const { page } = yield* completed(world, "Inspect both", [
        item("item.started", "a", "command_execution", {
          toolName: "Bash",
          input: { command: "printf first-proof" },
        }),
        item("item.started", "b", "command_execution", {
          toolName: "Bash",
          input: { command: "printf second-proof" },
        }),
        {
          kind: "event",
          event: {
            type: "content.delta",
            itemId: RuntimeItemId.make("b"),
            payload: { streamKind: "command_output", delta: "Second result" },
          },
        },
        item("item.completed", "b", "command_execution", {
          toolName: "Bash",
          result: "Second result",
        }),
        {
          kind: "event",
          event: {
            type: "content.delta",
            itemId: RuntimeItemId.make("a"),
            payload: { streamKind: "command_output", delta: output },
          },
        },
        item("item.completed", "a", "command_execution", { toolName: "Bash", result: output }),
        item("item.started", "write", "file_change", {
          toolName: "Write",
          input: { file_path: "/srv/app/summary.txt", content: "Recorded first write" },
        }),
        item("item.completed", "write", "file_change", {
          toolName: "Write",
          input: { file_path: "/srv/app/summary.txt", content: "Recorded first write" },
          result: "Written",
        }),
      ]);
      const calls = page.items.filter((i) => i.kind === "call");
      expect(calls.map((c) => c.input)).toEqual([
        "printf first-proof",
        "printf second-proof",
        "/srv/app/summary.txt",
      ]);
      const detail = yield* world.wire.readDetail({
        protocol,
        conversationId,
        itemId: calls[0]!.id,
        part: "detail",
      });
      expect(detail._tag === "Detail" ? detail.text : null).toBe(output);
      expect(calls[2]?.shows).toMatchObject({ toolName: "Write", wrote: true });
    }),
  );
  it.live("helper lifecycles retain ids, prompts, status and reports in the client record", () =>
    Effect.gen(function* () {
      const world = yield* start;
      const taskId = RuntimeTaskId.make("schema-helper");
      const { page } = yield* completed(world, "Use a helper", [
        {
          kind: "event",
          event: {
            type: "task.started",
            payload: {
              taskId,
              taskType: "subagent",
              title: "Schema helper",
              prompt: "Check the schema",
              toolUseId: "helper-launch",
            },
          },
        },
        {
          kind: "event",
          event: {
            type: "task.progress",
            payload: {
              taskId,
              taskType: "subagent",
              description: "Checking keys",
              typedUsage: { totalTokens: 7 },
            },
          },
        },
        {
          kind: "event",
          event: {
            type: "task.updated",
            payload: { taskId, taskType: "subagent", status: "waiting" },
          },
        },
        {
          kind: "event",
          event: {
            type: "task.completed",
            payload: {
              taskId,
              taskType: "subagent",
              status: "completed",
              summary: "The helper checked the key independently",
            },
          },
        },
      ]);
      expect(page.items.filter((i) => i.kind === "work")).toHaveLength(1);
      expect(page.items.filter((i) => i.kind === "work")).toMatchObject([
        {
          title: "Schema helper",
          status: "completed",
          report: "The helper checked the key independently",
        },
      ]);
    }),
  );
  it.live(
    "structured browser results and workspace tool pictures become real file-backed assets",
    () =>
      Effect.gen(function* () {
        const world = yield* start;
        const { mate } = world;
        const picture = NodePath.join(mate.root, "workspace", "proof.png");
        const bytes = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=",
          "base64",
        );
        yield* Effect.promise(() => NodeFSP.writeFile(picture, bytes));
        const result = '{"url":"https://store.example/orders","steps":[]}';
        const { page } = yield* completed(world, "Check the page", [
          item("item.started", "browser", "mcp_tool_call", {
            toolName: "mcp__zerops__zerops_browser",
            input: { commands: [["open", "https://store.example/orders"]] },
          }),
          item("item.completed", "browser", "mcp_tool_call", {
            toolName: "mcp__zerops__zerops_browser",
            result: {
              content: [
                { type: "text", text: result },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: bytes.toString("base64"),
                  },
                },
              ],
            },
          }),
          item("item.completed", "look", "image_view", {
            toolName: "Read",
            input: { file_path: picture },
            imagePath: picture,
          }),
        ]);
        const calls = page.items.filter((i) => i.kind === "call");
        expect(calls[0]?.result).toMatchObject({
          toolName: "zerops_browser",
          resultText: result,
          images: [{ asset: { original: { status: "ready" } } }],
        });
        expect(calls[1]?.shows?.imagePath).toMatch(/^mate-asset:/);
        const assets = yield* Effect.promise(() =>
          NodeFSP.readdir(NodePath.join(mate.stateDir, "assets"), { recursive: true }),
        );
        expect(assets.length).toBeGreaterThan(0);
      }),
  );
});

const observe = (world: Effect.Success<typeof start>) =>
  Effect.gen(function* () {
    const frames = yield* Queue.unbounded<EngineConversationFrame>();
    yield* world.wire.subscribe({ protocol, conversationId }, caller).pipe(
      Stream.runForEach((frame) => Queue.offer(frames, frame)),
      Effect.forkScoped,
    );
    while ((yield* Queue.take(frames)).type !== "synchronized") {}
    return frames;
  });
const until = (
  frames: Queue.Queue<EngineConversationFrame>,
  predicate: (frame: EngineConversationFrame) => boolean,
) =>
  Effect.gen(function* () {
    while (true) {
      const frame = yield* Queue.take(frames);
      if (predicate(frame)) return frame;
    }
  });

describe("scripted turn control through the real client wire", () => {
  it.live("assistant and thought deltas retain one item across a fresh subscription", () =>
    Effect.gen(function* () {
      const world = yield* start;
      const frames = yield* observe(world);
      const release = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const assistant = RuntimeItemId.make("continuing-answer");
      const thought = RuntimeItemId.make("continuing-thought");
      yield* world.provider.turn([
        {
          kind: "event",
          event: {
            type: "item.started",
            itemId: assistant,
            payload: { itemType: "assistant_message" },
          },
        },
        {
          kind: "event",
          event: {
            type: "content.delta",
            itemId: assistant,
            payload: { streamKind: "assistant_text", delta: "First" },
          },
        },
        {
          kind: "event",
          event: { type: "item.started", itemId: thought, payload: { itemType: "reasoning" } },
        },
        {
          kind: "event",
          event: {
            type: "content.delta",
            itemId: thought,
            payload: { streamKind: "reasoning_text", delta: "Checking the source" },
          },
        },
        { kind: "wait", until: release },
        {
          kind: "event",
          event: {
            type: "item.updated",
            itemId: assistant,
            payload: { itemType: "assistant_message", status: "inProgress" },
          },
        },
        {
          kind: "event",
          event: {
            type: "content.delta",
            itemId: assistant,
            payload: { streamKind: "assistant_text", delta: " and second" },
          },
        },
        { kind: "wait", until: finish },
        {
          kind: "event",
          event: {
            type: "item.completed",
            itemId: assistant,
            payload: { itemType: "assistant_message", status: "completed" },
          },
        },
        {
          kind: "event",
          event: {
            type: "item.completed",
            itemId: thought,
            payload: { itemType: "reasoning", status: "completed" },
          },
        },
      ]);
      yield* world.wire.send(
        { protocol, conversationId, commandId: CommandId.make("continue-item"), text: "Continue" },
        caller,
      );
      yield* until(
        frames,
        (f) =>
          (f.type === "live.append" || f.type === "live.open") && f.text === "Checking the source",
      );
      const reload = yield* Queue.unbounded<EngineConversationFrame>();
      yield* world.wire.subscribe({ protocol, conversationId }, caller).pipe(
        Stream.runForEach((f) => Queue.offer(reload, f)),
        Effect.forkScoped,
      );
      const reopened = yield* until(reload, (f) => f.type === "live.open" && f.text === "First");
      if (reopened.type !== "live.open") throw new Error("No answer");
      yield* Deferred.succeed(release, undefined);
      const appended = yield* until(
        reload,
        (f) => f.type === "live.append" && f.text === " and second",
      );
      expect(appended).toMatchObject({ itemId: reopened.itemId, offset: 5 });
      yield* Deferred.succeed(finish, undefined);
      const ended = yield* until(
        reload,
        (f) => f.type === "changes" && f.runs.some((r) => r.state === "ended"),
      );
      if (ended.type !== "changes") throw new Error("No run");
      const page = yield* world.wire.readRun({
        protocol,
        conversationId,
        runId: ended.runs.find((r) => r.state === "ended")!.id,
      });
      expect(JSON.stringify(page)).toContain("First and second");
      expect(JSON.stringify(page)).toContain("Checking the source");
    }),
  );
  it.live("steering reaches the running native turn and stop interrupts its remaining steps", () =>
    Effect.gen(function* () {
      const world = yield* start;
      const frames = yield* observe(world);
      const release = yield* Deferred.make<void>();
      yield* world.provider.turn([
        { kind: "wait", until: release },
        { kind: "say", text: "Must never arrive" },
      ]);
      yield* world.wire.send(
        { protocol, conversationId, commandId: CommandId.make("running"), text: "Start" },
        caller,
      );
      const native = yield* world.provider.received;
      const running = yield* until(
        frames,
        (f) => f.type === "changes" && f.runs.some((r) => r.state === "running"),
      );
      if (running.type !== "changes") throw new Error("No run");
      const runId = running.runs.find((r) => r.state === "running")!.id;
      expect(
        (yield* world.wire.steer(
          {
            protocol,
            conversationId,
            commandId: CommandId.make("steer"),
            runId,
            text: "Use the revised plan",
          },
          caller,
        ))._tag,
      ).toBe("Accepted");
      const steered = yield* world.provider.received;
      expect(steered.turnId).toBe(native.turnId);
      expect(steered.input.input).toBe("Use the revised plan");
      expect(
        (yield* world.wire.stop(
          { protocol, conversationId, commandId: CommandId.make("stop"), runId },
          caller,
        ))._tag,
      ).toBe("Accepted");
      const ended = yield* until(
        frames,
        (f) => f.type === "changes" && f.runs.some((r) => r.state === "ended"),
      );
      expect(JSON.stringify(ended)).toContain('"kind":"stopped"');
      yield* Deferred.succeed(release, undefined);
      const page = yield* world.wire.readRun({ protocol, conversationId, runId });
      expect(JSON.stringify(page)).not.toContain("Must never arrive");
    }),
  );
  it.live("structured provider errors reach the failed run and its error item", () =>
    Effect.gen(function* () {
      const world = yield* start;
      const { run, page } = yield* completed(
        world,
        "Dev failed",
        [
          {
            kind: "event",
            event: {
              type: "runtime.error",
              payload: {
                class: "provider_error",
                message: "Dev refused",
                detail: { code: "EADDRINUSE", port: 8080 },
              },
            },
          },
          {
            kind: "event",
            event: {
              type: "turn.completed",
              payload: { state: "failed", errorMessage: "Dev refused" },
            },
          },
        ],
        "failed",
      );
      expect(JSON.stringify(run.end)).toContain("Dev refused");
      expect(JSON.stringify(page.items)).toContain("Dev refused");
    }),
  );
});

it.live("background completion and an unsolicited native turn reach the real client wire", () =>
  Effect.gen(function* () {
    const world = yield* start;
    const taskId = RuntimeTaskId.make("background-build");
    const { run } = yield* completed(world, "Start background build", [
      {
        kind: "event",
        event: {
          type: "task.started",
          payload: { taskId, taskType: "local_shell", description: "Background build" },
        },
      },
      { kind: "say", text: "Build started" },
    ]);
    const native = world.provider.sends[0]!;
    const frames = yield* observe(world);
    yield* world.provider.event(native.threadId, {
      type: "task.completed",
      turnId: native.turnId,
      payload: {
        taskId,
        taskType: "local_shell",
        status: "completed",
        summary: "Build completed outside the original turn",
      },
    });
    const reported = yield* until(
      frames,
      (f) =>
        f.type === "changes" &&
        f.items.some(
          (i) => i.kind === "work" && i.report === "Build completed outside the original turn",
        ),
    );
    if (reported.type !== "changes") throw new Error("No background report");
    expect(reported.items.filter((i) => i.kind === "work")).toMatchObject([
      { runId: run.id, status: "completed" },
    ]);
    yield* world.provider.event(native.threadId, {
      type: "turn.started",
      turnId: TurnId.make("native-wake"),
      payload: {},
    });
    yield* world.provider.event(native.threadId, {
      type: "content.delta",
      itemId: RuntimeItemId.make("wake-answer"),
      payload: { streamKind: "assistant_text", delta: "The build woke the agent" },
    });
    yield* world.provider.event(native.threadId, {
      type: "turn.completed",
      payload: { state: "completed" },
    });
    const wake = yield* until(
      frames,
      (f) => f.type === "changes" && f.runs.some((r) => r.state === "ended" && r.id !== run.id),
    );
    if (wake.type !== "changes") throw new Error("No wake");
    const woke = wake.runs.find((r) => r.state === "ended" && r.id !== run.id)!;
    expect(woke.trigger).toMatchObject({ kind: "wake", cause: "self" });
    const page = yield* world.wire.readRun({ protocol, conversationId, runId: woke.id });
    expect(JSON.stringify(page)).toContain("The build woke the agent");
  }),
);

it.live("provider usage snapshots and sparse reset events reach the real instance registry", () =>
  Effect.gen(function* () {
    const world = yield* start;
    const frames = yield* observe(world);
    const release = yield* Deferred.make<void>();
    yield* world.provider.turn([{ kind: "wait", until: release }]);
    yield* world.wire.send(
      { protocol, conversationId, commandId: CommandId.make("quota"), text: "Check quota" },
      caller,
    );
    const native = yield* world.provider.received;
    const snapshots = yield* Queue.unbounded<ReadonlyArray<ServerProvider>>();
    yield* world.mate.providers.changes.pipe(
      Stream.runForEach((p) => Queue.offer(snapshots, p)),
      Effect.forkScoped,
    );
    const window = {
      id: "five_hour",
      kind: "session" as const,
      label: "5-hour",
      usedPercent: 100,
      resetsAt: "2026-10-13T14:00:00.000Z",
      windowDurationMins: 300,
    };
    yield* world.provider.event(native.threadId, {
      type: "account.rate-limits.updated",
      payload: {
        limits: { windows: [window] },
        blocked: { window: "5-hour", resetsAt: window.resetsAt },
        refused: true,
      },
    });
    let limited: ReadonlyArray<ServerProvider>;
    do {
      limited = yield* Queue.take(snapshots);
    } while (
      limited.find((p) => p.instanceId === "opencode")?.usageLimits?.windows[0]?.usedPercent !== 100
    );
    expect(limited.find((p) => p.instanceId === "opencode")?.usageLimits?.windows).toEqual([
      window,
    ]);
    yield* world.provider.event(native.threadId, {
      type: "account.rate-limits.updated",
      payload: { limits: { windows: [{ ...window, usedPercent: 0 }] }, refused: false },
    });
    let reset: ReadonlyArray<ServerProvider>;
    do {
      reset = yield* Queue.take(snapshots);
    } while (
      reset.find((p) => p.instanceId === "opencode")?.usageLimits?.windows[0]?.usedPercent !== 0
    );
    expect(reset.find((p) => p.instanceId === "opencode")?.usageLimits?.windows).toEqual([
      { ...window, usedPercent: 0 },
    ]);
    yield* Deferred.succeed(release, undefined);
    yield* until(frames, (f) => f.type === "changes" && f.runs.some((r) => r.state === "ended"));
  }),
);
