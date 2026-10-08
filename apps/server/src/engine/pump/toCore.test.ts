// @effect-diagnostics nodeBuiltinImport:off
/**
 * What the engine takes from a driver, pinned as sentences: the bridge's goldens through the
 * pump's mapping, and the mapping's own rules.
 */

import { assert, describe, it } from "vite-plus/test";

import type { BridgeDriver, DriverSignal, SessionId, TurnHandle } from "../bridge/spi3.ts";
import { makeTranslator } from "../bridge/translate.ts";
import { readGolden } from "../testing/bridge/goldens.ts";
import { commandLogAround } from "../testing/bridge/record.ts";
import { stepLines } from "../testing/pump/lines.ts";
import { ACTIVITY_EVERY_MS, ITEM_TEXT_LIMIT, makeToCore } from "./toCore.ts";

const OPENS = ["h1 started by engine", "h1 taken: opened"];
const HELLO = [
  ...OPENS,
  "s1.n1 closed: marker plan",
  "h1.i1 opened: note",
  "h1 alive",
  'h1.i1 closed: note "hello from mock"',
  "h1 ended completed — agent",
];

const goldens: ReadonlyArray<{
  readonly driver: BridgeDriver;
  readonly dir: string;
  readonly name: string;
  readonly title: string;
  readonly lines: ReadonlyArray<string>;
}> = [
  {
    driver: "claudeAgent",
    dir: "claude",
    name: "plain-text-turn",
    title: "a reply is a note that closes with every word the agent streamed",
    lines: [
      ...OPENS,
      "h1.i1 opened: note",
      "h1 alive",
      'h1.i1 closed: note "ok"',
      "h1 ended completed — agent",
    ],
  },
  {
    driver: "claudeAgent",
    dir: "claude",
    name: "zerops-workflow-envelope",
    title: "each call is a call item that opens running and closes done, between the notes",
    lines: [
      ...OPENS,
      "h1.i1 opened: note",
      "h1 alive",
      `h1.i1 closed: note "I'll load the schemas for those two tool"`,
      "h1.i2 opened: call tool ToolSearch running",
      "h1.i2 updated: call tool ToolSearch running",
      "h1.i2 closed: call tool ToolSearch done",
      "h1.i3 opened: call mcp zerops_workflow running",
      "h1.i3 updated: call mcp zerops_workflow running",
      "h1.i3 updated: call mcp zerops_workflow running",
      "h1.i3 updated: call mcp zerops_workflow running",
      "h1.i3 closed: call mcp zerops_workflow done",
      "h1.i4 opened: call mcp zerops_mount running",
      "h1.i4 updated: call mcp zerops_mount running",
      "h1.i4 updated: call mcp zerops_mount running",
      "h1.i4 updated: call mcp zerops_mount running",
      "h1.i4 closed: call mcp zerops_mount done",
      "h1.i5 opened: note",
      'h1.i5 closed: note "Both calls done. Stopping here as asked."',
      "h1 ended completed — agent",
    ],
  },
  {
    driver: "claudeAgent",
    dir: "claude",
    name: "user-input-requested",
    title: "a question opens in its turn and closes answered",
    lines: [
      ...OPENS,
      "h1.i1 opened: call tool AskUserQuestion running",
      "h1.i1 updated: call tool AskUserQuestion running",
      "s1.r1 asks question in h1",
      "s1.r1 answered",
      "h1.i1 closed: call tool AskUserQuestion done",
      "h1.i2 opened: note",
      "h1 alive",
      'h1.i2 closed: note "done"',
      "h1 ended completed — agent",
    ],
  },
  {
    driver: "claudeAgent",
    dir: "claude",
    name: "turn-abort-error",
    title: "the agent's own abort ends the turn interrupted, its open call unreturned",
    lines: [
      ...OPENS,
      "h1.i1 opened: note",
      "h1 alive",
      `h1.i1 closed: note "I'll load the schemas for both tools fir"`,
      "h1.i2 opened: call tool ToolSearch running",
      "h1.i2 closed: call tool ToolSearch unreturned",
      "h1 ended interrupted — agent",
    ],
  },
  {
    driver: "claudeAgent",
    dir: "claude",
    name: "crew-hooks",
    title: "a failed command closes failed once, however often the driver says so",
    lines: [
      ...OPENS,
      "h1.i1 opened: call command Bash running",
      "h1.i1 updated: call command Bash running",
      "h1.i1 updated: call command Bash running",
      "h1 alive",
      "h1.i1 closed: call command Bash done",
      "h1.i2 opened: call command Bash running",
      "h1.i2 updated: call command Bash running",
      "h1.i2 closed: call command Bash failed",
      "h1.i3 opened: note",
      `h1.i3 closed: note "Listed my copy; the delete outside it wa"`,
      "h1 ended completed — agent",
    ],
  },
  {
    driver: "codex",
    dir: "codex",
    name: "helper-wait",
    title: "a helper's spawn is a helper call; the turn has not ended inside the capture",
    lines: [
      ...OPENS,
      "h1.i1 opened: call helper collab_agent_tool_call running",
      "h1.i1 closed: call helper collab_agent_tool_call done",
    ],
  },
  {
    driver: "codex",
    dir: "codex",
    name: "multi-agent-wire",
    title: "a command, a Zerops call and the answer each close, and the turn ends completed",
    lines: [
      ...OPENS,
      "h1.i1 opened: call command Ran command running",
      "h1 alive",
      "h1.i1 closed: call command Ran command done",
      "h1.i2 opened: call mcp zerops · zerops_discover running",
      "h1.i2 closed: call mcp zerops_discover done",
      "h1.i3 opened: note",
      'h1.i3 closed: note "trace-ok"',
      "h1 ended completed — agent",
    ],
  },
  ...(["cursor", "grok", "antigravity"] as const).map((driver) => ({
    driver,
    dir: driver,
    name: "hello-baseline",
    title: "a hello is a plan marker, one note and an end the agent gave",
    lines: HELLO,
  })),
  {
    driver: "cursor",
    dir: "cursor",
    name: "mcp-calls",
    title: "calls known only from their updates are call items all the same",
    lines: [
      ...OPENS,
      "h1.i1 opened: call tool zerops_discover running",
      "h1.i1 closed: call tool zerops_discover done",
      "h1.i2 opened: call command zerops_deploy running",
      "h1.i2 closed: call command zerops_deploy done",
      "h1.i3 opened: note",
      "h1 alive",
      'h1.i3 closed: note "deployed"',
      "h1 ended completed — agent",
    ],
  },
  {
    driver: "opencode",
    dir: "opencode",
    name: "hello-baseline",
    title: "a stream that never opens a turn gives the engine nothing",
    lines: [],
  },
];

