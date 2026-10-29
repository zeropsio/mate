/**
 * The running engine, end to end: the live layer over a scripted ProviderService (each driver
 * answering as its adapter does, through the real SPI bus and the bridge) and a SQLite file.
 * Titles are engine sentences; "(×6)" runs once per driver.
 */
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ConversationId, RequestId, runId, type RunId, type ThreadId } from "@t3tools/contracts";
import * as SqlClient from "effect/sql/SqlClient";

import type { BridgeDriver } from "./bridge/spi3.ts";
import type { Command } from "./domain/command.ts";
import { CONTINUE_TEXT, resentText } from "./domain/decide.ts";
import { PROVIDER_CALL_BOUND_MS } from "./effects/shared.ts";
import { Conversations } from "./Conversations.ts";
import { TEXT_KEPT_EVERY_MS } from "./pump/toCore.ts";
import { steeredWith } from "./domain/told.ts";
import { rowStateOf } from "./read/conversationRow.ts";
import { readConversationView } from "./read/conversationView.ts";
import { DRIVERS, makeEngineWorld, mate, type EngineWorld } from "./testing/pump/engineWorld.ts";

const r = (n: number): RunId => runId(mate, n);
const MINUTE = 60_000;

/** A world booted with its conversation given an agent on this driver. */
const world = (
  driver: BridgeDriver,
  options: {
    readonly refuse?: string;
    readonly admissionDies?: string;
    readonly workspaceUnavailable?: number;
    readonly scripted?: Partial<{
      ignoreInterrupt: boolean;
      holdNextSend: boolean;
      interruptHangs: boolean;
      slowSendMs: number;
      startHangs: boolean;
    }>;
  } = {},
) =>
  Effect.gen(function* () {
    const w = yield* makeEngineWorld({
      driver,
      ...(options.refuse === undefined ? {} : { refuse: options.refuse }),
      ...(options.admissionDies === undefined ? {} : { admissionDies: options.admissionDies }),
      ...(options.workspaceUnavailable === undefined
        ? {}
        : { workspaceUnavailable: options.workspaceUnavailable }),
    });
    Object.assign(w.provider.options, options.scripted ?? {});
    yield* w.boot;
    yield* w.tell({
      _tag: "AssignAgent",
      agent: { instanceId: driver, driver, model: "m1", profile: { kind: "mate" } },
    });
    return w;
  });

const send = (w: EngineWorld, text = "hello") => w.tell({ _tag: "Send", text });
const stop = (w: EngineWorld) => w.tell({ _tag: "Stop" });
const ending = (w: EngineWorld, n: number) =>
  Effect.map(w.run(r(n)), (run) => [run?.state, run?.end?.kind, run?.source]);
const encodeSnapshot = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const sendLine = (w: EngineWorld, text: string) => `send ${w.thread}: ${text}`;

/** Runs a scene and always closes its world, so no fiber outlives the test. */
const scene = <E, R>(body: Effect.Effect<void, E, R>) => Effect.scoped(body);

