// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * The driver bridge, pinned as sentences.
 *
 * Every case is marked:
 * - `recorded` — a real CLI capture (the four Claude recordings, the Codex capture);
 * - `mock` — a real, unchanged adapter driven by a mock peer or an authored wire
 *   (the ACP mock agent, Claude's createQuery seam, Codex's runtime seam, OpenCode's canned SSE);
 * - `scripted` — runtime events written by hand, in the order the adapter's code emits them
 *   (after `sendFailureHeard.test.ts`'s per-driver scripts), with the adapter line cited.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { SpiEvent } from "@t3tools/contracts";
import { assert, describe, it } from "vite-plus/test";

import type { BridgeDriver, RequestKey, SessionId, TurnHandle } from "./spi3.ts";
import { type BridgeInput, makeTranslator } from "./translate.ts";
import { crashOncePath, recordAcp, recordClaude, recordCodex } from "../testing/bridge/record.ts";
import { integrityBreach, signalLines, textOf } from "../testing/bridge/signals.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const fixturesRoot = NodePath.join(__dirname, "../../spi/fixtures");

const S1 = "s1" as SessionId;
const H1 = "h1" as TurnHandle;

const readGolden = (driver: string, name: string): ReadonlyArray<SpiEvent> =>
  JSON.parse(
    NodeFS.readFileSync(NodePath.join(fixturesRoot, driver, `${name}.expected.json`), "utf8"),
  ) as ReadonlyArray<SpiEvent>;

/**
 * The commands the engine would have sent around a golden: the session opens
 * before the first turn-bound event, one message is sent, and its send returns
 * where the driver's returns — once the turn opens, or at its end (ACP). Each
 * resolved request is answered just before the driver says so.
 */
function goldenLog(driver: BridgeDriver, events: ReadonlyArray<SpiEvent>): Array<BridgeInput> {
  const holdsTurn = driver === "cursor" || driver === "grok" || driver === "antigravity";
  const parent = String(events[0]!.threadId);
  const log: Array<BridgeInput> = [{ kind: "start", session: S1, from: "fresh" }];
  let opened = false;
  let firstTurn: string | undefined;
  let requests = 0;
  for (const event of events) {
    const turnBound =
      event.type === "turn.started" ||
      event.type === "content.delta" ||
      event.type.startsWith("item.");
    if (!opened && turnBound) {
      log.push({ kind: "started" }, { kind: "send", turn: H1, mode: "new" });
      opened = true;
    }
    if (event.type === "request.opened" || event.type === "user-input.requested") requests += 1;
    if (event.type === "request.resolved" || event.type === "user-input.resolved") {
      log.push({ kind: "respond", request: `${S1}.r${requests}` as RequestKey });
    }
    log.push({ kind: "event", event });
    if (
      event.type === "turn.started" &&
      firstTurn === undefined &&
      String(event.threadId) === parent
    ) {
      firstTurn = String(event.turnId);
      if (!holdsTurn) log.push({ kind: "sent", turn: H1, nativeTurn: firstTurn });
    }
  }
  if (holdsTurn && firstTurn !== undefined) {
    log.push({ kind: "sent", turn: H1, nativeTurn: firstTurn });
  }
  return log;
}

const run = (driver: BridgeDriver, threadId: string, inputs: ReadonlyArray<BridgeInput>) => {
  const translator = makeTranslator({ driver, threadId });
  const signals = inputs.flatMap((input) => translator.step(input));
  return { signals, dropped: translator.dropped() };
};

interface GoldenCase {
  readonly driver: BridgeDriver;
  readonly dir: string;
  readonly name: string;
  readonly mark: "recorded" | "mock" | "scripted";
  readonly title: string;
  readonly lines: ReadonlyArray<string>;
}

const OPENS_H1 = ["session s1 opened", "h1 opened by engine", "h1 accepted: opened"];

const goldenCases: ReadonlyArray<GoldenCase> = [
  {
    driver: "claudeAgent",
    dir: "claude",
    name: "plain-text-turn",
    mark: "recorded",
    title: "a reply in words is one text item, and the turn ends as the agent said",
    lines: [
      ...OPENS_H1,
      "h1.i1 text running",
      "h1.i1 text completed",
      "context usage ×2",
      "h1 ended completed (end_turn) — agent",
    ],
  },
  {
    driver: "claudeAgent",
    dir: "claude",
    name: "zerops-workflow-envelope",
    mark: "recorded",
    title: "each call is an item in the model response it was written in",
    lines: [
      ...OPENS_H1,
      "h1.i1 text running",
      "h1.i1 text completed",
      "h1.i2 tool dynamic_tool_call running, in h1.m1 ×3",
      "h1.i2 tool dynamic_tool_call completed, in h1.m1",
      "context usage",
      "h1.i3 tool mcp_tool_call running, in h1.m2 ×3",
      "context usage",
      "h1.i3 tool mcp_tool_call running, in h1.m2",
      "h1.i3 tool mcp_tool_call completed, in h1.m2",
      "h1.i4 tool mcp_tool_call running, in h1.m3 ×3",
      "context usage",
      "h1.i4 tool mcp_tool_call running, in h1.m3",
      "h1.i4 tool mcp_tool_call completed, in h1.m3",
      "h1.i5 text running",
      "h1.i5 text completed",
      "context usage ×2",
      "h1 ended completed (end_turn) — agent",
    ],
  },
  {
    driver: "claudeAgent",
    dir: "claude",
    name: "user-input-requested",
    mark: "recorded",
    title: "a question opens in its turn and closes answered",
    lines: [
      ...OPENS_H1,
      "h1.i1 tool dynamic_tool_call running, in h1.m1 ×2",
      "s1.r1 asks: question in h1",
      "s1.r1 closed: answered",
      "context usage",
      "h1.i1 tool dynamic_tool_call running, in h1.m1",
      "h1.i1 tool dynamic_tool_call completed, in h1.m1",
      "h1.i2 text running",
      "h1.i2 text completed",
      "context usage ×2",
      "h1 ended completed (end_turn) — agent",
    ],
  },
  {
    driver: "claudeAgent",
    dir: "claude",
    name: "turn-abort-error",
    mark: "recorded",
    title:
      "the SDK's own abort ends the turn interrupted by the agent, its open call unreturned, and keeps the session",
    lines: [
      ...OPENS_H1,
      "h1.i1 text running",
      "h1.i1 text completed",
      "h1.i2 tool dynamic_tool_call running, in h1.m1",
      "h1.i2 tool dynamic_tool_call unreturned, in h1.m1",
      "context usage",
      "h1 ended interrupted — agent",
    ],
  },
  {
    driver: "claudeAgent",
    dir: "claude",
    name: "crew-hooks",
    mark: "scripted",
    title: "a crew turn's failed command stays failed and the turn completes",
    lines: [
      ...OPENS_H1,
      "h1.i1 tool command_execution running, in h1.m1 ×2",
      "context usage",
      "h1.i1 tool command_execution running, in h1.m1",
      "h1.i1 tool command_execution completed, in h1.m1",
      "h1.i2 tool command_execution running, in h1.m2 ×2",
      "context usage",
      "h1.i2 tool command_execution failed, in h1.m2 ×2",
      "h1.i3 text running",
      "h1.i3 text completed",
      "context usage ×2",
      "h1 ended completed (end_turn) — agent",
    ],
  },
  {
    driver: "codex",
    dir: "codex",
    name: "multi-agent-wire",
    mark: "recorded",
    title:
      "the parent turn spawns a helper and does not end inside the capture; child threads are not the session's",
    lines: [
      ...OPENS_H1,
      "context usage ×2",
      "h1.i1 tool collab_agent_tool_call running",
      "h1.i1 tool collab_agent_tool_call completed",
      "context usage",
    ],
  },
  ...(["cursor", "grok", "antigravity"] as const).map((driver): GoldenCase => ({
    driver,
    dir: driver,
    name: "hello-baseline",
    mark: "mock",
    title: "a hello is a plan, one text item and an end the agent gave",
    lines: [
      ...OPENS_H1,
      "h1 plan",
      "h1.i1 text running",
      "h1.i1 text completed",
      "h1 ended completed (end_turn) — agent",
    ],
  })),
  {
    driver: "cursor",
    dir: "cursor",
    name: "mcp-calls",
    mark: "mock",
    title: "calls that never say they started are items from their first update",
    lines: [
      ...OPENS_H1,
      "h1.i1 tool dynamic_tool_call running",
      "h1.i1 tool dynamic_tool_call completed",
      "h1.i2 tool command_execution running",
      "h1.i2 tool command_execution completed",
      "h1.i3 text running",
      "h1.i3 text completed",
      "h1 ended completed (end_turn) — agent",
    ],
  },
  {
    driver: "opencode",
    dir: "opencode",
    name: "hello-baseline",
    mark: "mock",
    title: "a stream that never opens a turn gives no items and no accepted send",
    lines: ["session s1 opened"],
  },
];

describe("the bridge over every SPI golden", () => {
  for (const golden of goldenCases) {
    it(`${golden.driver}/${golden.name} [${golden.mark}]: ${golden.title}`, () => {
      const events = readGolden(golden.dir, golden.name);
      const { signals } = run(
        golden.driver,
        String(events[0]!.threadId),
        goldenLog(golden.driver, events),
      );
      assert.isUndefined(integrityBreach(signals));
      assert.deepStrictEqual(signalLines(signals), golden.lines);
    });
  }

  it("claudeAgent/plain-text-turn [recorded]: the text item carries every word the agent streamed, in order", () => {
    const events = readGolden("claude", "plain-text-turn");
    const { signals } = run(
      "claudeAgent",
      String(events[0]!.threadId),
      goldenLog("claudeAgent", events),
    );
    const streamed = events
      .flatMap((event) => (event.type === "content.delta" ? [event.payload.delta] : []))
      .join("");
    assert.isAbove(streamed.length, 0);
    assert.strictEqual(textOf(signals, "h1.i1"), streamed);
  });

  it("codex/multi-agent-wire [recorded]: the child threads' turns are left out, not ended", () => {
    const events = readGolden("codex", "multi-agent-wire");
    const { dropped } = run("codex", String(events[0]!.threadId), goldenLog("codex", events));
    assert.deepStrictEqual(
      dropped.filter((input) => input.type.startsWith("turn.")).map((input) => input.reason),
      ["other-thread", "other-thread", "other-thread"],
    );
  });

  it("opencode/hello-baseline [mock]: text with no turn is dropped, never attached to a guess", () => {
    const events = readGolden("opencode", "hello-baseline");
    const { dropped } = run("opencode", String(events[0]!.threadId), goldenLog("opencode", events));
    assert.deepStrictEqual(
      dropped.map((input) => `${input.reason} ${input.type}`),
      ["no-turn content.delta", "no-turn content.delta", "no-turn item.completed"],
    );
  });
});

// ── scripted: each driver's own order, from its adapter's code ─────────

const THREAD = "thread-1";
const NOW = "2026-10-07T00:00:00.000Z";
const RESETS = "2026-10-07T05:00:00.000Z";
const H2 = "h2" as TurnHandle;
const S2 = "s2" as SessionId;
const DRIVERS: ReadonlyArray<BridgeDriver> = [
  "claudeAgent",
  "codex",
  "opencode",
  "cursor",
  "grok",
  "antigravity",
];
const NAMES: Record<BridgeDriver, string> = {
  claudeAgent: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  cursor: "Cursor",
  grok: "Grok",
  antigravity: "Antigravity",
};

/** Cursor, Grok and Antigravity hold the whole turn in their send: it returns at the turn's end. */
const holdsTurn = (driver: BridgeDriver) =>
  driver === "cursor" || driver === "grok" || driver === "antigravity";

/** A driver's events and the engine's commands, written in the order its adapter emits them. */
function wire(driver: BridgeDriver) {
  let count = 0;
  const event = (type: string, fields: Record<string, unknown> = {}): BridgeInput => {
    count += 1;
    return {
      kind: "event",
      event: {
        type,
        eventId: `e${count}`,
        provider: driver,
        threadId: THREAD,
        createdAt: NOW,
        payload: {},
        ...fields,
      } as unknown as SpiEvent,
    };
  };
  const tool = (
    turnId: string,
    itemId: string,
    phase: "started" | "updated" | "completed",
    extra = {},
  ) =>
    event(`item.${phase}`, {
      turnId,
      itemId,
      payload: {
        itemType: "command_execution",
        status: phase === "completed" ? "completed" : "inProgress",
        title: "Command run",
        ...extra,
      },
    });
  return {
    event,
    open: (
      session = S1,
      from: "fresh" | "resume" = "fresh",
      resume?: unknown,
    ): Array<BridgeInput> => [
      { kind: "start", session, from },
      event("session.started"),
      { kind: "started", ...(resume === undefined ? {} : { resume }) },
    ],
    /** The engine sends; the driver opens its turn, and returns from the send now or at the end. */
    begin: (
      turn: TurnHandle,
      native: string,
      mode: "new" | "steer" | "continue" = "new",
    ): Array<BridgeInput> => [
      { kind: "send", turn, mode },
      event("turn.started", { turnId: native }),
      ...(holdsTurn(driver) ? [] : [{ kind: "sent", turn, nativeTurn: native } as const]),
    ],
    /** Where a send that holds the turn returns. */
    returns: (turn: TurnHandle, native: string): Array<BridgeInput> =>
      holdsTurn(driver) ? [{ kind: "sent", turn, nativeTurn: native }] : [],
    /** A call starting: ACP calls never say they started, their first sign is an update. */
    callStarts: (turnId: string, itemId: string) =>
      tool(turnId, itemId, holdsTurn(driver) ? "updated" : "started"),
    tool,
    text: (turnId: string | undefined, itemId: string, delta: string) =>
      event("content.delta", {
        ...(turnId === undefined ? {} : { turnId }),
        itemId,
        payload: { streamKind: "assistant_text", delta },
      }),
    completed: (turnId: string, payload: Record<string, unknown> = { state: "completed" }) =>
      event("turn.completed", { turnId, payload }),
    aborted: (turnId: string) =>
      event("turn.aborted", { turnId, payload: { reason: "Interrupted by user." } }),
    said: (turnId: string, message: string, errorClass: string) =>
      event("runtime.error", { turnId, payload: { message, class: errorClass } }),
    exited: (exitKind?: "graceful" | "error") =>
      event("session.exited", { payload: exitKind === undefined ? {} : { exitKind } }),
    task: (type: string, payload: Record<string, unknown>, turnId?: string) =>
      event(type, { ...(turnId === undefined ? {} : { turnId }), payload }),
    blocked: () =>
      event("account.rate-limits.updated", {
        payload: { limits: { windows: [] }, blocked: { window: "five_hour", resetsAt: RESETS } },
      }),
    interrupt: (turn: TurnHandle): BridgeInput => ({ kind: "interrupt", turn }),
    sendFailed: (turn: TurnHandle, words: string, sessionGone = false): BridgeInput => ({
      kind: "send-failed",
      turn,
      words,
      sessionGone,
    }),
  };
}

interface ScriptCase {
  readonly title: string;
  readonly inputs: ReadonlyArray<BridgeInput>;
  readonly lines: ReadonlyArray<string>;
}

const CALL_RUNS = [...OPENS_H1, "h1.i1 tool command_execution running"];

/** Stop during a tool call (SFH's makeStopRun; the mock agent's EMIT_ACTIVE_TOOL_THEN_HANG). */
function stopMidTool(driver: BridgeDriver): ScriptCase {
  const w = wire(driver);
  const before = [...w.open(), ...w.begin(H1, "X1"), w.callStarts("X1", "call-1"), w.interrupt(H1)];
  switch (driver) {
    case "claudeAgent":
      return {
        title:
          "Stop kills the CLI: the turn ends interrupted without the agent confirming, and the session closes with it",
        // CA:5792-5799 → stopSessionInternal: CA:4751 "Session stopped.", CA:4773 exited graceful
        inputs: [
          ...before,
          w.completed("X1", { state: "interrupted", errorMessage: "Session stopped." }),
          w.exited("graceful"),
        ],
        lines: [
          ...CALL_RUNS,
          "h1.i1 tool command_execution unreturned",
          "h1 ended interrupted — stop-asked",
          "session s1 closed: stopped-turn",
        ],
      };
    case "codex":
      return {
        title: "Stop is turn/interrupt: the agent confirms it, the session stays",
        inputs: [...before, w.completed("X1", { state: "interrupted" })],
        lines: [
          ...CALL_RUNS,
          "h1.i1 tool command_execution unreturned",
          "h1 ended interrupted — stop-confirmed",
        ],
      };
    case "opencode":
      return {
        title: "Stop is session.abort: the agent's abort confirms it, the session stays",
        // OC:2604 MessageAbortedError → turn.aborted (OC:1505-1522)
        inputs: [...before, w.aborted("X1")],
        lines: [
          ...CALL_RUNS,
          "h1.i1 tool command_execution unreturned",
          "h1 ended interrupted — stop-confirmed",
        ],
      };
    case "cursor":
      return {
        title:
          "Stop is a local cancel the agent never confirms; what it says after arrives late and never reopens the turn",
        // ASR:968-977, ASR:1052-1064 synthetic cancelled; CU:804/1014 the stale turn id after it
        inputs: [
          ...before,
          w.completed("X1", { state: "cancelled", stopReason: "cancelled" }),
          ...w.returns(H1, "X1"),
          w.text("X1", "late-text", "still going"),
        ],
        lines: [
          ...CALL_RUNS,
          "h1.i1 tool command_execution unreturned",
          "h1 ended interrupted — stop-asked",
          "h1.i2 text running, after end",
        ],
      };
    case "grok":
      return {
        title: "Stop is the adapter's own end, never the agent's",
        // GR:2106-2170: marks interrupted, cancels, emits turn.completed(cancelled) itself
        inputs: [...before, w.completed("X1", { state: "cancelled" }), ...w.returns(H1, "X1")],
        lines: [
          ...CALL_RUNS,
          "h1.i1 tool command_execution unreturned",
          "h1 ended interrupted — stop-asked",
        ],
      };
    case "antigravity":
      return {
        title: "Stop waits for the agent's answer to the cancel: confirmed",
        // AntigravityAcpSupport.ts:70 cancelBehavior wait-for-prompt
        inputs: [
          ...before,
          w.completed("X1", { state: "cancelled", stopReason: "cancelled" }),
          ...w.returns(H1, "X1"),
        ],
        lines: [
          ...CALL_RUNS,
          "h1.i1 tool command_execution unreturned",
          "h1 ended interrupted — stop-confirmed",
        ],
      };
  }
}

/** The agent's process dies mid-turn (SFH's scriptFor "crash"; the mock agent's CRASH_ONCE_PATH). */
function crashMidTurn(driver: BridgeDriver): ScriptCase {
  const w = wire(driver);
  const words = `${NAMES[driver]} stopped unexpectedly.`;
  const before = [...w.open(), ...w.begin(H1, "X1"), w.callStarts("X1", "call-1")];
  const cut = [...CALL_RUNS, "h1.i1 tool command_execution unreturned"];
  switch (driver) {
    case "claudeAgent":
      return {
        title:
          "the adapter ends the turn cut by the process exit itself, and its helper's work is lost with the session",
        // CA:4609-4669: runtime.error(process_exit), turn.completed(failed), session.exited reading graceful
        inputs: [
          ...w.open(),
          ...w.begin(H1, "X1"),
          w.task(
            "task.started",
            { taskId: "t1", taskType: "local_agent", description: "Read the schema" },
            "X1",
          ),
          w.callStarts("X1", "call-1"),
          w.said("X1", words, "process_exit"),
          w.completed("X1", { state: "failed", errorMessage: words }),
          w.exited("graceful"),
        ],
        lines: [
          ...OPENS_H1,
          "s1.w1 helper running, from h1",
          "h1.i1 tool command_execution running",
          "notice error process_exit",
          "h1.i1 tool command_execution unreturned",
          "h1 ended cut: process-exit — agent",
          "s1.w1 helper lost, from h1",
          "session s1 closed: process-exit",
        ],
      };
    case "codex":
      return {
        title: "an app-server exit ends nothing, so the bridge ends the turn cut by the crash",
        // CSR:2538-2556, CX:1050-1054: session.exited only
        inputs: [...before, w.exited()],
        lines: [
          ...cut,
          "h1 ended cut: process-exit — inferred-from-crash",
          "session s1 closed: process-exit",
        ],
      };
    case "opencode":
      return {
        title: "a server exit ends nothing, so the bridge ends the turn cut by the crash",
        // OC:1555-1580: runtime.error(process_exit), session.exited(error)
        inputs: [...before, w.said("X1", words, "process_exit"), w.exited("error")],
        lines: [
          ...CALL_RUNS,
          "notice error process_exit",
          "h1.i1 tool command_execution unreturned",
          "h1 ended cut: process-exit — inferred-from-crash",
          "session s1 closed: process-exit",
        ],
      };
    case "cursor":
    case "grok":
      return {
        title: "the failing prompt ends the turn cut by the process exit, as the adapter says",
        // CU:1177-1206: turn.completed(failed, process_exit) before the send fails
        inputs: [
          ...before,
          w.completed("X1", {
            state: "failed",
            errorMessage: words,
            terminalReason: "process_exit",
          }),
          w.exited("error"),
          w.sendFailed(H1, words),
        ],
        lines: [...cut, "h1 ended cut: process-exit — agent", "session s1 closed: process-exit"],
      };
    case "antigravity":
      return {
        title:
          "the connection's end stops the session before the prompt fails, so the bridge ends the turn",
        // AG:440-462, AG:1011: session.exited(error), then finishTurn returns early
        inputs: [...before, w.exited("error"), w.sendFailed(H1, words)],
        lines: [
          ...cut,
          "h1 ended cut: process-exit — inferred-from-crash",
          "session s1 closed: process-exit",
        ],
      };
  }
}

/** The host shuts down mid-turn, boots, and resumes the session (two folds: the first dies with the host). */
function restartMidTurn(driver: BridgeDriver): { before: ScriptCase; after: ScriptCase } {
  const w = wire(driver);
  const shutdown: Array<BridgeInput> = [
    ...w.open(),
    ...w.begin(H1, "X1"),
    w.callStarts("X1", "call-1"),
    { kind: "stop", cause: "shutdown" },
    // runStopAll (PS:1484-1530) stops the session; Claude's stopSessionInternal says so first.
    ...(driver === "claudeAgent"
      ? [
          w.completed("X1", { state: "interrupted", errorMessage: "Session stopped." }),
          w.exited("graceful"),
        ]
      : [{ kind: "stopped" } as const]),
    ...(holdsTurn(driver) ? [w.sendFailed(H1, "Session stopped.")] : []),
  ];
  const resumed = wire(driver);
  const boot: Array<BridgeInput> = [
    ...resumed.open(S2, "resume", { sessionId: "native-1" }),
    // A resume replays nothing as a turn: Claude's init and its empty result (CA:2862-2884) end nothing.
    resumed.event("session.configured", { payload: { config: {} } }),
    resumed.event("thread.started", { payload: { providerThreadId: "native-1" } }),
    ...resumed.begin(H2, "X2", "continue"),
    resumed.completed("X2"),
    ...resumed.returns(H2, "X2"),
  ];
  return {
    before: {
      title: "a shutdown mid-turn ends the turn cut by the close and closes the session",
      inputs: shutdown,
      lines: [
        ...CALL_RUNS,
        "h1.i1 tool command_execution unreturned",
        "h1 ended cut: session-closed — inferred-from-close",
        "session s1 closed: shutdown",
      ],
    },
    after: {
      title:
        "after boot the resumed session opens no turn and no item until the continuation is sent",
      inputs: boot,
      lines: [
        "session s2 opened, resumed",
        "h2 opened by engine",
        "h2 accepted: opened",
        "h2 ended completed — agent",
      ],
    },
  };
}

/** A message sent while a turn runs (SFH's steer scripts). */
function steer(driver: BridgeDriver): ScriptCase {
  const w = wire(driver);
  const first = [...w.open(), ...w.begin(H1, "X1"), w.text("X1", "text-1", "Looking.")];
  const opening = [...OPENS_H1, "h1.i1 text running"];
  switch (driver) {
    case "claudeAgent":
    case "opencode":
      return {
        title: "it joins the running turn: one turn, one end",
        // CA:5602-5611 the SDK's input queue; OC:3187-3190 the running session's prompt queue
        inputs: [
          ...first,
          { kind: "send", turn: H2, mode: "steer" },
          { kind: "sent", turn: H2, nativeTurn: "X1" },
          w.completed("X1"),
        ],
        lines: [
          ...opening,
          "h2 accepted: steered into h1",
          "h1.i1 text completed",
          "h1 ended completed — agent",
        ],
      };
    case "codex":
      return {
        title: "Codex queues it as a turn of its own, which opens when the running one ends",
        // CSR:2665-2671: a mid-turn turn/start gets its own queued id
        inputs: [
          ...first,
          { kind: "send", turn: H2, mode: "steer" },
          { kind: "sent", turn: H2, nativeTurn: "X2" },
          w.completed("X1"),
          w.event("turn.started", { turnId: "X2" }),
          w.completed("X2"),
        ],
        lines: [
          ...opening,
          "h2 accepted: queued into h1",
          "h1.i1 text completed",
          "h1 ended completed — agent",
          "h2 opened by engine",
          "h2 ended completed — agent",
        ],
      };
    default:
      return {
        title:
          "the send waits behind the running turn's lane and opens a turn of its own at its end",
        // CU:1109, GR:1858, AG:1133 await the whole prompt; PS:913-944 holds the lane
        inputs: [
          ...first,
          { kind: "send", turn: H2, mode: "steer" },
          w.completed("X1"),
          ...w.returns(H1, "X1"),
          w.event("turn.started", { turnId: "X2" }),
          w.completed("X2"),
          ...w.returns(H2, "X2"),
        ],
        lines: [
          ...opening,
          "h1.i1 text completed",
          "h1 ended completed — agent",
          "h2 opened by engine",
          "h2 accepted: opened",
          "h2 ended completed — agent",
        ],
      };
  }
}

/** Background work that outlives its turn. */
function backgroundOutlivesTurn(driver: BridgeDriver): ScriptCase {
  const w = wire(driver);
  const opened = [...w.open(), ...w.begin(H1, "X1")];
  switch (driver) {
    case "claudeAgent":
      return {
        title:
          "a helper's call outlives the turn, its end is reported, and its result wakes the agent into a turn of its own",
        inputs: [
          ...opened,
          w.task(
            "task.started",
            {
              taskId: "t1",
              toolUseId: "agent-call",
              taskType: "local_agent",
              description: "Read the schema",
            },
            "X1",
          ),
          w.tool("X1", "helper-call", "started", { agentId: "t1" }),
          w.completed("X1"),
          w.tool("X1", "helper-call", "completed", { agentId: "t1" }),
          w.task("task.completed", { taskId: "t1", status: "completed", taskType: "local_agent" }),
          // CA:3636-3694: an assistant message with no open turn opens one, marked synthetic
          w.event("turn.started", {
            turnId: "X3",
            raw: {
              source: "claude.sdk.message",
              method: "claude/synthetic-turn-start",
              payload: {},
            },
          }),
          w.text("X3", "wake-text", "The schema has two tables without a key."),
          w.completed("X3"),
        ],
        lines: [
          ...OPENS_H1,
          "s1.w1 helper running, from h1",
          "h1.i1 tool command_execution running, for s1.w1",
          "h1 ended completed — agent",
          "h1.i1 tool command_execution completed, after end, for s1.w1",
          "s1.w1 helper completed, from h1",
          "s1.self1 opened by self",
          "s1.self1.i1 text running",
          "s1.self1.i1 text completed",
          "s1.self1 ended completed — agent",
        ],
      };
    case "codex":
      return {
        title: "a child agent is reported but never ends; its session's close loses it",
        // CX:641-851: task.started/updated/progress, no task.completed
        inputs: [
          ...opened,
          w.task(
            "task.started",
            { taskId: "child-1", taskType: "subagent", description: "marlow" },
            "X1",
          ),
          w.completed("X1"),
          w.task("task.updated", { taskId: "child-1", status: "idle" }),
          { kind: "stop", cause: "idle" },
          w.exited("graceful"),
        ],
        lines: [
          ...OPENS_H1,
          "s1.w1 helper running, from h1",
          "h1 ended completed — agent",
          "s1.w1 helper idle, from h1",
          "s1.w1 helper lost, from h1",
          "session s1 closed: idle",
        ],
      };
    case "grok":
      return {
        title: "a background shell seen through a tool result ends when its result is seen",
        // XBT:61-150: task.* from tool results; XBT:79 a turn only when it began in the current one
        inputs: [
          ...opened,
          w.task(
            "task.started",
            { taskId: "bg-1", taskType: "local_bash", description: "npm run dev" },
            "X1",
          ),
          w.completed("X1"),
          ...w.returns(H1, "X1"),
          w.task("task.completed", { taskId: "bg-1", status: "completed", taskType: "local_bash" }),
        ],
        lines: [
          ...OPENS_H1,
          "s1.w1 shell running, from h1",
          "h1 ended completed — agent",
          "s1.w1 shell completed, from h1",
        ],
      };
    case "antigravity":
      return {
        title:
          "a command still open at the turn's end is promoted to work, and stops with the session",
        // AG:963 promotes at the end; they finish as stopped when the session stops
        inputs: [
          ...opened,
          w.task(
            "task.started",
            { taskId: "cmd-1", taskType: "local_bash", description: "tail -f log" },
            "X1",
          ),
          w.completed("X1"),
          ...w.returns(H1, "X1"),
          { kind: "stop", cause: "asked" },
          w.task("task.completed", { taskId: "cmd-1", status: "stopped", taskType: "local_bash" }),
          w.exited("graceful"),
        ],
        lines: [
          ...OPENS_H1,
          "s1.w1 shell running, from h1",
          "h1 ended completed — agent",
          "s1.w1 shell stopped, from h1",
          "session s1 closed: asked",
        ],
      };
    default:
      return {
        title: "nothing is reported, so no background work is ever claimed",
        inputs: [...opened, w.completed("X1"), ...w.returns(H1, "X1")],
        lines: [...OPENS_H1, "h1 ended completed — agent"],
      };
  }
}

/** A usage limit mid-turn (SFH's scriptFor "usage-limit"). */
function usageLimit(driver: BridgeDriver): ScriptCase {
  const w = wire(driver);
  const opened = [...w.open(), ...w.begin(H1, "X1")];
  const limit = `${NAMES[driver]} usage limit reached.`;
  switch (driver) {
    case "claudeAgent":
      return {
        title:
          "a refused window parks the turn with no end; the engine's Stop then ends it and closes the session",
        // CA:4427-4456: account.rate-limits.updated{blocked}, a warning, and no result
        inputs: [
          ...opened,
          w.blocked(),
          w.event("runtime.warning", { turnId: "X1", payload: { message: limit } }),
          w.blocked(),
          w.interrupt(H1),
          w.completed("X1", { state: "interrupted", errorMessage: "Session stopped." }),
          w.exited("graceful"),
        ],
        lines: [
          ...OPENS_H1,
          `usage limit parks-turn h1 until ${RESETS}`,
          "notice warning",
          "h1 ended interrupted — stop-asked",
          "session s1 closed: stopped-turn",
        ],
      };
    case "codex":
    case "opencode":
      return {
        title: "the limit ends the turn, typed, with no time it lifts",
        // CX:1920-1945; OC:2601-2666 a 429
        inputs: [
          ...opened,
          w.said("X1", limit, "usage_limit"),
          w.completed("X1", {
            state: "failed",
            errorMessage: limit,
            terminalReason: "usage_limit",
          }),
        ],
        lines: [
          ...OPENS_H1,
          "notice error usage_limit",
          "h1 ended usage-limited until unknown — agent",
        ],
      };
    case "grok":
      return {
        title: "the rate limit ends the turn, typed, with no time it lifts",
        // XAiAcpExtension.ts:592
        inputs: [
          ...opened,
          w.completed("X1", {
            state: "failed",
            errorMessage: limit,
            terminalReason: "usage_limit",
          }),
          w.sendFailed(H1, limit),
        ],
        lines: [...OPENS_H1, "h1 ended usage-limited until unknown — agent"],
      };
    default:
      return {
        title: "the limit is an ordinary failure of unknown class: its protocol cannot type it",
        // SFH:212-221
        inputs: [
          ...opened,
          w.completed("X1", { state: "failed", errorMessage: limit }),
          w.sendFailed(H1, limit),
        ],
        lines: [...OPENS_H1, "h1 ended failed: unknown — agent"],
      };
  }
}

const runScript = (driver: BridgeDriver, inputs: ReadonlyArray<BridgeInput>) => {
  const { signals } = run(driver, THREAD, inputs);
  assert.isUndefined(integrityBreach(signals));
  return signalLines(signals);
};

const SCENARIOS = [
  ["Stop during a tool call", stopMidTool],
  ["a crash mid-turn", crashMidTurn],
  ["a message sent mid-turn", steer],
  ["background work outliving its turn", backgroundOutlivesTurn],
  ["a usage limit mid-turn", usageLimit],
] as const;

for (const [scenario, make] of SCENARIOS) {
  describe(scenario, () => {
    for (const driver of DRIVERS) {
      const script = make(driver);
      it(`${driver} [scripted]: ${script.title}`, () => {
        assert.deepStrictEqual(runScript(driver, script.inputs), script.lines);
      });
    }
  });
}

describe("a restart mid-turn", () => {
  for (const driver of DRIVERS) {
    const { before, after } = restartMidTurn(driver);
    it(`${driver} [scripted]: ${before.title}`, () => {
      assert.deepStrictEqual(runScript(driver, before.inputs), before.lines);
    });
    it(`${driver} [scripted]: ${after.title}`, () => {
      assert.deepStrictEqual(runScript(driver, after.inputs), after.lines);
    });
  }
});

describe("the fold's rules", () => {
  it("codex [scripted]: a send's return and its turn's start give the same signals in either order", () => {
    const w = wire("codex");
    const startsFirst = [
      ...w.open(),
      { kind: "send", turn: H1, mode: "new" } as const,
      w.event("turn.started", { turnId: "X1" }),
      { kind: "sent", turn: H1, nativeTurn: "X1" } as const,
      w.completed("X1"),
    ];
    const returnsFirst = [
      startsFirst[0]!,
      startsFirst[1]!,
      startsFirst[2]!,
      startsFirst[3]!,
      startsFirst[5]!,
      startsFirst[4]!,
      startsFirst[6]!,
    ];
    assert.deepStrictEqual(
      run("codex", THREAD, returnsFirst).signals,
      run("codex", THREAD, startsFirst).signals,
    );
    assert.deepStrictEqual(runScript("codex", returnsFirst), [
      ...OPENS_H1,
      "h1 ended completed — agent",
    ]);
  });

  it("grok [scripted]: a turn ends once; a second end for it is dropped", () => {
    const w = wire("grok");
    const lines = runScript("grok", [
      ...w.open(),
      ...w.begin(H1, "X1"),
      w.interrupt(H1),
      w.completed("X1", { state: "cancelled" }),
      w.completed("X1", { state: "completed" }),
      ...w.returns(H1, "X1"),
    ]);
    assert.deepStrictEqual(lines, [...OPENS_H1, "h1 ended interrupted — stop-asked"]);
  });

  it("codex [scripted]: a Stop that arrives after the turn ended changes nothing", () => {
    const w = wire("codex");
    const lines = runScript("codex", [
      ...w.open(),
      ...w.begin(H1, "X1"),
      w.completed("X1"),
      w.interrupt(H1),
      ...w.begin(H2, "X2"),
      w.completed("X2"),
    ]);
    assert.deepStrictEqual(lines, [
      ...OPENS_H1,
      "h1 ended completed — agent",
      "h2 opened by engine",
      "h2 accepted: opened",
      "h2 ended completed — agent",
    ]);
  });

  it("claudeAgent [scripted]: a message that met a shut prompt queue after its turn opened ends undelivered", () => {
    // CA:5754 turn.started goes out first, CA:5775-5780 the send then fails SessionClosed
    const w = wire("claudeAgent");
    const lines = runScript("claudeAgent", [
      ...w.open(),
      { kind: "send", turn: H1, mode: "new" },
      w.event("turn.started", { turnId: "X1" }),
      w.sendFailed(H1, "The session closed.", true),
    ]);
    assert.deepStrictEqual(lines, [...OPENS_H1, "h1 ended undelivered — inferred-from-crash"]);
  });

  it("a send that fails before any turn opens is refused: safe to resend on Claude, unknown elsewhere", () => {
    const refused = (driver: BridgeDriver, sessionGone: boolean) => {
      const w = wire(driver);
      return runScript(driver, [
        ...w.open(),
        { kind: "send", turn: H1, mode: "new" },
        w.sendFailed(H1, "The session closed.", sessionGone),
      ]);
    };
    assert.deepStrictEqual(refused("claudeAgent", true), [
      "session s1 opened",
      "h1 refused, undelivered: true",
    ]);
    assert.deepStrictEqual(refused("codex", true), [
      "session s1 opened",
      "h1 refused, undelivered: unknown",
    ]);
    assert.deepStrictEqual(refused("cursor", false), [
      "session s1 opened",
      "h1 refused, undelivered: true",
    ]);
  });

  it("codex [scripted]: a session the engine never opened is flagged as the host's own recovery", () => {
    const w = wire("codex");
    const lines = runScript("codex", [
      ...w.open(),
      { kind: "stop", cause: "idle" },
      { kind: "stopped" },
      // ProviderService.sendTurn's allowRecovery re-creates it (PS:921)
      w.event("session.started"),
    ]);
    assert.deepStrictEqual(lines, [
      "session s1 opened",
      "session s1 closed: idle",
      "session thread-1.implicit1 opened, on its own",
    ]);
  });

  it("codex [scripted]: a request closes answered or cancelled as decided, superseded at its turn's end, expired at its session's close", () => {
    const w = wire("codex");
    const approval = (turnId: string, requestId: string) =>
      w.event("request.opened", {
        turnId,
        requestId,
        payload: { requestType: "command_execution_approval", detail: "rm -rf dist" },
      });
    const resolved = (requestId: string, decision: string) =>
      w.event("request.resolved", {
        requestId,
        payload: { requestType: "command_execution_approval", decision },
      });
    const lines = runScript("codex", [
      ...w.open(),
      ...w.begin(H1, "X1"),
      approval("X1", "req-a"),
      { kind: "respond", request: "s1.r1" as RequestKey },
      resolved("req-a", "accept"),
      approval("X1", "req-b"),
      resolved("req-b", "cancel"),
      approval("X1", "req-c"),
      w.completed("X1"),
      w.event("request.opened", {
        requestId: "req-d",
        payload: { requestType: "permission_approval" },
      }),
      w.exited(),
    ]);
    assert.deepStrictEqual(lines, [
      ...OPENS_H1,
      "s1.r1 asks: approval in h1",
      "s1.r1 closed: answered",
      "s1.r2 asks: approval in h1",
      "s1.r2 closed: cancelled",
      "s1.r3 asks: approval in h1",
      "s1.r3 closed: superseded",
      "h1 ended completed — agent",
      "s1.r4 asks: approval",
      "s1.r4 closed: expired",
      "session s1 closed: process-exit",
    ]);
  });

  it("codex [scripted]: the host reaches a turn and an open request by the driver's own ids, a closed request by none", () => {
    const w = wire("codex");
    const translator = makeTranslator({ driver: "codex", threadId: THREAD });
    for (const input of [
      ...w.open(),
      ...w.begin(H1, "X1"),
      w.event("request.opened", {
        turnId: "X1",
        requestId: "req-a",
        payload: { requestType: "command_execution_approval" },
      }),
      w.event("user-input.requested", {
        turnId: "X1",
        requestId: "req-b",
        payload: { questions: [] },
      }),
    ]) {
      translator.step(input);
    }
    assert.strictEqual(translator.nativeTurn(H1), "X1");
    assert.isUndefined(translator.nativeTurn(H2));
    assert.deepStrictEqual(translator.nativeRequest("s1.r1" as RequestKey), {
      id: "req-a",
      kind: "approval",
    });
    assert.deepStrictEqual(translator.nativeRequest("s1.r2" as RequestKey), {
      id: "req-b",
      kind: "question",
    });
    translator.step(
      w.event("request.resolved", {
        requestId: "req-a",
        payload: { requestType: "command_execution_approval", decision: "accept" },
      }),
    );
    assert.isUndefined(translator.nativeRequest("s1.r1" as RequestKey));
  });

  it("antigravity [scripted]: a question it asks takes no typed answer", () => {
    const w = wire("antigravity");
    const { signals } = run("antigravity", THREAD, [
      ...w.open(),
      ...w.begin(H1, "X1"),
      w.event("user-input.requested", {
        turnId: "X1",
        requestId: "q-1",
        payload: {
          questions: [
            {
              id: "q",
              header: "Pick",
              question: "Which?",
              options: [{ label: "A", description: "" }],
            },
          ],
        },
      }),
    ]);
    const opened = signals.find((signal) => signal.type === "request.opened");
    assert.deepStrictEqual(
      opened?.type === "request.opened"
        ? opened.ask.kind === "question" && opened.ask.freeText
        : undefined,
      false,
    );
  });

  it("a compaction is the host's when it asked, the agent's own where reported, unknown on ACP", () => {
    const compacted = (driver: BridgeDriver, asked: boolean) => {
      const w = wire(driver);
      return runScript(driver, [
        ...w.open(),
        ...(asked ? [{ kind: "compact", turn: H1 } as const] : []),
        w.event("thread.state.changed", {
          payload: { state: "compacted", beforeTokens: 9000, afterTokens: 1200 },
        }),
      ]);
    };
    assert.deepStrictEqual(compacted("claudeAgent", true), [
      "session s1 opened",
      "compacted, automatic: false",
    ]);
    assert.deepStrictEqual(compacted("codex", false), [
      "session s1 opened",
      "compacted, automatic: true",
    ]);
    assert.deepStrictEqual(compacted("cursor", false), [
      "session s1 opened",
      "compacted, automatic: unknown",
    ]);
  });

  it("claudeAgent [scripted]: a refused window between turns is a limit with no turn to park", () => {
    const w = wire("claudeAgent");
    assert.deepStrictEqual(runScript("claudeAgent", [...w.open(), w.blocked()]), [
      "session s1 opened",
      `usage limit between-turns until ${RESETS}`,
    ]);
  });

  it("claudeAgent [scripted]: a usage-limit result after a refused window ends the turn with the window's reset time", () => {
    const w = wire("claudeAgent");
    const limit = "Claude usage limit reached.";
    const lines = runScript("claudeAgent", [
      ...w.open(),
      ...w.begin(H1, "X1"),
      w.blocked(),
      w.said("X1", limit, "usage_limit"),
      w.completed("X1", { state: "failed", errorMessage: limit, terminalReason: "api_error" }),
    ]);
    assert.deepStrictEqual(lines, [
      ...OPENS_H1,
      `usage limit parks-turn h1 until ${RESETS}`,
      "notice error usage_limit",
      `h1 ended usage-limited until ${RESETS} — agent`,
    ]);
  });

  it("grok [scripted]: its own watchdog's end is a stalled failure, never a crash", () => {
    const w = wire("grok");
    const words = "Grok ACP turn stalled without content or tool progress for 600000ms.";
    assert.deepStrictEqual(
      runScript("grok", [
        ...w.open(),
        ...w.begin(H1, "X1"),
        w.completed("X1", { state: "failed", errorMessage: words }),
      ]),
      [...OPENS_H1, "h1 ended failed: stalled — agent"],
    );
  });

  it("codex [scripted]: an event naming a turn the bridge never saw is dropped, never attached to another", () => {
    const w = wire("codex");
    const translator = makeTranslator({ driver: "codex", threadId: THREAD });
    const signals = [...w.open(), ...w.begin(H1, "X1"), w.tool("X9", "call-9", "started")].flatMap(
      (input) => translator.step(input),
    );
    assert.deepStrictEqual(signalLines(signals), OPENS_H1);
    assert.deepStrictEqual(translator.dropped(), [
      { reason: "unknown-turn", type: "item.started" },
    ]);
  });
});

// ── mock: real adapters, authored wire or the ACP mock agent ───────────

const plainTurn = NodeFS.readFileSync(
  NodePath.join(fixturesRoot, "claude", "plain-text-turn.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => (JSON.parse(line) as { readonly message: Record<string, unknown> }).message);
const CLAUDE_SESSION = "c8f9608e-c260-4030-b4fb-d7a79d50bd17";
/** The recorded turn up to its last stream event: everything but its result. */
const claudeTurnSoFar = plainTurn.slice(0, 10);
const claudeResult = plainTurn[10]!;

const CODEX_THREAD = "spi-replay-codex-thread";
const codexTurnStarted = (turnId: string) => ({
  method: "turn/started",
  params: {
    threadId: CODEX_THREAD,
    turn: {
      id: turnId,
      items: [],
      itemsView: "notLoaded",
      status: "inProgress",
      error: null,
      startedAt: 1785898342,
      completedAt: null,
      durationMs: null,
    },
  },
});
const record = async (
  driver: BridgeDriver,
  recording: Promise<{ readonly threadId: string; readonly log: ReadonlyArray<BridgeInput> }>,
) => {
  const { threadId, log } = await recording;
  const { signals } = run(driver, threadId, log);
  assert.isUndefined(integrityBreach(signals));
  return signalLines(signals);
};

/** A refused five-hour window, two hours from now: a reset the adapter believes. */
const refusedWindow = () => {
  const resetsAt = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
  return {
    resetsAt: new Date(resetsAt * 1000).toISOString(),
    message: {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt },
      uuid: "limit-1",
      session_id: CLAUDE_SESSION,
    },
  };
};

describe("real adapters, driven by a mock or an authored wire", () => {
  it("claudeAgent [mock]: a refused window parks the turn with no end, until when it says", async () => {
    const window = refusedWindow();
    assert.deepStrictEqual(
      await record("claudeAgent", recordClaude([...claudeTurnSoFar, window.message])),
      [
        ...OPENS_H1,
        "h1.i1 text running",
        "h1.i1 text completed",
        "context usage",
        `usage limit parks-turn h1 until ${window.resetsAt}`,
        "notice warning",
      ],
    );
  });

  it("claudeAgent [mock]: a refused window with no believable reset parks the turn with a limit whose reset is unknown", async () => {
    const pastReset = {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1788008400 },
      uuid: "limit-1",
      session_id: CLAUDE_SESSION,
    };
    assert.deepStrictEqual(
      await record("claudeAgent", recordClaude([...claudeTurnSoFar, pastReset])),
      [
        ...OPENS_H1,
        "h1.i1 text running",
        "h1.i1 text completed",
        "context usage",
        "usage limit parks-turn h1 until unknown",
        "notice warning",
      ],
    );
  });

  it("claudeAgent [mock]: a background shell outlives its turn, and its result wakes the agent into a turn of its own", async () => {
    const lines = await record(
      "claudeAgent",
      recordClaude([
        ...claudeTurnSoFar,
        {
          type: "system",
          subtype: "task_started",
          task_id: "bg-1",
          tool_use_id: "toolu_bg",
          description: "npm run dev",
          task_type: "local_bash",
          uuid: "task-1",
          session_id: CLAUDE_SESSION,
        },
        claudeResult,
        {
          type: "system",
          subtype: "task_notification",
          task_id: "bg-1",
          tool_use_id: "toolu_bg",
          status: "completed",
          output_file: "/tmp/bg-1.output",
          summary: "dev server exited",
          uuid: "task-2",
          session_id: CLAUDE_SESSION,
        },
        {
          type: "assistant",
          message: {
            model: "claude-opus-5",
            id: "msg_wake",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "The dev server exited." }],
            stop_reason: null,
            usage: { input_tokens: 1, output_tokens: 4 },
          },
          parent_tool_use_id: null,
          session_id: CLAUDE_SESSION,
          uuid: "wake-1",
        },
        { ...claudeResult, uuid: "wake-result" },
      ]),
    );
    assert.deepStrictEqual(lines, [
      ...OPENS_H1,
      "h1.i1 text running",
      "h1.i1 text completed",
      "context usage",
      "s1.w1 shell running, from h1",
      "context usage",
      "h1 ended completed (end_turn) — agent",
      "s1.w1 shell completed, from h1",
      "s1.self1 opened by self",
      "s1.self1.i1 text running",
      "s1.self1.i1 text completed",
      "context usage",
      "s1.self1 ended completed (end_turn) — agent",
    ]);
  });

  it("codex [mock]: an app-server exit mid-turn ends nothing, so the bridge ends the turn cut by the crash", async () => {
    assert.deepStrictEqual(
      await record(
        "codex",
        recordCodex([
          codexTurnStarted("turn-1"),
          { method: "session/exited", params: { threadId: CODEX_THREAD } },
        ]),
      ),
      [
        ...OPENS_H1,
        "h1 ended cut: process-exit — inferred-from-crash",
        "session s1 closed: process-exit",
      ],
    );
  });

  it("codex [mock]: an exhausted usage limit ends the turn, typed, with no time it lifts", async () => {
    const limit = { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" };
    assert.deepStrictEqual(
      await record(
        "codex",
        recordCodex([
          codexTurnStarted("turn-1"),
          {
            method: "error",
            params: { threadId: CODEX_THREAD, turnId: "turn-1", willRetry: false, error: limit },
          },
          {
            method: "turn/completed",
            params: {
              threadId: CODEX_THREAD,
              turn: { id: "turn-1", items: [], status: "failed", error: limit },
            },
          },
        ]),
      ),
      [...OPENS_H1, "notice error usage_limit", "h1 ended usage-limited until unknown — agent"],
    );
  });

  for (const driver of ["cursor", "grok"] as const) {
    it(
      `${driver} [mock]: Stop during a tool call is a local cancel the agent never confirms`,
      { timeout: 30_000 },
      async () => {
        assert.deepStrictEqual(
          await record(
            driver,
            recordAcp(
              driver,
              { T3_ACP_EMIT_ACTIVE_TOOL_THEN_HANG: "1" },
              { kind: "stop-mid-tool" },
            ),
          ),
          [
            ...OPENS_H1,
            "h1.i1 tool command_execution running ×2",
            "h1.i1 tool command_execution unreturned",
            "h1 ended interrupted — stop-asked",
          ],
        );
      },
    );
  }

  for (const driver of ["cursor", "antigravity"] as const) {
    it(
      `${driver} [mock]: the agent dying on its prompt ends the turn cut by the process exit, as the adapter says, and closes the session`,
      { timeout: 30_000 },
      async () => {
        assert.deepStrictEqual(
          await record(
            driver,
            recordAcp(
              driver,
              { T3_ACP_CRASH_ONCE_PATH: await crashOncePath() },
              { kind: "until-end" },
            ),
          ),
          [...OPENS_H1, "h1 ended cut: process-exit — agent", "session s1 closed: process-exit"],
        );
      },
    );
  }

  it(
    "grok [mock]: a monitor outlives its turn and ends after it",
    { timeout: 30_000 },
    async () => {
      assert.deepStrictEqual(
        await record(
          "grok",
          recordAcp(
            "grok",
            { T3_ACP_EMIT_GROK_MONITOR_POST_TURN_POLL: "1" },
            { kind: "until", type: "task.completed" },
          ),
        ),
        [
          ...OPENS_H1,
          "h1.i1 tool dynamic_tool_call running",
          "s1.w1 monitor running, from h1",
          "h1.i1 tool dynamic_tool_call completed",
          "h1 ended completed (end_turn) — agent",
          "s1.w1 monitor completed, from h1",
        ],
      );
    },
  );

  it(
    "grok [mock]: a rate limit ends the turn, typed, with no time it lifts",
    { timeout: 30_000 },
    async () => {
      assert.deepStrictEqual(
        await record(
          "grok",
          recordAcp("grok", { T3_ACP_EMIT_XAI_RATE_LIMIT_THEN_HANG: "1" }, { kind: "until-end" }),
        ),
        [...OPENS_H1, "h1 ended usage-limited until unknown — agent"],
      );
    },
  );
});