describe("the engine's inputs over every bridge golden", () => {
  for (const golden of goldens) {
    it(`${golden.driver}/${golden.name}: ${golden.title}`, () => {
      const events = readGolden(golden.dir, golden.name);
      const translator = makeTranslator({
        driver: golden.driver,
        threadId: String(events[0]!.threadId),
      });
      const toCore = makeToCore({ nativeTurn: translator.nativeTurn });
      const lines = commandLogAround(golden.driver, events)
        .flatMap((input) => translator.step(input))
        .flatMap((signal) => stepLines(toCore.step(signal, 0)));
      assert.deepStrictEqual(lines, golden.lines);
    });
  }
});

const S1 = "s1" as SessionId;
const H1 = "h1" as TurnHandle;
const R1 = "mate/r/1" as TurnHandle;
let seq = 0;
const sig = (body: Record<string, unknown>): DriverSignal =>
  ({ session: S1, seq: ++seq, ...body }) as unknown as DriverSignal;
const text = (item: string, at: number, words: string) =>
  sig({ type: "item.append", item, stream: "text", at, text: words });
const upsert = (item: string, status: string, turn: TurnHandle = H1) =>
  sig({ type: "item.upsert", turn, item, body: { kind: "text" }, status });

describe("the pump's mapping", () => {
  it("a long reply's first 16 KiB are its body and its whole text is its detail", () => {
    const toCore = makeToCore();
    const long = "x".repeat(ITEM_TEXT_LIMIT + 10);
    toCore.step(upsert("h1.i1", "running"), 0);
    toCore.step(text("h1.i1", 0, long), 0);
    const closed = toCore.step(upsert("h1.i1", "completed"), 0).signals[0]!;
    assert.strictEqual(closed.kind, "item-closed");
    if (closed.kind !== "item-closed" || closed.body.kind !== "note") return;
    assert.strictEqual(closed.body.text.length, ITEM_TEXT_LIMIT);
    assert.strictEqual(closed.detail, long);
  });

  it("text the driver says again at its own offset is never doubled", () => {
    const toCore = makeToCore();
    toCore.step(upsert("h1.i1", "running"), 0);
    toCore.step(text("h1.i1", 0, "hel"), 0);
    toCore.step(text("h1.i1", 3, "lo"), 0);
    toCore.step(text("h1.i1", 3, "lo"), 0);
    const closed = toCore.step(upsert("h1.i1", "completed"), 0).signals[0]!;
    assert.deepStrictEqual(closed.kind === "item-closed" && closed.body, {
      kind: "note",
      text: "hello",
      streaming: false,
      answer: false,
    });
  });

  const call = (status: string, presentation?: unknown) =>
    sig({
      type: "item.upsert",
      turn: H1,
      item: "h1.i1",
      body: {
        kind: "tool",
        toolKind: "mcp_tool_call",
        title: "MCP tool call",
        ...(presentation === undefined ? {} : { presentation }),
      },
      status,
    });
  const closedCall = (step: ReturnType<ReturnType<typeof makeToCore>["step"]>) => {
    const closed = step.signals.find((signal) => signal.kind === "item-closed");
    return closed?.kind === "item-closed" && closed.body.kind === "call" ? closed.body : undefined;
  };

  it.each([
    ["completed", "done"],
    ["failed", "failed"],
    ["declined", "declined"],
    ["stopped", "stopped"],
  ] as const)("a call the bridge closes %s is a %s call", (status, state) => {
    const toCore = makeToCore();
    toCore.step(call("running"), 0);
    assert.strictEqual(closedCall(toCore.step(call(status), 0))?.state, state);
  });

  it("a call's presentation, an MCP tool's own title and server, rides on its record", () => {
    const presentation = {
      title: "Deploy a service",
      source: { key: "mcp:zerops", name: "Zerops", iconUrl: "https://zerops.io/icon.svg" },
    };
    const toCore = makeToCore();
    toCore.step(call("running"), 0);
    assert.deepStrictEqual(closedCall(toCore.step(call("completed", presentation), 0)), {
      kind: "call",
      step: "mcp",
      tool: { name: "MCP tool call" },
      words: "MCP tool call",
      state: "done",
      endedAt: 0,
      presentation,
    });
  });

  it("streamed text goes live as it comes and settles when its item closes", () => {
    const toCore = makeToCore();
    toCore.step(upsert("h1.i1", "running"), 0);
    assert.deepStrictEqual(toCore.step(text("h1.i1", 0, "hi"), 0).live, [
      { _tag: "Append", key: "h1.i1", stream: "text", offset: 0, text: "hi" },
    ]);
    assert.deepStrictEqual(toCore.step(upsert("h1.i1", "completed"), 0).live, [
      { _tag: "Settle", key: "h1.i1" },
    ]);
  });

  it("a turn is said alive at most once a minute, however much it streams", () => {
    const toCore = makeToCore();
    toCore.step(upsert("h1.i1", "running"), 0);
    const alive = [0, 1_000, ACTIVITY_EVERY_MS - 1, ACTIVITY_EVERY_MS].map(
      (now, i) =>
        toCore.step(text("h1.i1", i, "x"), now).signals.filter((s) => s.kind === "activity").length,
    );
    assert.deepStrictEqual(alive, [1, 0, 0, 1]);
  });

  it.each([
    ["rotate", false],
    ["asked", false],
    ["idle", false],
    ["shutdown", false],
    ["stopped-turn", true],
    ["process-exit", true],
    ["open-failed", true],
    ["unknown", true],
  ] as const)(
    "a session closed for %s is an exit the engine did not ask for: %s",
    (cause, exit) => {
      const step = makeToCore().step(sig({ type: "session.closed", cause }), 0);
      assert.strictEqual(
        step.signals.some((signal) => signal.kind === "session-exited"),
        exit,
      );
      assert.deepStrictEqual(step.session?._tag, "Closed");
    },
  );

  it("a turn the agent opens itself reports on the run whose background work just ended", () => {
    const toCore = makeToCore();
    toCore.step(sig({ type: "turn.opened", turn: R1, origin: "engine" }), 0);
    toCore.step(
      sig({ type: "work.upsert", work: "s1.w1", origin: R1, kind: "shell", status: "running" }),
      0,
    );
    assert.strictEqual(toCore.liveWork(), 1);
    toCore.step(
      sig({ type: "work.upsert", work: "s1.w1", origin: R1, kind: "shell", status: "completed" }),
      0,
    );
    assert.strictEqual(toCore.liveWork(), 0);
    const self = toCore.step(sig({ type: "turn.opened", turn: "s1.self1", origin: "self" }), 0);
    assert.deepStrictEqual(stepLines(self), [`s1.self1 started by self, reports on ${R1}`]);
  });

  it.each([
    ["answered", "answered"],
    ["cancelled", "dismissed"],
    ["superseded", "lapsed"],
    ["expired", "lapsed"],
  ] as const)("a request the driver closes %s is %s", (how, state) => {
    const step = makeToCore().step(sig({ type: "request.closed", request: "s1.r1", how }), 0);
    assert.deepStrictEqual(stepLines(step), [`s1.r1 ${state}`]);
  });

  it.each([
    [
      "2026-10-07T05:00:00.000Z",
      "parks-turn",
      `usage limit on h1 until ${Date.parse("2026-10-07T05:00:00.000Z")}, parked`,
    ],
    ["unknown", "parks-turn", "usage limit on h1 until unknown, parked"],
    ["unknown", "between-turns", "usage limit on h1 until unknown"],
  ] as const)("a usage limit until %s that %s", (resetsAt, effect, line) => {
    const step = makeToCore().step(sig({ type: "usage.limit", effect, turn: H1, resetsAt }), 0);
    assert.deepStrictEqual(stepLines(step), [line]);
  });

  it("a send the driver refused, or took, is the evidence its send waits on", () => {
    const toCore = makeToCore();
    assert.deepStrictEqual(
      stepLines(
        toCore.step(sig({ type: "send.refused", turn: H1, words: "no", undelivered: true }), 0),
      ),
      ["h1 refused, undelivered: true"],
    );
    assert.deepStrictEqual(
      toCore.step(sig({ type: "send.accepted", turn: H1, as: "steered", into: R1 }), 0).evidence,
      [{ turn: H1, evidence: { _tag: "Accepted", as: "steered", into: R1 } }],
    );
  });
});