describe("the running engine", () => {
  it.effect("a message is confirmed at once and reaches the agent only after its admission", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        const result = yield* send(w);
        assert.strictEqual(result._tag, "Accepted");
        assert.deepStrictEqual(w.provider.calls, [`start ${w.thread}`, sendLine(w, "hello")]);
        assert.strictEqual((yield* w.run(r(1)))?.state, "running");
        yield* w.agent((agent, thread) => agent.say(thread, "hi there"));
        yield* w.agent((agent, thread) => agent.finish(thread));
        assert.deepStrictEqual(yield* ending(w, 1), ["ended", "completed", "agent"]);
        assert.deepStrictEqual(
          (yield* w.items(r(1))).map((item) => [item.kind, item.body.text]),
          [
            ["person", "hello"],
            ["note", "hi there"],
          ],
        );
        yield* w.shutdown;
      }),
    ),
  );

  // What the person did not type but the agent should hear: a merged change, a vault key's name.
  const CONTEXT = [
    "appdev #3 landed: Add the order summary",
    "Vault changes since your last turn (values are never shown to you):\n+ STRIPE_KEY  Shared · sensitive · nothing reads it yet",
  ];
  const told = (text: string) =>
    `<zerops-update>\n${CONTEXT.join("\n")}\n</zerops-update>\n\n${text}`;
  const personWords = (w: EngineWorld, run: RunId) =>
    Effect.map(w.items(run), (items) =>
      items.filter((item) => item.kind === "person").map((item) => item.body.text),
    );

  it.effect.each(
    Array.from(DRIVERS, (driver) => ({
      title: `the context a message carries reaches the agent with its words, never as the person's (${driver})`,
      driver,
    })),
  )("$title", ({ driver }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world(driver);
        yield* w.tell({ _tag: "Send", text: "Inspect what landed", context: CONTEXT });
        assert.deepStrictEqual(w.provider.calls, [
          `start ${w.thread}`,
          sendLine(w, told("Inspect what landed")),
        ]);
        assert.deepStrictEqual(yield* personWords(w, r(1)), ["Inspect what landed"]);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a slash command reaches the agent without the context, so the agent still runs it",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* w.tell({ _tag: "Send", text: "/compact", maintenance: true, context: CONTEXT });
          assert.deepStrictEqual(w.provider.calls.at(-1), sendLine(w, "/compact"));
          yield* w.shutdown;
        }),
      ),
  );

  it.effect.each(
    Array.from(
      DRIVERS.filter((driver) => driver === "claudeAgent" || driver === "opencode"),
      (driver) => ({
        title: `a message steered into the running turn carries its context to the agent, never as the person's (${driver})`,
        driver,
      }),
    ),
  )("$title", ({ driver }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world(driver);
        yield* send(w);
        yield* w.tell({ _tag: "Steer", runId: r(1), text: "And the api too", context: CONTEXT });
        assert.deepStrictEqual(
          w.provider.calls.at(-1),
          sendLine(w, steeredWith(told("And the api too"))),
        );
        assert.deepStrictEqual(yield* personWords(w, r(1)), ["hello", "And the api too"]);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a refused admission ends the run with the refusal's words, before anything is sent",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("codex", { refuse: "Ana's sign-in was removed." });
          yield* send(w);
          const run = yield* w.run(r(1));
          assert.deepStrictEqual(
            [run?.end, run?.source],
            [
              { kind: "failed", reason: "Ana's sign-in was removed.", next: null },
              "inferred-from-effect",
            ],
          );
          assert.deepStrictEqual(w.provider.calls, []);
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("an admission that breaks ends the run failed, and nothing is sent", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex", { admissionDies: "the signer store is unreachable" });
        yield* send(w);
        yield* w.advance(MINUTE);
        const run = yield* w.run(r(1));
        assert.deepStrictEqual([run?.end?.kind, run?.source], ["failed", "inferred-from-effect"]);
        assert.deepStrictEqual(w.provider.calls, []);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a session opens explicitly before the first send; a live one is adopted, not restarted",
    () =>
      scene(
        Effect.gen(function* () {
          const fresh = yield* world("codex");
          yield* send(fresh);
          assert.deepStrictEqual(fresh.provider.calls, [
            `start ${fresh.thread}`,
            sendLine(fresh, "hello"),
          ]);
          yield* fresh.shutdown;

          const adopting = yield* world("codex");
          yield* adopting.provider.service.startSession(adopting.thread as ThreadId, {
            threadId: adopting.thread as ThreadId,
            runtimeMode: "full-access",
          });
          yield* send(adopting);
          assert.deepStrictEqual(adopting.provider.calls, [
            `start ${adopting.thread}`,
            sendLine(adopting, "hello"),
          ]);
          yield* adopting.shutdown;
        }),
      ),
  );

  it.effect("nothing is sent, stopped or answered without a live session", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        yield* send(w);
        yield* w.agent((agent, thread) => agent.ask(thread, "approval"));
        // The agent's process is gone, and nothing has said so yet.
        w.provider.sessions.get(w.thread)!.alive = false;
        const [request] = yield* w.requests;
        yield* w.tell({
          _tag: "Answer",
          requestId: RequestId.make(request!.request_id),
          answer: "accept",
          summary: "Yes",
        });
        assert.strictEqual((yield* w.requests)[0]?.state, "expired");
        yield* stop(w);
        assert.deepStrictEqual(yield* ending(w, 1), ["ended", "stopped", "stop-asked"]);
        yield* send(w, "again");
        assert.deepStrictEqual(w.provider.calls, [
          `start ${w.thread}`,
          sendLine(w, "hello"),
          `start ${w.thread}`,
          sendLine(w, "again"),
        ]);
        assert.strictEqual((yield* w.run(r(2)))?.state, "running");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a session the host recovered on its own is recorded as a replacement nobody asked for",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w);
          yield* w.agent((agent, thread) => agent.finish(thread));
          w.provider.options.recoverOnNextSend = true;
          yield* send(w, "second");
          assert.deepStrictEqual(yield* ending(w, 2), ["ended", "crashed", "inferred-from-crash"]);
          // The unasked session is closed: the next message opens one of the engine's own.
          assert.strictEqual(w.provider.calls.at(-1), `stop ${w.thread}`);
          yield* send(w, "third");
          assert.deepStrictEqual(w.provider.calls.slice(-2), [
            `start ${w.thread}`,
            sendLine(w, "third"),
          ]);
          assert.deepStrictEqual(
            (yield* w.sessionsOpen).map((session) => [session.state, session.close_reason]),
            [
              ["closed", "exited"],
              ["open", null],
            ],
          );
          yield* w.shutdown;
        }),
      ),
  );

  it.effect.each(
    DRIVERS.flatMap((driver) => [
      {
        title: `background work's approval after its turn ended asks the person, and the answer reaches the agent (${driver})`,
        driver,
        turnId: undefined,
      },
      {
        title: `a helper's approval under a turn of its own asks the person, and the answer reaches the agent (${driver})`,
        driver,
        turnId: "child-T1",
      },
    ]),
  )("$title", ({ driver, turnId }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world(driver);
        yield* send(w);
        yield* w.agent((agent, thread) => agent.startWork(thread));
        yield* w.agent((agent, thread) => agent.finish(thread));
        assert.deepStrictEqual(yield* ending(w, 1), ["ended", "completed", "agent"]);
        const asked = yield* w.agent((agent, thread) =>
          agent.ask(thread, "approval", turnId === undefined ? {} : { turnId }),
        );
        const [request] = yield* w.requests;
        assert.deepStrictEqual([request?.run_id, request?.state], [r(1), "open"]);
        yield* w.tell({
          _tag: "Answer",
          requestId: RequestId.make(request!.request_id),
          answer: "accept",
          summary: "Approve",
        });
        assert.include(w.provider.calls, `approve ${asked} accept`);
        assert.strictEqual((yield* w.requests)[0]?.state, "answered");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "on a driver whose send returns at the turn's end, an answer and a Stop reach the agent mid-turn",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("cursor");
          yield* send(w);
          const asked = yield* w.agent((agent, thread) => agent.ask(thread, "approval"));
          const [request] = yield* w.requests;
          yield* w.tell({
            _tag: "Answer",
            requestId: RequestId.make(request!.request_id),
            answer: "accept",
            summary: "Yes",
          });
          yield* stop(w);
          assert.deepStrictEqual(w.provider.calls, [
            `start ${w.thread}`,
            sendLine(w, "hello"),
            `approve ${asked} accept`,
            `interrupt ${w.thread} T1`,
          ]);
          assert.deepStrictEqual(yield* ending(w, 1), ["ended", "stopped", "stop-asked"]);
          yield* w.shutdown;
        }),
      ),
  );

  it.effect(
    "a question Codex asks by message is answered by the person's message once its turn ended, never the respond call",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("codex");
          yield* send(w);
          const asked = yield* w.agent((agent, thread) => agent.ask(thread, "message-question"));
          yield* w.agent((agent, thread) => agent.finish(thread));
          assert.deepStrictEqual(yield* ending(w, 1), ["ended", "completed", "agent"]);
          const [request] = yield* w.requests;
          assert.strictEqual(request?.state, "open");
          yield* w.tell({
            _tag: "Answer",
            requestId: RequestId.make(request!.request_id),
            answer: { answers: { "0": "pnpm" } },
            summary: "Answered",
          });
          assert.include(w.provider.calls, sendLine(w, "Which package manager?\npnpm"));
          assert.notInclude(w.provider.calls, `answer ${asked}`);
          assert.strictEqual((yield* w.requests)[0]?.state, "answered");
          yield* w.shutdown;
        }),
      ),
  );

  const STOP_SOURCES: Record<BridgeDriver, string> = {
    claudeAgent: "stop-asked",
    codex: "stop-confirmed",
    opencode: "stop-confirmed",
    cursor: "stop-asked",
    grok: "stop-asked",
    antigravity: "stop-confirmed",
  };
  it.effect.each(
    Array.from(DRIVERS, (driver) => ({
      title: `a Stop ends the run on its turn's end, and the next message starts after it (${driver})`,
      driver,
    })),
  )("$title", ({ driver }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world(driver);
        yield* send(w);
        yield* w.agent((agent, thread) => agent.call(thread));
        yield* stop(w);
        yield* send(w, "next");
        assert.deepStrictEqual(yield* ending(w, 1), ["ended", "stopped", STOP_SOURCES[driver]]);
        const calls = w.provider.calls;
        const stopped = calls.findIndex((call) => call.startsWith("interrupt"));
        assert.isAbove(stopped, 0);
        assert.isAbove(calls.indexOf(sendLine(w, "next")), stopped);
        assert.strictEqual((yield* w.run(r(2)))?.state, "running");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a stopped turn's late end and late items stay in the stopped run's card", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("cursor");
        yield* send(w);
        yield* stop(w);
        yield* w.agent((agent, thread) => agent.stream(thread, "late-1", "still going"));
        yield* send(w, "next");
        assert.deepStrictEqual(yield* ending(w, 1), ["ended", "stopped", "stop-asked"]);
        const late = (yield* w.items(r(1))).filter((item) => item.kind !== "person");
        assert.deepStrictEqual(
          late.map((item) => [item.kind, item.state]),
          [["note", "closed"]],
        );
        assert.deepStrictEqual(
          (yield* w.items(r(2))).map((item) => item.kind),
          ["person"],
        );
        yield* w.shutdown;
      }),
    ),
  );

  const thoughtOf = (w: EngineWorld, n: number) =>
    Effect.map(w.items(r(n)), (items) => items.find((item) => item.kind === "thought")?.body);
  const thinking = (w: EngineWorld) =>
    Effect.gen(function* () {
      yield* w.agent((agent, thread) => agent.think(thread, "think-1", "Checking the "));
      yield* w.agent((agent, thread) => agent.think(thread, "think-1", "deploy logs"));
    });
  const WORDS = { preview: "Checking the deploy logs", length: 24, streaming: false };
  it.effect.each(
    Array.from(DRIVERS, (driver) => ({
      title: `a thought a Stop cuts keeps the words it had streamed (${driver})`,
      driver,
    })),
  )("$title", ({ driver }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world(driver);
        yield* send(w);
        yield* thinking(w);
        yield* stop(w);
        yield* send(w, "next");
        assert.deepInclude(yield* thoughtOf(w, 1), WORDS);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a thought a second Stop cuts with its session keeps the words it had streamed", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex", { scripted: { ignoreInterrupt: true } });
        yield* send(w);
        yield* thinking(w);
        yield* stop(w);
        yield* stop(w);
        assert.deepInclude(yield* thoughtOf(w, 1), WORDS);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a thought a restart cuts keeps the words it had streamed before the server stopped",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w);
          yield* thinking(w);
          yield* w.shutdown;
          yield* w.provider.service.stopSession({ threadId: w.thread as ThreadId });
          yield* w.boot;
          assert.deepInclude(yield* thoughtOf(w, 1), WORDS);
          yield* w.shutdown;
        }),
      ),
  );

  // Milo's final engine run, 2026-10-11: a restart (J2) and a double Stop (D7) each cut a thought
  // Claude streamed with no item of its own; the record held it empty, live and after a reload.
  /** A step of a scene: whatever it fails with fails the test. */
  type Step = (w: EngineWorld) => Effect.Effect<void>;
  const step =
    <E>(act: (w: EngineWorld) => Effect.Effect<unknown, E>): Step =>
    (w) =>
      Effect.asVoid(Effect.orDie(act(w)));
  const CUTS: ReadonlyArray<readonly [string, Step]> = [
    ["a Stop", step(stop)],
    ["a double Stop", step((w) => Effect.andThen(stop(w), stop(w)))],
    ["a restart", step((w) => Effect.andThen(w.crash, w.boot))],
    ["a kill of the server", step((w) => Effect.andThen(w.kill, w.boot))],
    ["its agent's crash", step((w) => w.agent((agent, thread) => agent.crash(thread)))],
  ];
  /** A thought longer than its preview: the record holds the rest as the item's detail. */
  const LONG = "Reading the build output line by line for the failing step. ".repeat(6);
  const STREAMS: ReadonlyArray<readonly [string, Step, Record<string, unknown>, string | null]> = [
    [
      "a thought",
      step((w) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => agent.summarize(thread, "Checking the "));
          yield* w.agent((agent, thread) => agent.summarize(thread, "deploy logs"));
        }),
      ),
      { kind: "thought", preview: "Checking the deploy logs", length: 24, streaming: false },
      null,
    ],
    [
      "a thought longer than its preview",
      step((w) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => agent.summarize(thread, LONG.slice(0, 200)));
          yield* w.agent((agent, thread) => agent.summarize(thread, LONG.slice(200)));
        }),
      ),
      { kind: "thought", length: LONG.length, streaming: false },
      LONG,
    ],
    [
      "an answer",
      step((w) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => agent.stream(thread, "m-cut", "The deploy failed "));
          yield* w.agent((agent, thread) => agent.stream(thread, "m-cut", "because the port"));
        }),
      ),
      { kind: "note", text: "The deploy failed because the port", streaming: false },
      null,
    ],
  ];
  const detailOf = (w: EngineWorld, itemId: string) =>
    w.within(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{ readonly body: string }>`
          SELECT body FROM engine_item_detail WHERE item_id = ${itemId}
        `;
        return rows[0]?.body ?? null;
      }),
    );
  it.effect.each(
    CUTS.flatMap(([cut, cutting]) =>
      STREAMS.map(([what, streaming, kept, detail]) => ({
        title: `a run cut by ${cut} keeps everything it had streamed: ${what}`,
        cutting,
        streaming,
        kept,
        detail,
      })),
    ),
  )("$title", ({ cutting, streaming, kept, detail }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        yield* send(w);
        yield* streaming(w);
        // What streams goes into the record while it streams, not only once its item closes.
        yield* w.advance(TEXT_KEPT_EVERY_MS);
        yield* cutting(w);
        const items = (yield* w.items(r(1))).filter((item) => item.kind === kept.kind);
        assert.deepStrictEqual(
          items.map((item) => item.state),
          ["closed"],
        );
        assert.deepInclude(items[0]!.body, kept);
        assert.strictEqual(yield* detailOf(w, items[0]!.item_id), detail);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a second Stop closes the session", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex", { scripted: { ignoreInterrupt: true } });
        yield* send(w);
        yield* stop(w);
        assert.strictEqual((yield* w.run(r(1)))?.state, "running");
        yield* stop(w);
        assert.deepStrictEqual(yield* ending(w, 1), ["ended", "stopped", "inferred-from-close"]);
        assert.strictEqual(w.provider.calls.at(-1), `stop ${w.thread}`);
        assert.deepStrictEqual(
          (yield* w.sessionsOpen).map((session) => session.close_reason),
          ["stop"],
        );
        yield* w.shutdown;
      }),
    ),
  );

  const CRASH_SOURCES: Record<BridgeDriver, string> = {
    claudeAgent: "agent",
    codex: "inferred-from-crash",
    opencode: "inferred-from-crash",
    cursor: "agent",
    grok: "agent",
    antigravity: "inferred-from-crash",
  };
  it.effect.each(
    Array.from(DRIVERS, (driver) => ({
      title: `a crash ends the run crashed, with the bridge's source; the next message resumes (${driver})`,
      driver,
    })),
  )("$title", ({ driver }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world(driver);
        yield* send(w);
        yield* w.agent((agent, thread) => agent.call(thread));
        yield* w.agent((agent, thread) => agent.crash(thread));
        assert.deepStrictEqual(yield* ending(w, 1), ["ended", "crashed", CRASH_SOURCES[driver]]);
        yield* send(w, "again");
        assert.deepStrictEqual(w.provider.calls.slice(-2), [
          `start ${w.thread}`,
          sendLine(w, "again"),
        ]);
        assert.strictEqual((yield* w.run(r(2)))?.state, "running");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect.each(
    Array.from(DRIVERS, (driver) => ({
      title: `a restart cuts the running run and a continuation joins it (${driver})`,
      driver,
    })),
  )("$title", ({ driver }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world(driver);
        yield* send(w);
        yield* w.agent((agent, thread) => agent.call(thread));
        yield* w.crash;
        yield* w.boot;
        const cut = yield* w.run(r(1));
        assert.deepStrictEqual(
          [cut?.end?.kind, cut?.source],
          ["cut-by-restart", "inferred-from-restart"],
        );
        const continued = yield* w.run(r(2));
        assert.deepStrictEqual(
          [continued?.trigger.cause, continued?.joins, continued?.state],
          ["restart-continuation", r(1), "running"],
        );
        assert.deepStrictEqual(w.provider.calls, [`start ${w.thread}`, sendLine(w, CONTINUE_TEXT)]);
        yield* w.shutdown;
      }),
    ),
  );

  // Milo's live recheck, 2026-10-11: a restart cut a story mid-answer; the record kept it up to
  // "…calling out orders for coal", but Claude's resumed session held the whole story, so its
  // continuation said the story was complete and the person never saw its end.
  const STORY =
    "Wren kept the lamp lit through the storm, " + "and the harbour master was ".repeat(8);
  const POINTS: ReadonlyArray<readonly [string, Step, string]> = [
    [
      "mid-answer carries on from the last words the person saw",
      step((w) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => agent.stream(thread, "m-story", "Wren kept the lamp "));
          yield* w.agent((agent, thread) =>
            agent.stream(thread, "m-story", "lit, calling out orders for coal"),
          );
        }),
      ),
      [
        "The server restarted while you were writing your answer. The person has it only up to these last words:",
        '"Wren kept the lamp lit, calling out orders for coal"',
        "Carry on from exactly there; don't repeat what they already have.",
      ].join("\n\n"),
    ],
    [
      "mid-answer quotes only the answer's last words, whole",
      step((w) => w.agent((agent, thread) => agent.stream(thread, "m-story", STORY))),
      [
        "The server restarted while you were writing your answer. The person has it only up to these last words:",
        // Its last 200 characters, from the first whole word in them.
        `"…master was${" and the harbour master was".repeat(7)}"`,
        "Carry on from exactly there; don't repeat what they already have.",
      ].join("\n\n"),
    ],
    [
      // The record's body holds an answer's first 16 KiB; the person reads it whole.
      "past 16 KiB carries on from its true last words",
      step((w) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => agent.stream(thread, "m-long", "lamp ".repeat(4000)));
          yield* w.agent((agent, thread) =>
            agent.stream(thread, "m-long", "and so the keeper slept at last"),
          );
        }),
      ),
      [
        "The server restarted while you were writing your answer. The person has it only up to these last words:",
        `"…${"lamp ".repeat(33)}and so the keeper slept at last"`,
        "Carry on from exactly there; don't repeat what they already have.",
      ].join("\n\n"),
    ],
    [
      "mid-thought says its answer had not started",
      step((w) => w.agent((agent, thread) => agent.summarize(thread, "Planning the story"))),
      "The server restarted while you were thinking, before you wrote anything more: nothing after that thinking reached the person. Continue where you left off and give your answer in full.",
    ],
    [
      "between items continues where it left off",
      step((w) =>
        Effect.gen(function* () {
          yield* w.agent((agent, thread) => agent.say(thread, "Checking the deploy first."));
          yield* w.agent((agent, thread) => agent.call(thread));
        }),
      ),
      CONTINUE_TEXT,
    ],
  ];
  it.effect.each(
    POINTS.flatMap(([point, streaming, told]) =>
      [
        ["a restart", step((w: EngineWorld) => Effect.andThen(w.crash, w.boot))],
        ["a kill of the server", step((w: EngineWorld) => Effect.andThen(w.kill, w.boot))],
      ].map(([cut, cutting]) => ({
        title: `a run ${cut as string} cut ${point}`,
        streaming,
        cutting: cutting as Step,
        told,
      })),
    ),
  )("$title", ({ streaming, cutting, told }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        yield* send(w);
        yield* streaming(w);
        yield* w.advance(TEXT_KEPT_EVERY_MS);
        yield* cutting(w);
        assert.strictEqual((yield* w.run(r(2)))?.trigger.cause, "restart-continuation");
        assert.strictEqual(w.provider.calls.at(-1), sendLine(w, told));
        yield* w.shutdown;
      }),
    ),
  );

  it.effect.each(
    Array.from(DRIVERS, (driver) => ({
      title: `a run a restart cut mid-answer carries on from the last words the person saw (${driver})`,
      driver,
    })),
  )("$title", ({ driver }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world(driver);
        yield* send(w);
        yield* w.agent((agent, thread) => agent.stream(thread, "m-story", "orders for coal"));
        yield* w.advance(TEXT_KEPT_EVERY_MS);
        yield* w.kill;
        yield* w.boot;
        assert.include(w.provider.calls.at(-1) ?? "", '"orders for coal"');
        yield* w.shutdown;
      }),
    ),
  );

  it.effect.each<readonly [string, ReadonlyArray<Command>, string]>([
    ["a newer person message", [{ _tag: "Send", text: "newer" }], "a newer person message"],
    ["a Stop", [{ _tag: "Stop" }], "a Stop was asked"],
    ["an archive", [{ _tag: "Archive" }], "archived"],
  ])("a restart never continues a run against %s", ([, after, refusal]) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex", { scripted: { ignoreInterrupt: true } });
        yield* send(w);
        for (const command of after) yield* w.tell(command);
        yield* w.crash;
        const bootAt = yield* Clock.currentTimeMillis;
        yield* w.boot;
        const cut = yield* w.run(r(1));
        assert.deepStrictEqual(cut?.end, {
          kind: "cut-by-restart",
          continuedBy: null,
          notContinued: refusal,
          restart: { cause: "restarted", at: DateTime.formatIso(DateTime.makeUnsafe(bootAt)) },
        });
        assert.isFalse(w.provider.calls.includes(sendLine(w, CONTINUE_TEXT)));
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a restart never continues a maintenance turn", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex");
        yield* w.tell({ _tag: "Send", text: "/compact", maintenance: true });
        yield* w.crash;
        yield* w.boot;
        assert.strictEqual((yield* w.run(r(1)))?.end?.kind, "cut-by-restart");
        assert.deepStrictEqual(w.provider.calls, []);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a snapshot of main's v8 shape refolds and a send after it opens a session", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex");
        yield* send(w, "before");
        yield* w.agent((agent, thread) => agent.finish(thread));
        // Main's version 8 kept no rotation: an older Mate's snapshot of this record, as it wrote it.
        yield* w.within(
          Effect.gen(function* () {
            const conversations = yield* Conversations;
            const { rotation: _rotation, ...older } = yield* conversations.state(mate);
            const sql = yield* SqlClient.SqlClient;
            const snapshot = yield* encodeSnapshot({
              v: 8,
              state: older,
            });
            yield* sql`UPDATE engine_conversation SET snapshot_json = ${snapshot},
              snapshot_seq = ${older.headSeq} WHERE conversation_id = ${mate}`;
          }),
        );
        yield* w.crash;
        yield* w.boot;
        const opened = (yield* w.sessionsOpen).length;
        yield* send(w, "after");
        assert.include(w.provider.calls, sendLine(w, "after"));
        assert.isAbove((yield* w.sessionsOpen).length, opened);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a session whose workspace cannot be told yet opens nowhere else, and opens there once it can",
    () =>
      scene(
        Effect.gen(function* () {
          // The session's first two opens find no workspace.
          const w = yield* world("codex", { workspaceUnavailable: 2 });
          yield* send(w);
          assert.isFalse(w.provider.calls.some((call) => call.startsWith("start")));
          // Each open waits out its owner's backoff: one second, then two.
          yield* w.advance(1_000);
          assert.isFalse(w.provider.calls.some((call) => call.startsWith("start")));
          yield* w.advance(2_000);
          assert.include(w.provider.calls, sendLine(w, "hello"));
          assert.deepStrictEqual(
            w.provider.starts.map((start) => (start as { readonly cwd: string }).cwd),
            [w.dir],
          );
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("a run cut while being sent sends its message again", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex", { scripted: { holdNextSend: true } });
        yield* send(w);
        assert.strictEqual((yield* w.run(r(1)))?.state, "sending");
        yield* w.crash;
        yield* w.boot;
        assert.deepStrictEqual(w.provider.calls, [
          `start ${w.thread}`,
          sendLine(w, resentText("hello")),
        ]);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("the first message after a restart opens a new session", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex");
        yield* send(w);
        yield* w.agent((agent, thread) => agent.finish(thread));
        yield* w.crash;
        yield* w.boot;
        yield* send(w, "after");
        assert.deepStrictEqual(w.provider.calls, [`start ${w.thread}`, sendLine(w, "after")]);
        assert.deepStrictEqual(
          (yield* w.sessionsOpen).map((session) => [
            session.session_id,
            session.state,
            session.close_reason,
          ]),
          [
            [`${w.thread}.1`, "closed", "restart"],
            [`${w.thread}.2`, "open", null],
          ],
        );
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a graceful shutdown leaves its running run for the next boot to cut", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        yield* send(w);
        // The server stops: ProviderService ends every live turn as it goes down.
        yield* w.shutdown;
        yield* w.provider.service.stopSession({ threadId: w.thread as ThreadId });
        yield* w.boot;
        const cut = yield* w.run(r(1));
        assert.deepStrictEqual(
          [cut?.end?.kind, cut?.source],
          ["cut-by-restart", "inferred-from-restart"],
        );
        yield* w.shutdown;
      }),
    ),
  );

  // Milo's final engine run, 2026-10-11 (J6): a wake armed before a restart fired about 3 minutes
  // late. That one was Claude's own session cron, which the CLI holds while a background job of
  // its own runs; the engine's own wakes fire on boot, and at their time.
  it.effect.each([
    { when: "came due while the server was down", dueIn: MINUTE, downFor: 2 * MINUTE, wait: 0 },
    { when: "is due after the restart", dueIn: 3 * MINUTE, downFor: MINUTE, wait: 2 * MINUTE },
  ])(
    "a wake armed before a restart fires once, at boot when it $when, else at its time",
    ({ dueIn, downFor, wait }) =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          const now = yield* Clock.currentTimeMillis;
          yield* w.tell({
            _tag: "ArmWake",
            kind: "standup",
            key: "j6",
            dueAt: now + dueIn,
            text: "j6 wake",
          });
          yield* w.kill;
          yield* TestClock.adjust(downFor);
          yield* w.boot;
          if (wait > 0) {
            yield* w.advance(wait - 1);
            assert.isUndefined(yield* w.run(r(1)));
            yield* w.advance(1);
          }
          assert.strictEqual((yield* w.run(r(1)))?.trigger.kind, "wake");
          assert.strictEqual(w.provider.calls.filter((call) => call.endsWith("j6 wake")).length, 1);
          assert.isUndefined(yield* w.run(r(2)));
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("a known reset holds work until that exact instant", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        yield* send(w);
        const resetsAt = (yield* Clock.currentTimeMillis) + 2 * 60 * MINUTE;
        yield* w.agent((agent, thread) =>
          agent.limit(thread, DateTime.formatIso(DateTime.makeUnsafe(resetsAt))),
        );
        const limited = yield* w.run(r(1));
        assert.deepStrictEqual(limited?.end, {
          kind: "usage-limit",
          resetsAt,
          driver: "claudeAgent",
          window: "5-hour",
        });
        yield* w.advance(resetsAt - 1 - (yield* Clock.currentTimeMillis));
        assert.isUndefined(yield* w.run(r(2)));
        yield* w.advance(1);
        const resumed = yield* w.run(r(2));
        assert.deepStrictEqual(
          [resumed?.trigger.cause, resumed?.joins, resumed?.state],
          ["usage-resume", r(1), "running"],
        );
        assert.strictEqual(w.provider.calls.at(-1), sendLine(w, CONTINUE_TEXT));
        yield* w.shutdown;
      }),
    ),
  );

  // Milo, 2026-10-10: signed in to another Claude subscription with budget, and restarted, the
  // conversation stayed paused on the old account's weekly reset with the message held.
  it.effect("a held message goes once the provider no longer reports the limit, at boot too", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        yield* send(w);
        const limitedAt = yield* Clock.currentTimeMillis;
        const resetsAt = limitedAt + 24 * 60 * MINUTE;
        yield* w.agent((agent, thread) =>
          agent.limit(thread, DateTime.formatIso(DateTime.makeUnsafe(resetsAt))),
        );
        yield* send(w, "still there?");
        // The old account, read again after the limit: its window still resets with the limit.
        yield* w.reportUsage([
          {
            instanceId: "claudeAgent",
            usage: {
              checkedAt: limitedAt + 1,
              windows: [{ usedPercent: 99, resetsAt }],
            },
          },
        ]);
        assert.strictEqual((yield* w.run(r(2)))?.state, "queued");
        yield* w.shutdown;
        // Signed in to another account while the server was down: the registry reads it at boot.
        yield* w.reportUsage([
          {
            instanceId: "claudeAgent",
            usage: {
              checkedAt: limitedAt + 2,
              windows: [
                { usedPercent: 17, resetsAt: limitedAt + 3 * 60 * MINUTE },
                { usedPercent: 24, resetsAt: limitedAt + 4 * 24 * 60 * MINUTE },
              ],
            },
          },
        ]);
        yield* w.boot;
        assert.strictEqual((yield* w.run(r(2)))?.state, "running");
        assert.strictEqual(w.provider.calls.at(-1), sendLine(w, "still there?"));
        assert.isUndefined(yield* w.run(r(3)));
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "an unknown reset is probed at 15 and 30 minutes, then every hour, until it lifts",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("codex");
          yield* send(w);
          const waits: Array<number> = [];
          for (let run = 1; run <= 4; run++) {
            yield* w.agent((agent, thread) => agent.limit(thread, null));
            assert.deepStrictEqual((yield* w.run(r(run)))?.end, {
              kind: "usage-limit",
              resetsAt: null,
              driver: "codex",
            });
            const now = yield* Clock.currentTimeMillis;
            const probe = (yield* w.wakes).find(
              (wake) => wake.kind === "usage-probe" && wake.state === "armed",
            );
            waits.push((probe!.due_at - now) / MINUTE);
            yield* w.advance(probe!.due_at - now);
            assert.strictEqual((yield* w.run(r(run + 1)))?.trigger.cause, "usage-probe");
          }
          assert.deepStrictEqual(waits, [15, 30, 60, 60]);
          yield* w.agent((agent, thread) => agent.finish(thread));
          assert.deepStrictEqual(yield* ending(w, 5), ["ended", "completed", "agent"]);
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("Claude's parked turn is closed when the limit ends its run", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        yield* send(w);
        yield* w.agent((agent, thread) => agent.limit(thread, null));
        assert.deepStrictEqual((yield* w.run(r(1)))?.end, {
          kind: "usage-limit",
          resetsAt: null,
          driver: "claudeAgent",
        });
        assert.strictEqual(w.provider.calls.at(-1), `stop ${w.thread}`);
        assert.deepStrictEqual(
          (yield* w.sessionsOpen).map((session) => session.close_reason),
          ["usage-limit"],
        );
        yield* w.shutdown;
      }),
    ),
  );

  // Milo's second stress run: a helper's row read its current command ("Running List regular
  // files with sizes recursively") instead of the task it was given.
  it.effect(
    "background work keeps the name it started with while it reports what it runs now",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w);
          const work = yield* w.agent((agent, thread) => agent.startWork(thread));
          yield* w.agent((agent, thread) =>
            agent.emit("task.progress", thread, {
              payload: { taskId: work, description: "Running List regular files recursively" },
            }),
          );
          const titles = (yield* w.items(r(1))).flatMap((item) =>
            item.kind === "work" ? [item.body.title] : [],
          );
          assert.deepStrictEqual(titles, ["Watch the build"]);
          yield* w.shutdown;
        }),
      ),
  );

  it.effect(
    "Claude's background-result turn is a self-woken run, joined to the run whose work it reports",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w);
          const work = yield* w.agent((agent, thread) => agent.startWork(thread));
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* w.agent((agent, thread) => agent.endWork(thread, work));
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
          const self = yield* w.run(r(2));
          assert.deepStrictEqual(
            [self?.trigger, self?.joins, self?.state],
            [{ kind: "wake", cause: "self", wakeId: null }, r(1), "running"],
          );
          yield* w.agent((agent, thread) => agent.say(thread, "The build is green."));
          yield* w.agent((agent, thread) => agent.finish(thread));
          assert.deepStrictEqual(yield* ending(w, 2), ["ended", "completed", "agent"]);
          yield* w.shutdown;
        }),
      ),
  );

  // Milo, 2026-10-08: Claude said it would reply once its background sleep finished, a restart
  // killed the sleep, and nothing woke it again.
  it.effect("background work a restart killed wakes the Mate once with a note naming it", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        yield* send(w);
        yield* w.agent((agent, thread) => agent.startWork(thread));
        yield* w.agent((agent, thread) => agent.finish(thread));
        yield* w.crash;
        yield* w.boot;
        yield* w.advance(0);
        const woken = yield* w.run(r(2));
        assert.deepStrictEqual(
          [woken?.trigger.cause, woken?.joins, woken?.state],
          ["lost-work", r(1), "running"],
        );
        assert.match(
          w.provider.calls.at(-1) ?? "",
          /^send .*: Your background work .+ was stopped by a restart before it reported\.$/u,
        );
        assert.isUndefined(yield* w.run(r(3)));
        yield* w.shutdown;
      }),
    ),
  );

  // Milo's recheck on 0.15.41: a one-off CronCreate fired as Claude's own turn and was filed under
  // a helpers run the person had stopped four turns before; its reply drew under that old card,
  // which then read "worked".
  it.effect(
    "a turn the agent starts on its own, after its runs ended, answers at the conversation's end",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w, "start two helpers");
          yield* w.agent((agent, thread) => agent.startWork(thread));
          yield* stop(w);
          yield* send(w, "what is the time?");
          yield* w.agent((agent, thread) => agent.say(thread, "It is 15:16."));
          yield* w.agent((agent, thread) => agent.finish(thread));
          // Its own schedule fires: a turn of its own, with no finished work to report.
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
          yield* w.agent((agent, thread) => agent.say(thread, "cron-ok"));
          yield* w.agent((agent, thread) => agent.finish(thread));
          const own = yield* w.run(r(3));
          assert.deepStrictEqual(
            [own?.trigger, own?.joins, own?.end?.kind],
            [{ kind: "wake", cause: "self", wakeId: null }, r(2), "completed"],
          );
          assert.deepStrictEqual(yield* ending(w, 1), ["ended", "stopped", "stop-asked"]);
          yield* w.shutdown;
        }),
      ),
  );

  it.effect(
    "a turn the agent starts on its own after a run the person stopped leaves that run stopped",
    () =>
      scene(
        Effect.gen(function* () {
          // Codex's Stop leaves its session open: the agent's own turn can come next.
          const w = yield* world("codex");
          yield* send(w, "watch the build");
          yield* stop(w);
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
          const own = yield* w.run(r(2));
          assert.deepStrictEqual([own?.trigger.cause, own?.joins], ["self", null]);
          assert.strictEqual((yield* w.run(r(1)))?.end?.kind, "stopped");
          yield* w.shutdown;
        }),
      ),
  );

  // Milo's recheck on 0.15.44: each Stop moves the conversation onto a new Claude session, and a
  // CronCreate wake scheduled before it, which lives only in the CLI that died, never fired.
  /** A cron for the minute `ahead` from now, as the CLI and the engine read one: local time. */
  const cronIn = (now: number, ahead: number) => {
    // @effect-diagnostics-next-line globalDate:off
    const at = new Date(now + ahead);
    at.setSeconds(0, 0);
    const cron = `${at.getMinutes()} ${at.getHours()} ${at.getDate()} ${at.getMonth() + 1} *`;
    return { cron, at: at.getTime() };
  };
  const PROMPT = "reply with the single word cron-ok";
  const finished = (cut: Step): Step =>
    step((w) =>
      Effect.andThen(
        w.agent((agent, thread) => agent.finish(thread)),
        cut(w),
      ),
    );
  const SCHEDULE_ENDS: ReadonlyArray<readonly [string, Step]> = [
    ["a Stop", step(stop)],
    ["a restart", finished(step((w) => Effect.andThen(w.crash, w.boot)))],
    ["a kill of the server", finished(step((w) => Effect.andThen(w.kill, w.boot)))],
    ["its agent's crash", step((w) => w.agent((agent, thread) => agent.crash(thread)))],
  ];
  it.effect.each(
    SCHEDULE_ENDS.map(([cut, cutting]) => ({
      title: `a wake the agent scheduled before ${cut} still fires at its time`,
      cutting,
    })),
  )("$title", ({ cutting }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        yield* send(w, "remind yourself in ten minutes");
        const { cron, at } = cronIn(yield* Clock.currentTimeMillis, 10 * MINUTE);
        yield* w.agent((agent, thread) => agent.cronCreate(thread, cron, PROMPT, false));
        yield* cutting(w);
        const fired = () => w.provider.calls.filter((call) => call.endsWith(PROMPT)).length;
        yield* w.advance(at - (yield* Clock.currentTimeMillis) - 1);
        assert.strictEqual(fired(), 0);
        yield* w.advance(1);
        assert.strictEqual(fired(), 1);
        const woken = yield* w.run(r(2));
        assert.deepStrictEqual([woken?.trigger.cause, woken?.joins], ["agent-schedule", null]);
        // A second firing would come within minutes: an hour proves it fires once, where a day of the
        // test clock wakes every periodic timer 86,400 times.
        yield* w.advance(60 * MINUTE);
        assert.strictEqual(fired(), 1);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a wake the agent scheduled fires from its own session while that session lives, never twice",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w, "remind yourself in ten minutes");
          const { cron, at } = cronIn(yield* Clock.currentTimeMillis, 10 * MINUTE);
          yield* w.agent((agent, thread) => agent.cronCreate(thread, cron, PROMPT, false));
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* w.advance(at - (yield* Clock.currentTimeMillis) + MINUTE);
          // The CLI fires it: the engine sends nothing of its own.
          assert.isFalse(w.provider.calls.some((call) => call.endsWith(PROMPT)));
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("a wake the agent cancelled never fires after its session ends", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        yield* send(w, "remind yourself, then never mind");
        const { cron, at } = cronIn(yield* Clock.currentTimeMillis, 10 * MINUTE);
        const job = yield* w.agent((agent, thread) =>
          agent.cronCreate(thread, cron, PROMPT, false),
        );
        yield* w.agent((agent, thread) => agent.cronDelete(thread, job));
        yield* stop(w);
        yield* w.advance(at - (yield* Clock.currentTimeMillis) + MINUTE);
        assert.isFalse(w.provider.calls.some((call) => call.endsWith(PROMPT)));
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a recurring wake the agent scheduled runs once after its session ends, saying it ended",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w, "check every hour");
          yield* w.agent((agent, thread) => agent.cronCreate(thread, "0 * * * *", PROMPT, true));
          yield* stop(w);
          yield* w.advance(2 * 60 * MINUTE);
          const sent = w.provider.calls.filter((call) => call.includes(PROMPT));
          assert.strictEqual(sent.length, 1);
          assert.include(sent[0]!, "ended with its session");
          yield* w.shutdown;
        }),
      ),
  );

  // Milo's rechecks on 0.15.44 and 0.15.45: five kills meant to land mid-answer. On the wire, each
  // answer came whole and its turn closed completed 2–6 s before the kill (the foreground
  // `sleep N; pkill` had not yet fired), and the CLI logged the kill with `turnActive: false`: the
  // model had ended its own answer mid-sentence, as asked to write "until you are cut off".
  it.effect(
    "a turn its agent finished before it was killed reads as worked, and nothing wakes it when nothing was lost",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w, "write about rivers until you are cut off");
          yield* w.agent((agent, thread) => agent.say(thread, "…and eventually to try to"));
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* w.advance(3_000);
          yield* w.agent((agent, thread) => agent.killIdle(thread));
          yield* w.advance(0);
          assert.deepStrictEqual(yield* ending(w, 1), ["ended", "completed", "agent"]);
          assert.isUndefined(yield* w.run(r(2)));
          yield* w.shutdown;
        }),
      ),
  );

  // Milo's final engine run, 2026-10-11 (J9): a killed agent's background job read "stopped", as
  // if the person had stopped it, and nothing woke the Mate. Claude's turn had finished a moment
  // before the kill there; a kill mid-turn ends the run crashed as well.
  describe("background work its agent's crash took wakes the Mate once with a note naming it", () => {
    it.effect.each([
      { when: "while its turn runs", before: () => Effect.void, ended: "crashed" },
      {
        when: "after its turn ended",
        before: (w: EngineWorld) =>
          Effect.gen(function* () {
            yield* w.agent((agent, thread) => agent.say(thread, "The tides rise twice a day."));
            yield* w.agent((agent, thread) => agent.finish(thread));
            // A kill seconds after its end, as Milo's live kills came.
            yield* w.advance(3_000);
          }),
        ended: "completed",
      },
    ])("the work reads lost, never stopped: $when", ({ before, ended }) =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w);
          yield* w.agent((agent, thread) => agent.startWork(thread));
          yield* Effect.orDie(before(w));
          yield* w.agent((agent, thread) => agent.crash(thread));
          yield* w.advance(0);
          assert.strictEqual((yield* w.run(r(1)))?.end?.kind, ended);
          const work = (yield* w.items(r(1))).filter((item) => item.kind === "work");
          assert.deepStrictEqual(
            work.map((item) => item.body.status),
            ["lost"],
          );
          const woken = yield* w.run(r(2));
          assert.deepStrictEqual([woken?.trigger.cause, woken?.state], ["lost-work", "running"]);
          assert.match(
            w.provider.calls.at(-1) ?? "",
            /^send .*: Your background work .+ was stopped when its session ended before it reported\.$/u,
          );
          assert.isUndefined(yield* w.run(r(3)));
          yield* w.shutdown;
        }),
      ),
    );
  });

  // Milo's second stress run, 2026-10-09: Claude's background-result turns ran ahead of a queued
  // "carry on".
  it.effect(
    "a message waiting for its admission goes into Claude's turn of its own and is answered there",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w);
          const work = yield* w.agent((agent, thread) => agent.startWork(thread));
          yield* w.agent((agent, thread) => agent.finish(thread));
          const gate = yield* Deferred.make<void>();
          w.admission.gate = gate;
          yield* send(w, "carry on");
          assert.strictEqual((yield* w.run(r(2)))?.state, "admitted");
          yield* w.agent((agent, thread) => agent.endWork(thread, work));
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
          yield* w.settle;
          assert.strictEqual(w.provider.calls.at(-1), sendLine(w, steeredWith("carry on")));
          assert.deepStrictEqual(
            [(yield* w.run(r(2)))?.state, yield* w.run(r(3))],
            ["running", undefined],
          );
          yield* w.agent((agent, thread) => agent.say(thread, "Carrying on."));
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* Deferred.succeed(gate, void 0);
          yield* w.settle;
          assert.deepStrictEqual(yield* ending(w, 2), ["ended", "completed", "agent"]);
          assert.strictEqual(
            w.provider.calls.filter((call) => call === sendLine(w, steeredWith("carry on"))).length,
            1,
          );
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("only a running run is marked unresponsive; resuming clears the mark", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex");
        yield* send(w);
        yield* w.advance(10 * MINUTE);
        assert.isNotNull((yield* w.run(r(1)))?.unresponsiveSince);
        yield* w.agent((agent, thread) => agent.say(thread, "still here"));
        assert.isNull((yield* w.run(r(1)))?.unresponsiveSince);
        yield* w.agent((agent, thread) => agent.ask(thread, "question"));
        assert.strictEqual((yield* w.run(r(1)))?.state, "waiting");
        yield* w.advance(30 * MINUTE);
        assert.isNull((yield* w.run(r(1)))?.unresponsiveSince);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "streamed text reaches subscribers live and is never written; a late subscriber gets the text so far",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w);
          yield* w.agent((agent, thread) => agent.stream(thread, "live-1", "Hel"));
          const frames = yield* (yield* w.live).subscribe(mate);
          yield* w.agent((agent, thread) => agent.stream(thread, "live-1", "lo"));
          const key = `${r(1)}.i1`;
          const seen = yield* Stream.runCollect(Stream.take(frames, 2));
          assert.deepStrictEqual(
            seen.map((frame) =>
              frame._tag === "Open"
                ? ["Open", frame.items]
                : frame._tag === "Append"
                  ? ["Append", frame.key, frame.text]
                  : [frame._tag],
            ),
            [
              ["Open", [{ key, stream: "text", text: "Hel" }]],
              ["Append", key, "lo"],
            ],
          );
          const streaming = (yield* w.items(r(1))).find((item) => item.kind === "note");
          assert.deepStrictEqual([streaming?.body.text, streaming?.body.streaming], ["", true]);
          yield* w.agent((agent, thread) => agent.finish(thread));
          const written = (yield* w.items(r(1))).find((item) => item.kind === "note");
          assert.deepStrictEqual([written?.body.text, written?.body.streaming], ["Hello", false]);
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("an event for an unowned thread is dropped and counted", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex");
        yield* send(w);
        yield* w.agent((agent) => agent.foreign("helper-thread"));
        yield* w.agent((agent) => agent.foreign("helper-thread"));
        assert.deepStrictEqual([...(yield* (yield* w.pump).foreign)], [["helper-thread", 2]]);
        assert.strictEqual((yield* w.run(r(1)))?.state, "running");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("an idle session closes after 30 minutes", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex");
        yield* send(w);
        yield* w.agent((agent, thread) => agent.finish(thread));
        yield* w.advance(29 * MINUTE);
        assert.notInclude(w.provider.calls, `stop ${w.thread}`);
        yield* w.advance(MINUTE);
        assert.strictEqual(w.provider.calls.at(-1), `stop ${w.thread}`);
        assert.deepStrictEqual(
          (yield* w.sessionsOpen).map((session) => session.close_reason),
          ["idle"],
        );
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("an idle session is kept while its background work lives", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        yield* send(w);
        yield* w.agent((agent, thread) => agent.startWork(thread));
        yield* w.agent((agent, thread) => agent.finish(thread));
        yield* w.advance(30 * MINUTE);
        assert.notInclude(w.provider.calls, `stop ${w.thread}`);
        assert.deepStrictEqual(
          (yield* w.sessionsOpen).map((session) => session.state),
          ["open"],
        );
        assert.isTrue(
          (yield* w.wakes).some((wake) => wake.kind === "session-idle" && wake.state === "armed"),
        );
        yield* w.shutdown;
      }),
    ),
  );

  // Milo, 2026-10-09: helpers ran on after the turn ended, Stop answered "Nothing is running to
  // stop." and the helpers carried on.
  it.effect(
    "Stop after the turn ended stops the helpers still running, and the card shows them stopped",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          yield* send(w);
          yield* w.agent((agent, thread) => agent.startWork(thread));
          yield* w.agent((agent, thread) => agent.startWork(thread));
          yield* w.agent((agent, thread) => agent.finish(thread));
          assert.deepStrictEqual(yield* ending(w, 1), ["ended", "completed", "agent"]);
          const result = yield* stop(w);
          assert.strictEqual(result._tag, "Accepted");
          yield* w.settle;
          assert.strictEqual(w.provider.calls.at(-1), `stop ${w.thread}`);
          assert.deepStrictEqual(
            (yield* w.items(r(1)))
              .filter((item) => item.kind === "work")
              .map((item) => item.body.status),
            ["stopped", "stopped"],
          );
          assert.deepStrictEqual(
            (yield* w.sessionsOpen).map((session) => session.close_reason),
            ["stop"],
          );
          yield* w.advance(0);
          assert.isUndefined(yield* w.run(r(2)));
          // The next message tells the agent who stopped its work: never read as a restart.
          yield* send(w, "again");
          assert.strictEqual(
            w.provider.calls.at(-1),
            sendLine(
              w,
              "Your background work “Watch the build” and “Watch the build” were stopped by the person before they reported.\n\nagain",
            ),
          );
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("signing out stops the session and ends its run", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex");
        yield* send(w);
        yield* (yield* w.engine).stopSessionsOn(["codex"], "sign-out");
        yield* w.settle;
        assert.strictEqual(w.provider.calls.at(-1), `stop ${w.thread}`);
        const run = yield* w.run(r(1));
        assert.deepStrictEqual([run?.end?.kind, run?.source], ["crashed", "inferred-from-close"]);
        assert.deepStrictEqual(
          (yield* w.sessionsOpen).map((session) => session.close_reason),
          ["signed-out"],
        );
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a conversation the boot cannot recover is retried on its own, and every other one runs",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("codex");
          const other = ConversationId.make("other");
          yield* w.tell(
            {
              _tag: "AssignAgent",
              agent: {
                instanceId: "codex",
                driver: "codex",
                model: "m1",
                profile: { kind: "mate" },
              },
            },
            undefined,
            other,
          );
          yield* send(w);
          // The Mate's record is damaged: it cannot be loaded, so it cannot be told what the restart cut.
          yield* w.within(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* sql`UPDATE engine_event SET payload_json = '{' WHERE conversation_id = ${mate}
              AND seq = (SELECT max(seq) FROM engine_event WHERE conversation_id = ${mate})`;
              yield* sql`UPDATE engine_conversation SET snapshot_json = NULL, snapshot_seq = NULL
              WHERE conversation_id = ${mate}`;
            }),
          );
          yield* w.crash;
          yield* w.boot;
          yield* w.tell({ _tag: "Send", text: "still here" }, undefined, other);
          assert.include(w.provider.calls, "send other/s/1: still here");
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("a Stop asked while the message is being sent stops the turn the moment it opens", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex", { scripted: { slowSendMs: 300 } });
        yield* send(w);
        assert.strictEqual((yield* w.run(r(1)))?.state, "sending");
        yield* stop(w);
        yield* w.advance(300);
        assert.deepStrictEqual(yield* ending(w, 1), ["ended", "stopped", "stop-confirmed"]);
        assert.strictEqual(w.provider.calls.at(-1), `interrupt ${w.thread} T1`);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a Stop the driver never answers lets the second Stop close the session; the call is bounded",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("codex", { scripted: { interruptHangs: true } });
          yield* send(w);
          yield* stop(w);
          yield* stop(w);
          assert.deepStrictEqual(yield* ending(w, 1), ["ended", "stopped", "inferred-from-close"]);
          assert.strictEqual(w.provider.calls.at(-1), `stop ${w.thread}`);
          // The wedged interrupt settles as timed out: an effect's outcome, never the run's.
          yield* w.advance(PROVIDER_CALL_BOUND_MS);
          const outcome = yield* w.within(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              return yield* sql<{ readonly kind: string }>`
              SELECT json_extract(outcome_json, '$.kind') AS kind FROM engine_effect
              WHERE kind = 'provider.interrupt'`;
            }),
          );
          assert.deepStrictEqual(
            outcome.map((row) => row.kind),
            ["timed-out"],
          );
          assert.deepStrictEqual(yield* ending(w, 1), ["ended", "stopped", "inferred-from-close"]);
          yield* w.shutdown;
        }),
      ),
  );

  // The engine interrupts the call rather than leaving it running: ProviderService then stops
  // whatever session the start opened, which nothing would stop otherwise.
  it.effect("a session open the driver never answers is let go at the bound", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex", { scripted: { startHangs: true } });
        yield* send(w);
        yield* w.advance(PROVIDER_CALL_BOUND_MS);
        assert.strictEqual(w.provider.calls.at(-1), `let-go ${w.thread}`);
        const outcome = yield* w.within(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ readonly kind: string }>`
              SELECT json_extract(outcome_json, '$.kind') AS kind FROM engine_effect
              WHERE kind = 'session.open'`;
          }),
        );
        assert.deepStrictEqual(
          outcome.map((row) => row.kind),
          ["timed-out"],
        );
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a server stopping never waits on a wedged call", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex", { scripted: { interruptHangs: true } });
        yield* send(w);
        yield* stop(w);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a conversation moved to another instance starts a fresh native session on a thread of its own",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("codex");
          yield* send(w);
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* w.tell({
            _tag: "AssignAgent",
            agent: {
              instanceId: "codex-bo",
              driver: "codex",
              model: "m1",
              profile: { kind: "mate" },
            },
          });
          yield* send(w, "again");
          assert.deepStrictEqual(w.provider.calls.slice(-3), [
            `stop ${w.thread}`,
            "start mate/s/2",
            "send mate/s/2: again",
          ]);
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("a conversation's host is let go once its session closed and nothing waits on it", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex");
        yield* send(w);
        yield* w.agent((agent, thread) => agent.finish(thread));
        yield* w.advance(30 * MINUTE);
        assert.strictEqual(w.provider.calls.at(-1), `stop ${w.thread}`);
        yield* w.advance(10 * MINUTE);
        assert.isUndefined(yield* (yield* w.pump).existing(mate));
        yield* send(w, "back");
        assert.strictEqual(w.provider.calls.at(-1), sendLine(w, "back"));
        yield* w.shutdown;
      }),
    ),
  );

  // The settings a person picks reach every driver as V1 sends them: options and plan mode with
  // each message, the runtime mode when its session opens (V1: `ProviderCommandReactor`).
  it.effect.each(
    Array.from(DRIVERS, (driver) => ({
      title: `a message carries the conversation's model options and its interaction mode; a runtime mode change reopens the session with it (${driver})`,
      driver,
    })),
  )("$title", ({ driver }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world(driver);
        const effort = [{ id: "effort", value: "high" }];
        yield* w.tell({ _tag: "SwitchModel", model: "m1", options: effort });
        yield* w.tell({ _tag: "Send", text: "plan it", interactionMode: "plan" });
        assert.deepInclude(w.provider.sends.at(-1), {
          modelSelection: { instanceId: driver, model: "m1", options: effort },
          interactionMode: "plan",
        });
        assert.deepInclude(w.provider.starts.at(-1), { runtimeMode: "full-access" });
        yield* w.agent((agent, thread) => agent.finish(thread));
        yield* w.tell({ _tag: "SetRuntimeMode", runtimeMode: "approval-required" });
        yield* send(w, "next");
        assert.deepStrictEqual(w.provider.calls.slice(-3), [
          `stop ${w.thread}`,
          `start ${w.thread}`,
          sendLine(w, "next"),
        ]);
        assert.deepInclude(w.provider.starts.at(-1), { runtimeMode: "approval-required" });
        assert.notProperty(w.provider.sends.at(-1), "interactionMode");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect.each(
    Array.from(DRIVERS, (driver) => ({
      title: `a model option goes with the next message where the driver reads it per turn, else in a new session (${driver})`,
      driver,
    })),
  )("$title", ({ driver }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world(driver);
        yield* send(w, "first");
        yield* w.agent((agent, thread) => agent.finish(thread));
        const fast = [{ id: "fastMode", value: true }];
        yield* w.tell({ _tag: "SwitchModel", model: "m1", options: fast });
        yield* send(w, "fast");
        const starts = w.provider.calls.filter((call) => call.startsWith("start")).length;
        assert.strictEqual(starts, driver === "claudeAgent" ? 2 : 1);
        assert.deepInclude(w.provider.sends.at(-1), {
          modelSelection: { instanceId: driver, model: "m1", options: fast },
        });
        yield* w.agent((agent, thread) => agent.finish(thread));
        const effort = [{ id: driver === "codex" ? "reasoningEffort" : "effort", value: "low" }];
        yield* w.tell({ _tag: "SwitchModel", model: "m1", options: [...fast, ...effort] });
        yield* send(w, "low effort");
        assert.strictEqual(
          w.provider.calls.filter((call) => call.startsWith("start")).length,
          starts,
        );
        assert.deepInclude(w.provider.sends.at(-1), {
          modelSelection: { instanceId: driver, model: "m1", options: [...fast, ...effort] },
        });
        if (driver === "codex") {
          yield* w.agent((agent, thread) => agent.finish(thread));
          const options = [...fast, ...effort, { id: "contextWindow", value: "272000" }];
          yield* w.tell({ _tag: "SwitchModel", model: "m1", options });
          yield* send(w, "new context window");
          assert.strictEqual(
            w.provider.calls.filter((call) => call.startsWith("start")).length,
            starts + 1,
          );
          assert.deepInclude(w.provider.starts.at(-1), {
            modelSelection: { instanceId: driver, model: "m1", options },
          });
          assert.deepInclude(w.provider.sends.at(-1), {
            modelSelection: { instanceId: driver, model: "m1", options },
          });
        }
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a message's files reach the driver with it, by the id they were uploaded under", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("codex");
        const file = {
          type: "file" as const,
          id: "file-1",
          name: "notes.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4096,
        };
        yield* w.tell({ _tag: "Send", text: "read this", attachments: [file as never] });
        assert.deepInclude(w.provider.sends.at(-1), { attachments: [file] });
        yield* w.shutdown;
      }),
    ),
  );
});

/**
 * Claude's helpers and background work as its adapter reports them: a helper's own calls carry the
 * launch they run under and the helper's task (`agentId`), a task a helper's tool started names that
 * helper as its owner, and every report of a task repeats its linkage (`ClaudeAdapter`
 * `taskLinkageFor`).
 */
describe("Claude's helpers and background work, as the engine records them", () => {
  const claude = (w: EngineWorld) => ({
    call: (
      id: string,
      args: Record<string, unknown>,
      owner: { readonly helper: string; readonly launch: string } | null = null,
      tool = "Bash",
      result = "",
    ) =>
      w.agent((agent, thread) =>
        Effect.gen(function* () {
          const head = {
            itemType: tool === "Agent" ? "collab_agent_tool_call" : "command_execution",
            title: tool === "Agent" ? "Subagent task" : "Command run",
            ...(owner === null ? {} : { agentId: owner.helper, parentToolUseId: owner.launch }),
          };
          yield* agent.emit("item.started", thread, {
            itemId: id,
            payload: { ...head, status: "inProgress", data: { toolName: tool, input: args } },
          });
          yield* agent.emit("item.completed", thread, {
            itemId: id,
            payload: {
              ...head,
              status: "completed",
              data: {
                toolName: tool,
                input: args,
                result: { type: "tool_result", content: result },
              },
            },
          });
        }),
      ),
    task: (type: "task.started" | "task.completed", payload: Record<string, unknown>) =>
      w.agent((agent, thread) => agent.emit(type, thread, { payload })),
  });

  const works = (w: EngineWorld, n: number) =>
    Effect.map(w.items(r(n)), (items) => items.filter((item) => item.kind === "work"));

  // Milo's second stress run drew a helper's background sleep as the Mate's own job, and a nested
  // helper among the Mate's helpers.
  it.effect("a helper's own background job and helper are recorded as that helper's", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        const c = claude(w);
        yield* send(w);
        yield* c.call(
          "toolu_h",
          { description: "Look into it", run_in_background: true },
          null,
          "Agent",
        );
        yield* c.task("task.started", {
          taskId: "ah",
          description: "Look into it",
          taskType: "local_agent",
          toolUseId: "toolu_h",
        });
        const owner = { helper: "ah", launch: "toolu_h" };
        yield* c.call("toolu_j", { command: "sleep 30", run_in_background: true }, owner);
        yield* c.task("task.started", {
          taskId: "bj",
          description: "Sleep",
          taskType: "local_bash",
          agentId: "ah",
          toolUseId: "toolu_j",
        });
        yield* c.call("toolu_n", { description: "Dig deeper" }, owner, "Agent");
        yield* c.task("task.started", {
          taskId: "an",
          description: "Dig deeper",
          taskType: "local_agent",
          agentId: "ah",
          toolUseId: "toolu_n",
        });
        const [helper, job, nested] = yield* works(w, 1);
        assert.deepStrictEqual(
          [helper?.by, job?.by, nested?.by],
          [
            { kind: "mate" },
            { kind: "helper", helperId: helper?.body.work },
            { kind: "helper", helperId: helper?.body.work },
          ],
        );
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a helper's own call goes on under the run that started its helper, never the next message's",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          const c = claude(w);
          yield* send(w);
          yield* c.call("toolu_h", { description: "Look into it" }, null, "Agent");
          yield* c.task("task.started", {
            taskId: "ah",
            description: "Look into it",
            taskType: "local_agent",
            toolUseId: "toolu_h",
          });
          yield* w.agent((agent, thread) => agent.finish(thread));
          yield* send(w, "second");
          yield* c.call("toolu_x", { command: "ls" }, { helper: "ah", launch: "toolu_h" });
          const calls = (n: number) =>
            Effect.map(w.items(r(n)), (items) =>
              items.flatMap((item) =>
                item.kind === "call" ? [(item.body.tool as { readonly name: string }).name] : [],
              ),
            );
          assert.deepStrictEqual([yield* calls(1), yield* calls(2)], [["Agent", "Bash"], []]);
          yield* w.shutdown;
        }),
      ),
  );

  // Kara's cross-monorepo job: three background helpers worked on after the turn that started them
  // ended; each of their calls came back, yet the helpers' panel read every one "No result" (zcp's
  // "Used Lease a pool container — No result") and kept none of what it came back with.
  it.effect.each([
    {
      what: "a zcp call",
      tool: "mcp__zerops__zerops_lease",
      itemType: "mcp_tool_call",
      title: "MCP tool call",
      input: { action: "acquire", pools: ["hqpool"], branch: "build-stamp" },
      result: [{ type: "text", text: '{"leases":[{"alias":"hqpool-6","branch":"build-stamp"}]}' }],
      says: "hqpool-6",
    },
    {
      what: "a command",
      tool: "Bash",
      itemType: "command_execution",
      title: "Command run",
      input: { command: "git status -sb" },
      result: "## build-stamp...origin/build-stamp",
      says: "## build-stamp",
    },
  ])(
    "a helper's call that comes back after the turn that started its helper ended reads done, with what it came back with: $what",
    ({ tool, itemType, title, input, result, says }) =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          const c = claude(w);
          yield* send(w);
          yield* c.call(
            "toolu_h",
            { description: "Shared build stamp", run_in_background: true },
            null,
            "Agent",
          );
          yield* c.task("task.started", {
            taskId: "ah",
            description: "Shared build stamp",
            taskType: "local_agent",
            toolUseId: "toolu_h",
          });
          yield* w.agent((agent, thread) => agent.finish(thread));
          assert.deepStrictEqual(yield* ending(w, 1), ["ended", "completed", "agent"]);
          const head = { itemType, title, agentId: "ah", parentToolUseId: "toolu_h" };
          yield* w.agent((agent, thread) =>
            agent.emit("item.started", thread, {
              itemId: "toolu_x",
              payload: { ...head, status: "inProgress", data: { toolName: tool, input } },
            }),
          );
          yield* w.agent((agent, thread) =>
            agent.emit("item.completed", thread, {
              itemId: "toolu_x",
              payload: {
                ...head,
                status: "completed",
                data: {
                  toolName: tool,
                  input,
                  result: { type: "tool_result", tool_use_id: "toolu_x", content: result },
                },
              },
            }),
          );
          const call = (yield* w.items(r(1))).find(
            (item) => item.kind === "call" && item.by.kind === "helper",
          );
          assert.strictEqual(call?.body.state, "done");
          const engine = yield* w.engine;
          const [kept] = yield* w.within(engine.callData(mate, { itemIds: [call!.item_id] }));
          assert.include(JSON.stringify(kept?.data ?? null), says);
          yield* w.shutdown;
        }),
      ),
  );

  // Milo's final engine run (seg E +1:32): in Supervised, two helpers' commands needed approval
  // after the turn ended; nothing reached the person and the run waited on its helpers for good.
  it.effect(
    "a helper's command that needs approval asks the person, and the run continues once they allow it",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          const c = claude(w);
          yield* send(w);
          yield* c.call("toolu_h", { description: "Review the API" }, null, "Agent");
          const helper = {
            taskId: "ah",
            description: "Review the API",
            taskType: "local_agent",
            toolUseId: "toolu_h",
          };
          yield* c.task("task.started", helper);
          yield* w.agent((agent, thread) => agent.finish(thread));
          assert.deepStrictEqual(yield* ending(w, 1), ["ended", "completed", "agent"]);
          yield* w.agent((agent, thread) =>
            agent.emit("item.started", thread, {
              itemId: "toolu_x",
              payload: {
                itemType: "command_execution",
                title: "Command run",
                agentId: "ah",
                parentToolUseId: "toolu_h",
                status: "inProgress",
                data: { toolName: "Bash", input: { command: "for f in *; do wc -l $f; done" } },
              },
            }),
          );
          const asked = yield* w.agent((agent, thread) =>
            agent.ask(thread, "approval", {
              agentId: "ah",
              parentToolUseId: "toolu_h",
              call: "toolu_x",
            }),
          );
          const [request] = yield* w.requests;
          assert.deepStrictEqual([request?.run_id, request?.state], [r(1), "open"]);
          const view = yield* w.within(readConversationView(mate));
          assert.deepStrictEqual(view === undefined ? undefined : rowStateOf(view), {
            kind: "waiting",
            on: "approval",
            words: "rm -rf dist",
          });
          yield* w.tell({
            _tag: "Answer",
            requestId: RequestId.make(request!.request_id),
            answer: "accept",
            summary: "Approve",
          });
          assert.include(w.provider.calls, `approve ${asked} accept`);
          assert.strictEqual((yield* w.requests)[0]?.state, "answered");
          yield* c.task("task.completed", { ...helper, status: "completed", summary: "Done." });
          yield* w.agent((agent, thread) => agent.selfTurn(thread));
          const [work] = yield* works(w, 1);
          const woken = yield* w.run(r(2));
          assert.deepStrictEqual(
            [work?.body.status, woken?.trigger.kind, woken?.joins],
            ["completed", "wake", r(1)],
          );
          yield* w.shutdown;
        }),
      ),
  );

  // Milo's stress run 4: helper B reported, then its own job's end re-woke it, and the helpers'
  // surface read the re-wake's "has now exited with code 4 … No action needed" for its report.
  it.effect("a helper's entry keeps the report it returned, not a re-wake's later words", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent");
        const c = claude(w);
        yield* send(w);
        yield* c.call("toolu_h", { description: "Start a failing job" }, null, "Agent");
        const helper = {
          taskId: "ah",
          description: "Start a failing job",
          taskType: "local_agent",
          toolUseId: "toolu_h",
        };
        yield* c.task("task.started", helper);
        yield* c.task("task.completed", {
          ...helper,
          status: "completed",
          summary: "Started `sh -c 'sleep 10; exit 4'` in the background as job bll6s0e1g.",
        });
        yield* c.task("task.started", helper);
        yield* c.task("task.completed", {
          ...helper,
          status: "completed",
          summary: "The background job (ID `bll6s0e1g`) has now exited with code 4, as expected.",
        });
        const [entry] = yield* works(w, 1);
        assert.deepStrictEqual(
          [entry?.body.status, entry?.body.report],
          ["completed", "Started `sh -c 'sleep 10; exit 4'` in the background as job bll6s0e1g."],
        );
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a background job's record names the call that started it and the line it ended with",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          const c = claude(w);
          yield* send(w);
          yield* c.call(
            "toolu_j",
            { command: "exit 3", run_in_background: true },
            null,
            "Bash",
            "Command running in background with ID: bj.",
          );
          yield* c.task("task.started", {
            taskId: "bj",
            description: "Fail on purpose",
            taskType: "local_bash",
            toolUseId: "toolu_j",
          });
          yield* c.task("task.completed", {
            taskId: "bj",
            status: "failed",
            summary: 'Background command "Fail on purpose" failed with exit code 3',
            taskType: "local_bash",
            toolUseId: "toolu_j",
          });
          const items = yield* w.items(r(1));
          const call = items.find((item) => item.kind === "call");
          const [job] = yield* works(w, 1);
          assert.deepStrictEqual(
            [job?.body.call, job?.body.status, job?.body.report],
            [
              call?.item_id,
              "failed",
              'Background command "Fail on purpose" failed with exit code 3',
            ],
          );
          yield* w.shutdown;
        }),
      ),
  );

  // Milo's run 2 rig: the job a person's Stop killed read "didn't report back".
  it.effect(
    "background work a person's Stop killed with Claude's session is recorded stopped",
    () =>
      scene(
        Effect.gen(function* () {
          const w = yield* world("claudeAgent");
          const c = claude(w);
          yield* send(w);
          yield* c.call("toolu_j", { command: "sleep 120", run_in_background: true });
          yield* c.task("task.started", {
            taskId: "bj",
            description: "Sleep two minutes",
            taskType: "local_bash",
            toolUseId: "toolu_j",
          });
          yield* stop(w);
          const [job] = yield* works(w, 1);
          assert.strictEqual(job?.body.status, "stopped");
          yield* w.shutdown;
        }),
      ),
  );
});

// S21-02: the person stopped a Mate whose helper went on changing their app; the turn ended, the
// helper did not, and a second Stop later read as a restart.
describe("one Stop stops the turn and everything it started", () => {
  it.effect.each(
    Array.from(DRIVERS, (driver) => ({
      title: `a stop ends the turn and the helpers it started, and nothing restarts (${driver})`,
      driver,
    })),
  )("$title", ({ driver }) =>
    scene(
      Effect.gen(function* () {
        const w = yield* world(driver);
        yield* send(w, "change the shop's checkout");
        yield* w.agent((agent, thread) => agent.startWork(thread));
        const result = yield* stop(w);
        assert.strictEqual(result._tag, "Accepted");
        yield* w.settle;
        assert.deepStrictEqual((yield* ending(w, 1)).slice(0, 2), ["ended", "stopped"]);
        assert.deepStrictEqual(
          (yield* w.items(r(1)))
            .filter((item) => item.kind === "work")
            .map((item) => item.body.status),
          ["stopped"],
        );
        const view = yield* w.within(readConversationView(mate));
        assert.deepStrictEqual(view === undefined ? undefined : rowStateOf(view), {
          kind: "idle",
        });
        // Nothing came up again on its own: one session start, no run after the stopped one.
        assert.strictEqual(w.provider.calls.filter((call) => call.startsWith("start ")).length, 1);
        yield* w.advance(0);
        assert.isUndefined(yield* w.run(r(2)));
        // The Mate takes the next message at once.
        yield* send(w, "carry on");
        assert.strictEqual((yield* w.run(r(2)))?.state, "running");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a Stop the agent has not answered yet reads as stopping on the Mate's row", () =>
    scene(
      Effect.gen(function* () {
        const w = yield* world("claudeAgent", { scripted: { interruptHangs: true } });
        yield* send(w, "change the shop's checkout");
        const row = Effect.map(w.within(readConversationView(mate)), (view) =>
          view === undefined ? undefined : rowStateOf(view),
        );
        assert.notProperty(yield* row, "stopping");
        yield* stop(w);
        yield* w.settle;
        assert.deepInclude(yield* row, { kind: "working", stopping: true });
        yield* w.shutdown;
      }),
    ),
  );
});
