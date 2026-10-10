import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ConversationId,
  RequestId,
  SessionId,
  WakeId,
  effectId,
  requestId,
  runId,
  wakeId,
  type ChatFileAttachment,
  type ChatImageAttachment,
  type EffectOutcome,
  type EngineEventTag,
  type ItemBody,
  type KnownEngineEvent,
  type Principal,
  type RejectionReason,
  type RunEndSource,
  type RunState,
  type TurnEndSource,
  type TurnHandle,
} from "@t3tools/contracts";

import type { TurnOutcome } from "../bridge/spi3.ts";

import type { Command, Decision, EffectDraft, ProviderSignal } from "./command.ts";
import {
  AGENT_TURN_DUE_MS,
  BACKGROUND_WORK_WORDS,
  CONTINUE_TEXT,
  SESSION_IDLE_MS,
  WATCHDOG_SILENCE_MS,
  decide,
  resentText,
} from "./decide.ts";
import { makeTranslator } from "../bridge/translate.ts";
import { makeToCore } from "../pump/toCore.ts";
import { readGolden } from "../testing/bridge/goldens.ts";
import { commandLogAround } from "../testing/bridge/record.ts";
import { fold, stampEvents } from "./evolve.ts";
import { initialState, type ConversationState } from "./state.ts";

const conversation = ConversationId.make("mate");
const ana: Principal = { kind: "person", subject: "ana" };
const bo: Principal = { kind: "person", subject: "bo" };
const T0 = 1_000_000_000;
const MINUTE = 60_000;
const r = (n: number) => runId(conversation, n);
/** The engine's handle for run n's turn: the run's own id. */
const T = (n: number) => r(n) as string as TurnHandle;
const s1 = SessionId.make("s1");

interface Input {
  readonly command: Command;
  readonly by?: Principal;
  readonly at?: number;
}
type Step = Command | Input;

interface Scene {
  readonly state: ConversationState;
  readonly decision: Decision;
  readonly events: ReadonlyArray<KnownEngineEvent>;
  readonly effects: ReadonlyArray<EffectDraft>;
}

/** Plays commands through decide and evolve; the scene describes the last one. */
const play = (
  steps: ReadonlyArray<Step>,
  from: ConversationState = initialState(conversation),
): Scene => {
  let state = from;
  let now = T0;
  let scene: Scene | undefined;
  steps.forEach((step, index) => {
    const input: Input = "_tag" in step ? { command: step } : step;
    now = input.at ?? now;
    const envelope = {
      commandId: CommandId.make(`c${index}`),
      conversationId: conversation,
      principal: input.by ?? ana,
      command: input.command,
    };
    const decision = decide(state, envelope, now);
    const events =
      decision._tag === "Accept"
        ? stampEvents(state.headSeq, envelope, decision.step.events, now)
        : [];
    state = fold(state, events);
    scene = {
      state,
      decision,
      events,
      effects: decision._tag === "Accept" ? decision.step.effects : [],
    };
  });
  return scene!;
};

/** A record as an older snapshot kept it: no rotation field at all (main's version 8). */
const withoutRotation = (state: ConversationState): ConversationState => {
  const { rotation: _rotation, ...older } = state;
  return older as ConversationState;
};

describe("a record kept before the rotation was", () => {
  it("opens a session for its next send", () => {
    const scene = play([send(), prepared(1)], withoutRotation(initialState(conversation)));
    expect(scene.effects.map((effect) => effect.kind)).toContain("session.open");
  });

  it("keeps the healthy session it has open for its next send", () => {
    const before = play([...running, turnEnded]).state;
    const scene = play([send("again", {}), prepared(2)], withoutRotation(before));
    expect(scene.effects.map((effect) => effect.kind)).toEqual(["provider.send"]);
  });
});

// ── commands ────────────────────────────────────────────────────────────────────────────────

const send = (
  text = "hello",
  extra: Partial<Extract<Command, { _tag: "Send" }>> = {},
): Command => ({
  _tag: "Send",
  text,
  ...extra,
});
const settled = (
  cause: string,
  kind: string,
  outcome: Extract<Command, { _tag: "EffectSettled" }>["outcome"],
  n = 1,
): Command => ({ _tag: "EffectSettled", effectId: effectId(cause, kind, n), outcome });
const opened = (
  run: number,
  options: { session?: string; steer?: boolean; selfTurns?: boolean; n?: number } = {},
) =>
  settled(
    r(run),
    "session.open",
    {
      kind: "ok",
      value: {
        sessionId: options.session ?? "s1",
        driver: "claude",
        model: null,
        nativeRef: "native-1",
        capabilities: {
          steer: options.steer ?? false,
          ...(options.selfTurns === undefined ? {} : { selfTurns: options.selfTurns }),
        },
      },
    },
    options.n,
  );
const sent = (run: number) => settled(r(run), "provider.send", { kind: "ok" });
/** Run n's workspace capture settles: its send may go. */
const prepared = (run: number, outcome: EffectOutcome = { kind: "ok" }) =>
  settled(r(run), "run.prepare", outcome);
/** The session closed as the engine asked. */
const sessionClosed = (session = "s1") => settled(session, "session.close", { kind: "ok" });
const signal = (...signals: ReadonlyArray<ProviderSignal>): Command => ({
  _tag: "ProviderSignals",
  sessionId: s1,
  signals,
});
const ask = { kind: "approval", requestKind: "command", detail: "rm -rf build" } as const;
const requestOpened = (key = "q1", answerable = true) =>
  signal({ kind: "request-opened", key, ask, answerable });
const ended = (
  n = 1,
  outcome: TurnOutcome = { kind: "completed" },
  source: TurnEndSource = "agent",
): Command => signal({ kind: "turn-ended", turn: T(n), outcome, source });
const turnEnded = ended(1);
const stop = (run?: number): Command =>
  run === undefined ? { _tag: "Stop" } : { _tag: "Stop", runId: r(run) };
const recovered = (cut: ReadonlyArray<string> = []): Command => ({
  _tag: "Recovered",
  bootId: "boot-2" as never,
  cutEffects: cut.map((id) => id as never),
});
const fired = (kind: string, key: string, at?: number): Input => ({
  command: { _tag: "WakeFired", wakeId: wakeId(conversation, kind, key) },
  ...(at === undefined ? {} : { at }),
});
const note = (key: string) =>
  ({ kind: "note", text: `note ${key}`, streaming: true, answer: false }) as const;

// ── scenes ──────────────────────────────────────────────────────────────────────────────────

const running: ReadonlyArray<Step> = [send(), prepared(1), opened(1), sent(1)];
const waiting: ReadonlyArray<Step> = [...running, requestOpened()];
const runningWithSteer: ReadonlyArray<Step> = [
  send(),
  prepared(1),
  opened(1, { steer: true }),
  sent(1),
];
const limited: ReadonlyArray<Step> = [
  ...running,
  signal({ kind: "usage-limit", resetsAt: T0 + 60 * MINUTE }),
];

interface Row {
  readonly name: string;
  readonly given: ReadonlyArray<Step>;
  readonly when: Step;
  readonly events?: ReadonlyArray<EngineEventTag>;
  readonly effects?: ReadonlyArray<string>;
  readonly run?: {
    readonly n: number;
    readonly state?: RunState;
    readonly end?: string;
    readonly source?: RunEndSource;
    readonly joins?: number | null;
    readonly cause?: string;
    readonly principal?: Principal;
  };
  readonly also?: (scene: Scene) => void;
}

const tags = (scene: Scene) => scene.events.map((event) => event._tag);

const transitions: ReadonlyArray<Row> = [
  {
    name: "a person's message queues a run and captures its workspace before anything is sent",
    given: [],
    when: send(),
    events: ["RunQueued", "ItemOpened", "RunAdmitted", "EffectRequested"],
    effects: ["run.prepare"],
    run: { n: 1, state: "admitted", principal: ana },
    also: (scene) =>
      expect(scene.effects[0]).toMatchObject({
        lane: "side",
        class: "replay-safe",
        // Admission is asked at the capture, for whom the run acts and why it runs.
        payload: { runId: r(1), principal: ana, trigger: { kind: "person" } },
      }),
  },
  {
    name: "a captured run asks for a session when none is open",
    given: [send()],
    when: prepared(1),
    events: ["EffectOutcomeRecorded", "EffectRequested"],
    effects: ["session.open"],
    run: { n: 1, state: "admitted" },
  },
  {
    name: "a capture that failed still sends the message, its gap recorded under the run",
    given: [send()],
    when: prepared(1, { kind: "failed", reason: "ssh timed out" }),
    events: ["EffectOutcomeRecorded", "ItemOpened", "ItemClosed", "EffectRequested"],
    effects: ["session.open"],
    also: (scene) =>
      expect(scene.events[1]).toMatchObject({
        runId: r(1),
        by: { kind: "engine" },
        body: { kind: "marker", marker: { kind: "capture-gap" } },
      }),
  },
  {
    name: "a capture records each service it could not snapshot",
    given: [send()],
    when: prepared(1, {
      kind: "ok",
      value: { gaps: [{ service: "api", reason: "Snapshot refused: disk full" }] },
    }),
    events: ["EffectOutcomeRecorded", "ItemOpened", "ItemClosed", "EffectRequested"],
    also: (scene) =>
      expect(scene.events[1]).toMatchObject({
        body: { marker: { kind: "capture-gap", reason: "api: Snapshot refused: disk full" } },
      }),
  },
  {
    name: "a run its admission refuses ends failed before anything of it ran",
    given: [send()],
    when: prepared(1, { kind: "failed", reason: "the signer is offboarded", refused: true }),
    run: { n: 1, end: "failed", source: "inferred-from-effect" },
    also: (scene) =>
      expect(scene.effects.map((effect) => effect.kind)).toEqual(["workspace.finish"]),
  },
  {
    name: "a maintenance turn skips the capture",
    given: [],
    when: send("/compact", { maintenance: true }),
    // Admitted like any run (D6), nothing captured.
    effects: ["run.prepare"],
    also: (scene) => expect(scene.effects[0]).toMatchObject({ payload: { capture: false } }),
  },
  {
    name: "every run that asked for a capture releases it when it ends",
    given: running,
    when: turnEnded,
    effects: ["workspace.finish"],
    also: (scene) =>
      expect(scene.effects[0]).toMatchObject({
        // The release finds the capture by the turn the run's message went into.
        payload: { runId: r(1), started: true, providerTurnId: null },
      }),
  },
  {
    name: "an opened session sends the admitted run",
    given: [send(), prepared(1)],
    when: opened(1),
    events: ["EffectOutcomeRecorded", "SessionOpened", "EffectRequested", "RunSending"],
    effects: ["provider.send"],
    run: { n: 1, state: "sending" },
  },
  {
    name: "the provider accepting the send starts the run and delivers the message",
    given: [send(), prepared(1), opened(1)],
    when: sent(1),
    events: ["EffectOutcomeRecorded", "RunStarted", "ItemUpdated", "WakeArmed"],
    run: { n: 1, state: "running" },
    also: (scene) =>
      expect(scene.events.find((event) => event._tag === "ItemUpdated")).toMatchObject({
        body: { kind: "person", delivery: { state: "delivered" } },
      }),
  },
  {
    name: "a turn-started signal starts a run still sending",
    given: [send(), prepared(1), opened(1)],
    when: signal({ kind: "turn-started", turn: T(1), origin: "engine", providerTurnId: "t1" }),
    events: ["RunStarted", "ItemUpdated", "WakeArmed"],
    run: { n: 1, state: "running" },
  },
  {
    name: "a message while a run is active queues behind it",
    given: running,
    when: send("and also"),
    events: ["RunQueued", "ItemOpened"],
    run: { n: 2, state: "queued" },
  },
  {
    name: "a message on an open idle session is sent at once",
    given: [...running, turnEnded, send("again")],
    when: prepared(2),
    events: ["EffectOutcomeRecorded", "EffectRequested", "RunSending"],
    effects: ["provider.send"],
    run: { n: 2, state: "sending" },
  },
  {
    name: "a request makes the run wait",
    given: running,
    when: requestOpened(),
    events: ["RequestOpened", "RunWaiting", "WakeCancelled"],
    run: { n: 1, state: "waiting" },
  },
  {
    name: "an answer goes to the provider and resumes the waiting run",
    given: waiting,
    when: {
      _tag: "Answer",
      requestId: requestId(r(1), 1),
      answer: { decision: "accept" },
      summary: "Allowed",
    },
    events: ["EffectRequested", "RequestAnswered", "RunResumed", "WakeArmed"],
    effects: ["provider.respond"],
    run: { n: 1, state: "running" },
  },
  {
    name: "a request the provider closes resumes the run",
    given: waiting,
    when: signal({ kind: "request-closed", key: "q1", state: "dismissed" }),
    events: ["RequestClosed", "RunResumed", "WakeArmed"],
    run: { n: 1, state: "running" },
  },
  {
    name: "the agent ending its turn completes the run and admits the next",
    given: [...running, send("next")],
    when: turnEnded,
    events: ["WakeCancelled", "RunEnded", "EffectRequested", "RunAdmitted", "EffectRequested"],
    effects: ["workspace.finish", "run.prepare"],
    run: { n: 1, end: "completed", source: "agent" },
    also: (scene) => expect(scene.state.runs[r(2)]?.state).toBe("admitted"),
  },
  {
    name: "a failed turn ends failed, said by the agent",
    given: running,
    when: ended(1, { kind: "failed", class: "provider", words: "overloaded" }),
    run: { n: 1, end: "failed", source: "agent" },
  },
  {
    name: "items open, update and close by the driver's key",
    given: running,
    when: signal(
      { kind: "item-opened", turn: T(1), key: "k", by: { kind: "mate" }, body: note("k") },
      { kind: "item-updated", turn: T(1), key: "k", body: note("k2") },
      { kind: "item-closed", turn: T(1), key: "k", body: { ...note("k3"), streaming: false } },
    ),
    events: ["ItemOpened", "ItemUpdated", "ItemClosed"],
    also: (scene) => expect(scene.events[0]).toMatchObject({ itemId: `${r(1)}/i/2`, key: "k" }),
  },
  {
    name: "a run's end closes its open items and lapses its requests",
    given: [
      ...waiting,
      signal({ kind: "item-opened", turn: T(1), key: "k", by: { kind: "mate" }, body: note("k") }),
    ],
    when: signal({ kind: "session-exited", reason: "exit 137" }),
    events: ["ItemClosed", "RequestClosed", "RunEnded", "EffectRequested", "SessionClosed"],
    run: { n: 1, end: "crashed", source: "inferred-from-crash" },
    also: (scene) => {
      expect(scene.events[0]).toMatchObject({ body: { streaming: false } });
      expect(scene.events[1]).toMatchObject({ state: "lapsed" });
      expect(scene.state.session).toBeNull();
    },
  },
  {
    name: "Stop on a queued run ends it at once and refuses its message",
    given: [...running, send("second")],
    when: stop(2),
    events: ["RunStopAsked", "ItemUpdated", "RunEnded"],
    run: { n: 2, end: "stopped", source: "stop-asked" },
  },
  {
    name: "Stop on a running run asks the provider to interrupt and keeps it running",
    given: running,
    when: stop(),
    events: ["EffectRequested", "RunStopAsked"],
    effects: ["provider.interrupt"],
    run: { n: 1, state: "running" },
  },
  {
    name: "the provider ending the turn after a Stop confirms the Stop",
    given: [...running, stop()],
    when: ended(1, { kind: "interrupted" }, "stop-confirmed"),
    run: { n: 1, end: "stopped", source: "stop-confirmed" },
  },
  {
    name: "an interrupt the provider acknowledges keeps the run until its own turn ends",
    given: [...running, send("next"), stop()],
    when: settled(r(1), "provider.interrupt", { kind: "ok" }),
    events: ["EffectOutcomeRecorded"],
    run: { n: 1, state: "running" },
    also: (scene) => expect(scene.state.runs[r(2)]?.state).toBe("queued"),
  },
  {
    name: "a stopped turn's own end ends the run and admits the next",
    given: [...running, send("next"), stop(), settled(r(1), "provider.interrupt", { kind: "ok" })],
    when: ended(1, { kind: "interrupted" }, "stop-asked"),
    run: { n: 1, end: "stopped", source: "stop-asked" },
    also: (scene) => expect(scene.state.runs[r(2)]?.state).toBe("admitted"),
  },
  {
    name: "an interrupt that fails still ends the run, said by the Stop",
    given: [...running, stop()],
    when: settled(r(1), "provider.interrupt", { kind: "failed", reason: "no process" }),
    run: { n: 1, end: "stopped", source: "stop-asked" },
  },
  {
    name: "a session that fails to open ends the admitted run failed, inferred",
    given: [send(), prepared(1)],
    when: settled(r(1), "session.open", { kind: "failed", reason: "not signed in" }),
    run: { n: 1, end: "failed", source: "inferred-from-effect" },
  },
  {
    name: "a send that fails ends the run failed, inferred",
    given: [send(), prepared(1), opened(1)],
    when: settled(r(1), "provider.send", { kind: "failed", reason: "socket closed" }),
    run: { n: 1, end: "failed", source: "inferred-from-effect" },
  },
  {
    name: "a usage limit ends the run and holds work until the exact provider reset",
    given: running,
    when: signal({ kind: "usage-limit", resetsAt: T0 + 60 * MINUTE }),
    events: ["WakeCancelled", "RunEnded", "EffectRequested", "WakeArmed", "WakeArmed"],
    run: { n: 1, end: "usage-limit", source: "agent" },
    also: (scene) => {
      expect(scene.events[3]).toMatchObject({
        kind: "usage-resume",
        dueAt: T0 + 60 * MINUTE,
      });
      expect(scene.state.pausedUntil).toBe(T0 + 60 * MINUTE);
    },
  },
  {
    name: "a message during a usage limit waits for the reset",
    given: limited,
    when: send("still there?"),
    events: ["RunQueued", "ItemOpened"],
    run: { n: 2, state: "queued" },
  },
  {
    name: "the usage resume starts a run that joins the limited run, with its principal",
    given: limited,
    when: fired("usage-resume", r(1), T0 + 60 * MINUTE),
    events: ["WakeFired", "RunQueued", "WakeCancelled", "RunAdmitted", "EffectRequested"],
    run: { n: 2, state: "admitted", joins: 1, cause: "usage-resume", principal: ana },
    also: (scene) => expect(scene.state.pausedUntil).toBeNull(),
  },
  {
    name: "the usage resume gives way to a message sent during the limit",
    given: [...limited, { command: send("me first"), by: bo }],
    when: fired("usage-resume", r(1), T0 + 60 * MINUTE),
    events: ["WakeFired", "WakeCancelled", "RunAdmitted", "EffectRequested"],
    run: { n: 2, state: "admitted", principal: bo },
  },
  {
    name: "a restart cuts the live run and arms its continuation",
    given: running,
    when: recovered(),
    events: ["WakeCancelled", "RunEnded", "EffectRequested", "WakeArmed", "SessionClosed"],
    run: { n: 1, end: "cut-by-restart", source: "inferred-from-restart" },
    also: (scene) =>
      expect(scene.events[3]).toMatchObject({
        kind: "restart-continuation",
        joins: r(1),
        text: CONTINUE_TEXT,
      }),
  },
  {
    name: "the continuation is a new run that joins the cut one, with its principal",
    given: [...running, recovered()],
    when: fired("restart-continuation", r(1)),
    events: ["WakeFired", "RunQueued", "RunAdmitted", "EffectRequested"],
    effects: ["run.prepare"],
    run: { n: 2, state: "admitted", joins: 1, cause: "restart-continuation", principal: ana },
    also: (scene) => {
      expect(scene.state.runs[r(1)]?.end).toEqual({ kind: "cut-by-restart", continuedBy: r(2) });
      const captured = play([
        ...running,
        recovered(),
        fired("restart-continuation", r(1)),
        prepared(2),
      ]);
      expect(captured.effects[0]).toMatchObject({
        kind: "session.open",
        payload: { resume: "native-1" },
      });
    },
  },
  ...(
    [
      ["a newer person message", [...running, send("newer")]],
      ["a Stop was asked", [...running, stop()]],
      [
        "a maintenance turn",
        [send("/compact", { maintenance: true }), prepared(1), opened(1), sent(1)],
      ],
      ["archived", [...running, { _tag: "Archive" }]],
    ] as const
  ).map(([reason, given]): Row => ({
    name: `a restart does not continue a run when ${reason === "archived" ? "the conversation is archived" : reason}`,
    given,
    when: recovered(),
    run: { n: 1, end: "cut-by-restart", source: "inferred-from-restart" },
    also: (scene) => {
      expect(scene.state.runs[r(1)]?.end).toMatchObject({ notContinued: reason });
      expect(tags(scene)).not.toContain("WakeArmed");
    },
  })),
  {
    name: "a continuation gives way to a message sent after the restart",
    given: [...running, recovered(), send("I'm back")],
    when: fired("restart-continuation", r(1)),
    events: ["WakeFired", "RunNotContinued"],
    also: (scene) =>
      expect(scene.state.runs[r(1)]?.end).toMatchObject({
        notContinued: "a newer person message",
      }),
  },
  {
    name: "a continuation does not run in a conversation archived since",
    given: [...running, recovered(), { _tag: "Archive" }],
    when: fired("restart-continuation", r(1)),
    events: ["WakeFired", "RunNotContinued"],
  },
  {
    name: "a restart puts a message whose send never started back at the head, to go as it was",
    given: [...running, turnEnded, send("second"), prepared(2)],
    when: {
      command: {
        _tag: "Recovered",
        bootId: "boot-2" as never,
        cutEffects: [],
        unstartedEffects: [effectId(r(2), "provider.send", 1)],
      },
    },
    events: [
      "EffectOutcomeRecorded",
      "RunRequeued",
      "SessionClosed",
      "RunAdmitted",
      "EffectRequested",
    ],
    effects: ["session.open"],
    run: { n: 2, state: "admitted" },
    also: (scene) => expect(scene.state.runs[r(2)]?.text).toBe("second"),
  },
  {
    name: "a message whose send a restart cut mid-flight goes again in its own words, marked",
    given: [...running, turnEnded, send("second"), prepared(2)],
    when: recovered([effectId(r(2), "provider.send", 1)]),
    run: { n: 2, end: "cut-by-restart", source: "inferred-from-restart" },
    also: (scene) =>
      expect(scene.events.find((event) => event._tag === "WakeArmed")).toMatchObject({
        kind: "restart-continuation",
        text: resentText("second"),
      }),
  },
  {
    name: "a restart closes the session of an idle conversation",
    given: [...running, turnEnded],
    when: recovered(),
    events: ["SessionClosed"],
    also: (scene) => expect(scene.state.session).toBeNull(),
  },
  {
    name: "a restart asks again for the session of an admitted run whose opening it cut",
    given: [send(), prepared(1)],
    when: recovered([effectId(r(1), "session.open", 1)]),
    events: ["EffectOutcomeRecorded", "EffectRequested"],
    effects: ["session.open"],
    also: (scene) => expect(scene.effects[0]?.effectId).toBe(effectId(r(1), "session.open", 2)),
  },
  {
    name: "a turn the agent starts itself joins the run whose work it reports",
    given: [...running, turnEnded, { command: send("other"), by: bo }, prepared(2), ended(2)],
    when: signal({
      kind: "turn-started",
      turn: "bg" as TurnHandle,
      origin: "self",
      providerTurnId: "bg",
      reportsOn: r(1),
    }),
    events: ["RunQueued", "RunAdmitted", "RunStarted", "WakeArmed"],
    run: { n: 3, state: "running", joins: 1, cause: "self", principal: ana },
  },
  {
    name: "a turn the agent starts itself joins the latest run when the bridge names none",
    given: [...running, turnEnded],
    when: signal({
      kind: "turn-started",
      turn: "bg" as TurnHandle,
      origin: "self",
      providerTurnId: "bg",
    }),
    run: { n: 2, state: "running", joins: 1, cause: "self", principal: ana },
  },
  {
    // The driver took the message as its next turn: unowned, its end would be dropped and the next
    // send, steered into it, would never end.
    name: "a message steered in as its turn ended opens a turn of its own, run as the turn it steered",
    given: [...runningWithSteer, { _tag: "Steer", runId: r(1), text: "more" }, turnEnded],
    when: signal({
      kind: "turn-started",
      turn: `${r(1)}/i/2` as TurnHandle,
      origin: "engine",
      providerTurnId: "T2",
    }),
    run: { n: 2, state: "running", joins: 1, cause: "self", principal: ana },
  },
  {
    name: "the end of a turn a late steer opened ends the run the engine holds it as",
    given: [
      ...runningWithSteer,
      { _tag: "Steer", runId: r(1), text: "more" },
      turnEnded,
      signal({
        kind: "turn-started",
        turn: `${r(1)}/i/2` as TurnHandle,
        origin: "engine",
        providerTurnId: "T2",
      }),
    ],
    when: signal({
      kind: "turn-ended",
      turn: `${r(1)}/i/2` as TurnHandle,
      outcome: { kind: "completed" },
      source: "agent",
    }),
    run: { n: 2, state: "ended", end: "completed" },
  },
  {
    name: "the watchdog marks a silent run unresponsive and never ends it",
    given: running,
    when: fired("watchdog", r(1), T0 + WATCHDOG_SILENCE_MS),
    events: ["WakeFired", "RunUnresponsive"],
    run: { n: 1, state: "running" },
  },
  {
    name: "the watchdog re-arms from the run's last boundary when it spoke since",
    given: [
      ...running,
      {
        command: signal({
          kind: "item-opened",
          turn: T(1),
          key: "k",
          by: { kind: "mate" },
          body: note("k"),
        }),
        at: T0 + 5 * MINUTE,
      },
    ],
    when: fired("watchdog", r(1), T0 + WATCHDOG_SILENCE_MS),
    events: ["WakeFired", "WakeArmed"],
    also: (scene) =>
      expect(scene.events[1]).toMatchObject({ dueAt: T0 + 5 * MINUTE + WATCHDOG_SILENCE_MS }),
  },
  {
    name: "a boundary from an unresponsive run clears the mark",
    given: [...running, fired("watchdog", r(1), T0 + WATCHDOG_SILENCE_MS)],
    when: signal({
      kind: "item-opened",
      turn: T(1),
      key: "k",
      by: { kind: "mate" },
      body: note("k"),
    }),
    events: ["RunResponsive", "WakeArmed", "ItemOpened"],
  },
  {
    name: "activity is recorded at most every half watchdog",
    given: [...running, { command: signal({ kind: "activity", turn: T(1) }), at: T0 + MINUTE }],
    when: { command: signal({ kind: "activity", turn: T(1) }), at: T0 + WATCHDOG_SILENCE_MS / 2 },
    events: ["RunResponsive", "WakeArmed"],
    also: (scene) =>
      expect(scene.state.runs[r(1)]?.lastActivityAt).toBe(T0 + WATCHDOG_SILENCE_MS / 2),
  },
  {
    name: "steer puts a message into the running turn where the driver supports it",
    given: runningWithSteer,
    when: { _tag: "Steer", runId: r(1), text: "use pnpm" },
    events: ["ItemOpened", "EffectRequested"],
    effects: ["provider.steer"],
    also: (scene) =>
      expect(scene.events[0]).toMatchObject({ body: { delivery: { state: "steered" } } }),
  },
  {
    name: "a recurring wake runs with the wake's principal and re-arms at the cron's next time",
    given: [
      {
        command: {
          _tag: "ArmWake",
          kind: "standup",
          key: "daily",
          cron: "0 9 * * *",
          text: "Stand up",
        },
        by: { kind: "standup", startedBy: "ana" },
      },
    ],
    when: fired("standup", "daily", T0 + 24 * 60 * MINUTE),
    events: ["WakeFired", "WakeArmed", "RunQueued", "RunAdmitted", "EffectRequested"],
    run: { n: 1, cause: "standup", principal: { kind: "standup", startedBy: "ana" } },
    also: (scene) => {
      const rearmed = scene.events[1] as Extract<KnownEngineEvent, { _tag: "WakeArmed" }>;
      expect(rearmed.dueAt).toBeGreaterThan(T0 + 24 * 60 * MINUTE);
    },
  },
  {
    name: "a model switch closes the session for the next run and opens one rotating from it",
    given: [
      ...running,
      turnEnded,
      { _tag: "SwitchModel", model: "opus" },
      send("with opus"),
      prepared(2),
      sessionClosed(),
    ],
    when: opened(2, { session: "s2" }),
    events: ["EffectOutcomeRecorded", "SessionOpened", "EffectRequested", "RunSending"],
    also: (scene) => expect(scene.events[1]).toMatchObject({ rotatedFrom: s1 }),
  },
  {
    name: "a model switch closes the session that does not fit before anything is sent",
    given: [...running, turnEnded, { _tag: "SwitchModel", model: "opus" }, send("with opus")],
    when: prepared(2),
    events: ["EffectOutcomeRecorded", "EffectRequested", "SessionClosing"],
    effects: ["session.close"],
    also: (scene) =>
      expect(scene.effects[0]).toMatchObject({ lane: "close", payload: { reason: "model" } }),
  },
  {
    name: "archiving an archived conversation records nothing",
    given: [{ _tag: "Archive" }],
    when: { _tag: "Archive" },
    events: [],
  },
  {
    name: "a cancelled wake no longer fires",
    given: [{ _tag: "ArmWake", kind: "schedule", key: "k", dueAt: T0 + MINUTE }],
    when: { _tag: "CancelWake", wakeId: wakeId(conversation, "schedule", "k") },
    events: ["WakeCancelled"],
  },
];

describe("decide: transitions", () => {
  it.each(transitions)("$name", (row) => {
    const scene = play([...row.given, row.when]);
    expect(scene.decision._tag).toBe("Accept");
    if (row.events !== undefined) expect(tags(scene)).toEqual(row.events);
    if (row.effects !== undefined)
      expect(scene.effects.map((effect) => effect.kind)).toEqual(row.effects);
    if (row.run !== undefined) {
      const run = scene.state.runs[r(row.run.n)];
      expect(run).toBeDefined();
      if (row.run.state !== undefined) expect(run?.state).toBe(row.run.state);
      if (row.run.end !== undefined) expect(run?.end?.kind).toBe(row.run.end);
      if (row.run.source !== undefined) expect(run?.endSource).toBe(row.run.source);
      if (row.run.joins !== undefined) {
        expect(run?.joins).toBe(row.run.joins === null ? null : r(row.run.joins));
      }
      if (row.run.cause !== undefined) {
        expect(run?.trigger).toMatchObject({ kind: "wake", cause: row.run.cause });
      }
      if (row.run.principal !== undefined) expect(run?.principal).toEqual(row.run.principal);
    }
    row.also?.(scene);
  });
});

const rejections: ReadonlyArray<{
  readonly name: string;
  readonly given: ReadonlyArray<Step>;
  readonly when: Step;
  readonly reason: RejectionReason;
}> = [
  {
    name: "a message to an archived conversation",
    given: [{ _tag: "Archive" }],
    when: send(),
    reason: "archived",
  },
  { name: "an empty message", given: [], when: send("  "), reason: "empty-message" },
  { name: "Stop with nothing running", given: [], when: stop(), reason: "run-not-running" },
  {
    name: "Stop of a run that does not exist",
    given: running,
    when: stop(9),
    reason: "unknown-run",
  },
  {
    name: "Stop of an ended run",
    given: [...running, turnEnded],
    when: stop(1),
    reason: "run-ended",
  },
  {
    name: "a third Stop while the session closes",
    given: [...running, stop(), stop()],
    when: stop(),
    reason: "stop-already-asked",
  },
  {
    name: "an answer to no open request",
    given: running,
    when: { _tag: "Answer", requestId: RequestId.make("nope"), answer: null, summary: "" },
    reason: "unknown-request",
  },
  {
    name: "an answer to a request whose callback is gone",
    given: [...running, requestOpened("q1", false)],
    when: { _tag: "Answer", requestId: requestId(r(1), 1), answer: null, summary: "" },
    reason: "not-answerable",
  },
  {
    name: "a second answer to the same request",
    given: [
      ...waiting,
      { _tag: "Answer", requestId: requestId(r(1), 1), answer: null, summary: "Allowed" },
    ],
    when: { _tag: "Answer", requestId: requestId(r(1), 1), answer: null, summary: "Allowed" },
    reason: "unknown-request",
  },
  {
    name: "steer where the driver cannot steer",
    given: running,
    when: { _tag: "Steer", runId: r(1), text: "faster" },
    reason: "steer-unsupported",
  },
  {
    name: "steer into a queued run",
    given: [...runningWithSteer, send("queued")],
    when: { _tag: "Steer", runId: r(2), text: "faster" },
    reason: "run-not-running",
  },
  {
    name: "steer into a run that does not exist",
    given: runningWithSteer,
    when: { _tag: "Steer", runId: r(9), text: "faster" },
    reason: "unknown-run",
  },
  {
    name: "steer in an archived conversation",
    given: [...runningWithSteer, { _tag: "Archive" }],
    when: { _tag: "Steer", runId: r(1), text: "faster" },
    reason: "archived",
  },
  {
    name: "a model switch in an archived conversation",
    given: [{ _tag: "Archive" }],
    when: { _tag: "SwitchModel", model: "opus" },
    reason: "archived",
  },
  {
    name: "signals from a session that is not the conversation's",
    given: running,
    when: { _tag: "ProviderSignals", sessionId: SessionId.make("s0"), signals: [] },
    reason: "stale-session",
  },
  {
    name: "signals before any session opened",
    given: [send()],
    when: signal({ kind: "turn-started", turn: T(1), origin: "engine", providerTurnId: null }),
    reason: "stale-session",
  },
  {
    name: "an outcome for an effect not in flight (a duplicate settle)",
    given: [send(), opened(1)],
    when: opened(1),
    reason: "unknown-effect",
  },
  {
    name: "a wake firing that is not armed (a second fire)",
    given: [...running, recovered(), fired("restart-continuation", r(1))],
    when: fired("restart-continuation", r(1)),
    reason: "wake-not-armed",
  },
  {
    name: "a fire of an arming the wake has been armed again since",
    given: [
      { _tag: "ArmWake", kind: "schedule", key: "k", dueAt: T0 },
      { _tag: "ArmWake", kind: "schedule", key: "k", dueAt: T0 + MINUTE },
    ],
    when: {
      command: { _tag: "WakeFired", wakeId: wakeId(conversation, "schedule", "k"), armedSeq: 1 },
      at: T0 + MINUTE,
    },
    reason: "wake-not-armed",
  },
  {
    name: "cancelling a wake that is not armed",
    given: [],
    when: { _tag: "CancelWake", wakeId: WakeId.make("mate/w/schedule/none") },
    reason: "wake-not-armed",
  },
  {
    name: "a wake with a cron that does not parse",
    given: [],
    when: { _tag: "ArmWake", kind: "schedule", key: "k", cron: "every tuesday" },
    reason: "invalid-wake",
  },
  {
    name: "a wake with neither a due time nor a cron",
    given: [],
    when: { _tag: "ArmWake", kind: "schedule", key: "k" },
    reason: "invalid-wake",
  },
  {
    name: "a message whose principal is the engine itself",
    given: [],
    when: { command: send("from nobody"), by: { kind: "engine" } },
    reason: "invalid-principal",
  },
  {
    name: "a wake armed to run as the engine",
    given: [],
    when: {
      command: { _tag: "ArmWake", kind: "standup", key: "daily", dueAt: T0 },
      by: { kind: "engine" },
    },
    reason: "invalid-principal",
  },
  {
    name: "a steer whose principal is the engine itself",
    given: runningWithSteer,
    when: { command: { _tag: "Steer", runId: r(1), text: "faster" }, by: { kind: "engine" } },
    reason: "invalid-principal",
  },
  {
    name: "a watchdog armed from outside the engine",
    given: [],
    when: { _tag: "ArmWake", kind: "watchdog", key: "k", dueAt: T0 },
    reason: "invalid-wake",
  },
];

describe("decide: rejections", () => {
  it.each(rejections)("refuses $name", ({ given, when, reason }) => {
    const before = given.length === 0 ? undefined : play(given).state;
    const scene = play([...given, when]);
    expect(scene.decision).toMatchObject({ _tag: "Reject", rejection: { reason } });
    if (before !== undefined) expect(scene.state).toEqual(before);
  });
});

describe("decide: results", () => {
  it("returns the head sequence after the step and the ids it made", () => {
    const scene = play([send()]);
    expect(scene.decision).toMatchObject({
      _tag: "Accept",
      step: { result: { _tag: "Accepted", seq: 4, runId: r(1), itemId: `${r(1)}/i/1` } },
    });
  });
});

// ── the rules the proof found broken (round 3: review 2, 6, 7, 9, 10; F2, F5) ─────────────────

/** Plays every input and keeps the whole log, as the actor folds it. */
const playAll = (steps: ReadonlyArray<Step>) => {
  let state = initialState(conversation);
  const log: Array<KnownEngineEvent> = [];
  let now = T0;
  steps.forEach((step, index) => {
    const input: Input = "_tag" in step ? { command: step } : step;
    now = input.at ?? now;
    const envelope = {
      commandId: CommandId.make(`p${index}`),
      conversationId: conversation,
      principal: input.by ?? ana,
      command: input.command,
    };
    const decision = decide(state, envelope, now);
    if (decision._tag === "Reject") return;
    const events = stampEvents(state.headSeq, envelope, decision.step.events, now);
    log.push(...events);
    state = fold(state, events);
  });
  return { state, log };
};
const ends = (log: ReadonlyArray<KnownEngineEvent>) =>
  log.flatMap((e) =>
    e._tag === "RunEnded" ? [`${e.runId.split("/").at(-1)}:${e.end.kind}/${e.source}`] : [],
  );
/** The person message's delivery as the record shows it: its latest event. */
const delivery = (log: ReadonlyArray<KnownEngineEvent>) =>
  log
    .flatMap((e) =>
      (e._tag === "ItemOpened" || e._tag === "ItemUpdated") && e.body.kind === "person"
        ? [e.body.delivery.state]
        : [],
    )
    .at(-1);
const sentTurn = (run: number) =>
  settled(r(run), "provider.send", { kind: "ok", value: { providerTurnId: `t${run}` } });
const proofRunning: ReadonlyArray<Step> = [send("go"), prepared(1), opened(1), sentTurn(1)];

describe("decide: a turn's signals land on its own run", () => {
  it("the provider's own end of a stopped turn never ends the next run", () => {
    const { log, state } = playAll([
      ...proofRunning,
      send("next"),
      stop(),
      settled(r(1), "provider.interrupt", { kind: "ok" }),
      ended(1, { kind: "interrupted" }, "stop-confirmed"),
      prepared(2),
    ]);
    expect(ends(log)).toEqual(["1:stopped/stop-confirmed"]);
    expect(state.runs[r(2)]?.state).toBe("sending");
  });
  it("the provider's end of a turn whose interrupt failed never ends the next run", () => {
    const { log } = playAll([
      ...proofRunning,
      send("next"),
      stop(),
      settled(r(1), "provider.interrupt", { kind: "failed", reason: "timeout" }),
      turnEnded,
    ]);
    expect(ends(log)).toEqual(["1:stopped/stop-asked"]);
  });
  it("the end of a turn a usage limit parked never ends the resume run", () => {
    const reset = T0 + 3_600_000;
    const { log } = playAll([
      ...proofRunning,
      signal({ kind: "usage-limit", resetsAt: reset }),
      fired("usage-resume", r(1), reset),
      turnEnded,
    ]);
    expect(ends(log)).toEqual(["1:usage-limit/agent"]);
  });
  it("an item after its turn's end is never filed under the next run", () => {
    const { log } = playAll([
      ...proofRunning,
      send("next"),
      turnEnded,
      signal({
        kind: "item-closed",
        turn: T(1),
        key: "late",
        body: { kind: "note", text: "x", streaming: false, answer: false },
        afterEnd: true,
      }),
    ]);
    const filed = log.flatMap((e) =>
      e._tag === "ItemOpened" && e.by.kind === "mate" ? [e.runId] : [],
    );
    expect(filed).not.toContain(r(2));
    expect(filed).toEqual([r(1)]);
  });
  it("a turn the bridge says ended by a crash ends the run inferred, not said by the agent", () => {
    const end = ended(
      1,
      { kind: "failed", class: "unknown", words: "process exited" },
      "inferred-from-crash",
    );
    const { log } = playAll([...proofRunning, end]);
    expect(ends(log)).toEqual(["1:failed/inferred-from-crash"]);
  });
});

describe("decide: a usage limit's end is the refusal's own record", () => {
  const limitEnds = (log: ReadonlyArray<KnownEngineEvent>) =>
    log.flatMap((e) => (e._tag === "RunEnded" && e.end.kind === "usage-limit" ? [e.end] : []));
  it.each([
    { how: "parked its turn", step: signal({ kind: "usage-limit", turn: T(1), resetsAt: null }) },
    {
      how: "ended its turn",
      step: ended(1, { kind: "usage-limited", resetsAt: "unknown", words: "limit" }),
    },
  ])("a usage limit that $how names the agent whose limit it hit", ({ step }) => {
    const { log } = playAll([...proofRunning, step]);
    expect(limitEnds(log)).toEqual([expect.objectContaining({ driver: "claude" })]);
  });
});

describe("decide: a usage limit with an unknown reset", () => {
  it("queued work waits instead of walking into the limit", () => {
    const { state, log } = playAll([
      ...proofRunning,
      send("queued"),
      signal({ kind: "usage-limit", resetsAt: null }),
    ]);
    expect({
      queued: state.runs[r(2)]?.state,
      resume:
        Object.values(state.wakes).some((w) => w.kind === "usage-resume") ||
        state.pausedUntil !== null,
    }).toEqual({ queued: "queued", resume: true });
    expect(ends(log)).toEqual(["1:usage-limit/agent"]);
  });
});

describe("decide: a usage pause belongs to the limit the provider still reports", () => {
  const reset = T0 + 24 * 60 * MINUTE;
  const pausedOn: ReadonlyArray<Step> = [
    ...proofRunning,
    signal({ kind: "usage-limit", resetsAt: reset }),
  ];
  const held: ReadonlyArray<Step> = [...pausedOn, send("still there?")];
  const usage = (
    windows: ReadonlyArray<{ readonly usedPercent: number; readonly resetsAt: number | null }>,
    checkedAt = T0 + MINUTE,
  ): Input => ({
    command: { _tag: "ProviderUsage", usage: { checkedAt, windows } },
    by: { kind: "engine" },
    at: checkedAt,
  });
  /** The new account Milo was signed in to: budget left, its windows reset on other days. */
  const otherAccount = usage([
    { usedPercent: 17, resetsAt: T0 + 3 * 60 * MINUTE },
    { usedPercent: 24, resetsAt: T0 + 4 * 24 * 60 * MINUTE },
  ]);
  const shape = (state: ConversationState) => ({
    paused: state.pausedUntil,
    runs: Object.values(state.runs).map((run) => [
      run.ordinal,
      run.state,
      run.trigger.kind === "wake" ? run.trigger.cause : run.trigger.kind,
    ]),
  });

  it.each<{
    readonly name: string;
    readonly given: ReadonlyArray<Step>;
    readonly when: Step;
    readonly then: ReturnType<typeof shape>;
  }>([
    {
      name: "a sign-in whose account has budget left lifts the pause and the held message goes",
      given: held,
      when: otherAccount,
      then: {
        paused: null,
        runs: [
          [1, "ended", "person"],
          [2, "admitted", "person"],
        ],
      },
    },
    {
      name: "the provider no longer reporting the limit resumes the limited work at once",
      given: pausedOn,
      when: otherAccount,
      then: {
        paused: null,
        runs: [
          [1, "ended", "person"],
          [2, "admitted", "usage-resume"],
        ],
      },
    },
    {
      name: "a usage report that still shows the limit's window keeps the pause",
      given: held,
      when: usage([{ usedPercent: 99, resetsAt: reset }]),
      then: {
        paused: reset,
        runs: [
          [1, "ended", "person"],
          [2, "queued", "person"],
        ],
      },
    },
    {
      name: "a usage report with a full window keeps the pause",
      given: held,
      when: usage([{ usedPercent: 100, resetsAt: T0 + 3 * 60 * MINUTE }]),
      then: {
        paused: reset,
        runs: [
          [1, "ended", "person"],
          [2, "queued", "person"],
        ],
      },
    },
    {
      name: "a usage report read before the limit keeps the pause",
      given: held,
      when: usage([{ usedPercent: 24, resetsAt: T0 + 4 * 24 * 60 * MINUTE }], T0 - MINUTE),
      then: {
        paused: reset,
        runs: [
          [1, "ended", "person"],
          [2, "queued", "person"],
        ],
      },
    },
    {
      name: "Continue during a usage limit tries the provider now",
      given: pausedOn,
      when: { _tag: "Continue" },
      then: {
        paused: null,
        runs: [
          [1, "ended", "person"],
          [2, "admitted", "usage-resume"],
        ],
      },
    },
    {
      name: "Continue during a usage limit sends the held message first",
      given: held,
      when: { _tag: "Continue" },
      then: {
        paused: null,
        runs: [
          [1, "ended", "person"],
          [2, "admitted", "person"],
        ],
      },
    },
  ])("$name", ({ given, when, then }) => {
    const scene = play([...given, when]);
    expect(scene.decision._tag).toBe("Accept");
    expect(shape(scene.state)).toEqual(then);
  });

  it("a try the provider still refuses pauses again until its reset", () => {
    const later = reset + 60 * MINUTE;
    const { state, log } = playAll([
      ...held,
      { _tag: "Continue" },
      prepared(2),
      signal({ kind: "usage-limit", turn: T(2), resetsAt: later }),
    ]);
    expect(ends(log)).toEqual(["1:usage-limit/agent", "2:usage-limit/agent"]);
    expect(state.pausedUntil).toBe(later);
    expect(state.wakes[wakeId(conversation, "usage-resume", r(2))]?.dueAt).toBe(later);
  });

  it("a held message withdrawn ends stopped, unsent, and the next held message moves up", () => {
    const { state, log } = playAll([...held, send("and this"), stop(2)]);
    expect(ends(log)).toEqual(["1:usage-limit/agent", "2:stopped/stop-asked"]);
    expect(state.runs[r(2)]?.startedAt ?? null).toBeNull();
    expect(state.queue).toEqual([r(3)]);
    const resumed = playAll([...held, send("and this"), stop(2), { _tag: "Continue" }]);
    expect(resumed.state.runs[r(3)]?.state).toBe("admitted");
  });

  it("nothing paused, a usage report or a Continue changes nothing", () => {
    for (const when of [otherAccount, { _tag: "Continue" } as Command]) {
      const scene = play([...proofRunning, when]);
      expect(scene.decision._tag).toBe("Accept");
      expect(scene.events).toEqual([]);
    }
  });
});

describe("decide: a session fits by the model the engine asked for", () => {
  it.each([
    ["a differently spelled model", "opus", "claude-opus-4-5"],
    ["a session that reports no model", "opus", null],
  ] as const)("%s: two runs share one session", (_name, chosen, reported) => {
    const { log } = playAll([
      { _tag: "SwitchModel", model: chosen },
      send("one"),
      prepared(1),
      settled(r(1), "session.open", {
        kind: "ok",
        value: {
          sessionId: "s1",
          driver: "claude",
          model: reported,
          nativeRef: "native",
          capabilities: { steer: false },
        },
      }),
      sentTurn(1),
      turnEnded,
      send("two"),
    ]);
    expect(
      log.filter((e) => e._tag === "EffectRequested" && e.kind === "session.open").length,
    ).toBe(1);
  });
});

describe("decide: the watchdog watches a running run only", () => {
  const silent: Input = {
    command: { _tag: "WakeFired", wakeId: wakeId(conversation, "watchdog", r(1)) },
    at: T0 + WATCHDOG_SILENCE_MS,
  };
  it("a run waiting on a person is not marked unresponsive", () => {
    const { state } = playAll([...proofRunning, requestOpened("q"), silent]);
    expect(state.runs[r(1)]?.unresponsiveSince).toBeNull();
  });
  it("an answer clears the mark", () => {
    const { state } = playAll([
      ...proofRunning,
      requestOpened("q"),
      silent,
      {
        command: { _tag: "Answer", requestId: requestId(r(1), 1), answer: "y", summary: "y" },
        at: T0 + WATCHDOG_SILENCE_MS + 1,
      },
    ]);
    expect({ state: state.runs[r(1)]?.state, mark: state.runs[r(1)]?.unresponsiveSince }).toEqual({
      state: "running",
      mark: null,
    });
  });
  it("a run that spoke again is watched again", () => {
    const { state } = playAll([
      ...proofRunning,
      silent,
      { command: signal({ kind: "activity", turn: T(1) }), at: T0 + WATCHDOG_SILENCE_MS + 1 },
    ]);
    expect(Object.values(state.wakes).some((w) => w.kind === "watchdog")).toBe(true);
  });
});

describe("decide: a person's message never reads queued once its run has ended", () => {
  it.each([
    [
      "a send that failed",
      [settled(r(1), "provider.send", { kind: "failed", reason: "socket closed" })],
    ],
    ["a restart that cut the send", [recovered([effectId(r(1), "provider.send", 1)])]],
    [
      "a session that exited before the turn",
      [signal({ kind: "session-exited", reason: "exit 137" })],
    ],
    ["a usage limit before the turn", [signal({ kind: "usage-limit", resetsAt: T0 + 60_000 })]],
    ["a turn that ended before it was seen to start", [turnEnded]],
  ] as const)("%s settles the message's delivery", (_name, last) => {
    const { state, log } = playAll([send("go"), prepared(1), opened(1), ...last]);
    expect(state.runs[r(1)]?.state).toBe("ended");
    expect(delivery(log)).not.toBe("queued");
  });
});

describe("decide: a question's answer carries its pictures", () => {
  const preview = {
    type: "image",
    id: "img-q",
    name: "question-preview.png",
    mimeType: "image/png",
    sizeBytes: 2048,
  } as unknown as ChatImageAttachment;
  const asked = signal({
    kind: "request-opened",
    key: "q1",
    ask: { kind: "question", questions: [], dismissible: false },
  });
  const given = {
    answers: { target: "Inspect the preview shown here" },
    attachmentsByQuestionId: { target: [preview] },
  };
  const answer = (said: unknown, summary = "Answered"): Command => ({
    _tag: "Answer",
    requestId: requestId(r(1), 1),
    answer: said,
    summary,
  });
  it("the pictures go to the agent with the words, by their asset reference", () => {
    const scene = play([...running, asked, answer(given)]);
    expect(scene.effects).toMatchObject([{ kind: "provider.respond", payload: { answer: given } }]);
  });
  it("the question's record keeps what was answered and the pictures", () => {
    const scene = play([...running, asked, answer(given)]);
    expect(scene.events.find((e) => e._tag === "RequestAnswered")).toMatchObject(given);
  });
  it("an approval's record keeps its summary alone", () => {
    const scene = play([...waiting, answer({ decision: "accept" }, "Approved")]);
    const answered = scene.events.find((e) => e._tag === "RequestAnswered");
    expect(answered).toMatchObject({ summary: "Approved" });
    expect(answered).not.toHaveProperty("answers");
    expect(answered).not.toHaveProperty("attachmentsByQuestionId");
  });
  it("an answer with pictures the agent failed to take opens the question again", () => {
    const { state, log } = playAll([
      ...proofRunning,
      asked,
      answer(given),
      settled(requestId(r(1), 1), "provider.respond", { kind: "failed", reason: "timeout" }),
    ]);
    expect(log.filter((e) => e._tag === "RequestReopened")).toMatchObject([
      { requestId: requestId(r(1), 1) },
    ]);
    expect(Object.keys(state.requests)).toEqual([requestId(r(1), 1)]);
  });
});

describe("decide: a dismissible question is dismissed unanswered", () => {
  const question = (dismissible: boolean) =>
    signal({
      kind: "request-opened",
      key: "q1",
      ask: { kind: "question", questions: [], dismissible },
    });
  const dismiss: Command = { _tag: "Dismiss", requestId: requestId(r(1), 1) };
  it("closes it dismissed, telling the agent nothing; its run never waited on it", () => {
    const scene = play([...running, question(true), dismiss]);
    expect(scene.events.map((e) => e._tag)).toEqual(["RequestClosed"]);
    expect(scene.events[0]).toMatchObject({ state: "dismissed" });
    expect(scene.effects).toEqual([]);
    expect(scene.state.requests).toEqual({});
    expect(scene.state.runs[r(1)]?.state).toBe("running");
  });
  it.each([
    ["a question its agent waits on", [...running, question(false)], "not-dismissible"],
    ["an approval", waiting, "not-dismissible"],
    ["a question already dismissed", [...running, question(true), dismiss], "unknown-request"],
  ] as const)("refuses to dismiss %s", (_name, given, reason) => {
    const before = play(given).state;
    const scene = play([...given, dismiss]);
    expect(scene.decision).toMatchObject({ _tag: "Reject", rejection: { reason } });
    expect(scene.state).toEqual(before);
  });
});

describe("decide: a question asked by message is answered by a message", () => {
  const preview = {
    type: "image",
    id: "img-q",
    name: "question-preview.png",
    mimeType: "image/png",
    sizeBytes: 2048,
  } as unknown as ChatImageAttachment;
  const asked = (turn = T(1)) =>
    signal({
      kind: "request-opened",
      turn,
      key: "codex-async:q1",
      ask: {
        kind: "question",
        questions: [
          { id: "0", question: "Which package manager?" },
          { id: "1", question: "What should it be named?" },
        ],
        dismissible: true,
      },
    });
  const answered: Command = {
    _tag: "Answer",
    requestId: requestId(r(1), 1),
    answer: {
      answers: { "0": "pnpm", "1": "api" },
      attachmentsByQuestionId: { "1": [preview] },
    },
    summary: "Answered",
  };
  const afterTurn: ReadonlyArray<Step> = [...proofRunning, asked(), ended(1)];
  const closes = (log: ReadonlyArray<KnownEngineEvent>) =>
    log.flatMap((e) =>
      e._tag === "RequestClosed" || e._tag === "RequestReopened"
        ? [e._tag === "RequestClosed" ? `closed ${e.state}` : "reopened"]
        : [],
    );

  it("does not hold the run, and outlives the turn that asked it", () => {
    const { state, log } = playAll(afterTurn);
    expect(log.some((e) => e._tag === "RunWaiting")).toBe(false);
    expect(state.runs[r(1)]?.end).toMatchObject({ kind: "completed" });
    expect(closes(log)).toEqual([]);
    expect(state.requests[requestId(r(1), 1)]).toMatchObject({ answerable: true });
  });

  it("asked after its turn ended, still waits for the person", () => {
    const { state, log } = playAll([...proofRunning, ended(1), asked()]);
    expect(closes(log)).toEqual([]);
    expect(state.requests[requestId(r(1), 1)]).toMatchObject({ answerable: true });
  });

  it("the answer goes as the person's message with its pictures, never through the respond call", () => {
    const scene = play([...afterTurn, answered]);
    expect(scene.effects.map((effect) => effect.kind)).not.toContain("provider.respond");
    expect(scene.events.find((e) => e._tag === "ItemOpened")).toMatchObject({
      runId: r(2),
      body: {
        kind: "person",
        text: [
          "Which package manager?\npnpm",
          "What should it be named?\napi\nAttached file: question-preview.png (img-q)",
        ].join("\n\n"),
        attachments: [preview],
        sendId: "c6",
      },
    });
    const recorded = scene.events.find((e) => e._tag === "RequestAnswered");
    expect(recorded).toMatchObject({ requestId: requestId(r(1), 1), bySend: r(2) });
    expect(recorded).not.toHaveProperty("effectId");
    // The person's message shows the answer: the question's record does not show it again.
    expect(recorded).not.toHaveProperty("answers");
    expect(recorded).not.toHaveProperty("attachmentsByQuestionId");
  });

  const steered = (scene: Scene) => {
    const item = scene.events.find((e) => e._tag === "ItemOpened" && e.runId === r(1));
    if (item?._tag !== "ItemOpened") throw new Error("no steered message");
    return { item: item.itemId, effect: effectId(item.itemId, "provider.steer", 1) };
  };
  const whileAsking: ReadonlyArray<Step> = [...proofRunning, asked()];
  const dismissedQ: Command = { _tag: "Dismiss", requestId: requestId(r(1), 1) };

  it("while the turn that asked still runs, the answer goes into that turn as the person's message, with its pictures", () => {
    const scene = play([...whileAsking, answered]);
    expect(scene.events.some((e) => e._tag === "RunQueued")).toBe(false);
    expect(scene.events.find((e) => e._tag === "ItemOpened")).toMatchObject({
      runId: r(1),
      body: {
        kind: "person",
        text: [
          "Which package manager?\npnpm",
          "What should it be named?\napi\nAttached file: question-preview.png (img-q)",
        ].join("\n\n"),
        attachments: [preview],
        delivery: { state: "steered" },
      },
    });
    expect(scene.effects).toMatchObject([
      { kind: "provider.steer", runId: r(1), payload: { attachments: [preview] } },
    ]);
    const recorded = scene.events.find((e) => e._tag === "RequestAnswered");
    expect(recorded).toMatchObject({ effectId: steered(scene).effect });
    expect(recorded).not.toHaveProperty("bySend");
    expect(recorded).not.toHaveProperty("answers");
  });

  it("is answered once the agent took it into its turn, never before", () => {
    const scene = play([...whileAsking, answered]);
    expect(closes(playAll([...whileAsking, answered]).log)).toEqual([]);
    const { log, state } = playAll([
      ...whileAsking,
      answered,
      settled(steered(scene).item, "provider.steer", { kind: "ok", value: { as: "steered" } }),
    ]);
    expect(closes(log)).toEqual(["closed answered"]);
    expect(state.requests).toEqual({});
    expect(state.answering).toEqual({});
  });

  it.each([
    ["the agent did not take it into its turn", "failed"],
    ["the agent did not say in time whether it took it", "timed-out"],
    ["a restart cut it", "cut"],
  ] as const)("opens the question again when %s", (_name, how) => {
    const scene = play([...whileAsking, answered]);
    const { item, effect } = steered(scene);
    const { log, state } = playAll([
      ...whileAsking,
      answered,
      how === "failed"
        ? settled(item, "provider.steer", { kind: "failed", reason: "refused" })
        : how === "timed-out"
          ? settled(item, "provider.steer", { kind: "timed-out", after: 30_000 })
          : recovered([effect]),
    ]);
    expect(closes(log)).toEqual(["reopened"]);
    expect(state.requests[requestId(r(1), 1)]).toMatchObject({ answerable: true });
  });

  it("the message that asked it becomes the question's place, leaving no empty words", () => {
    const { log } = playAll([
      ...proofRunning,
      signal({
        kind: "item-opened",
        turn: T(1),
        key: "h1.i1",
        by: { kind: "mate" },
        body: note("h1.i1"),
      }),
      signal({
        kind: "request-opened",
        turn: T(1),
        key: "codex-async:q1",
        item: "h1.i1",
        ask: {
          kind: "question",
          questions: [{ id: "0", question: "Which one?" }],
          dismissible: true,
        },
      }),
    ]);
    const asking = log.find((e) => e._tag === "ItemOpened" && e.by.kind === "mate");
    expect(log.at(-1)).toMatchObject({
      _tag: "ItemClosed",
      itemId: asking?._tag === "ItemOpened" ? asking.itemId : "",
      body: { kind: "request", requestId: requestId(r(1), 1) },
    });
  });

  it("is answered once the message reaches the agent, never before", () => {
    const sentNot = playAll([...afterTurn, answered, prepared(2)]);
    expect(closes(sentNot.log)).toEqual([]);
    const { log, state } = playAll([...afterTurn, answered, prepared(2), sentTurn(2)]);
    expect(closes(log)).toEqual(["closed answered"]);
    expect(state.requests).toEqual({});
    expect(state.answering).toEqual({});
  });

  it.each([
    [
      "the agent refused the message",
      [prepared(2), settled(r(2), "provider.send", { kind: "failed", reason: "refused" })],
    ],
    ["a Stop ended the message's run before it went", [stop(2)]],
  ] as const)("opens the question again when %s", (_name, after) => {
    const { log, state } = playAll([...afterTurn, answered, ...after]);
    expect(closes(log)).toEqual(["reopened"]);
    expect(state.requests[requestId(r(1), 1)]).toMatchObject({ answerable: true });
  });

  it("a message a restart cut mid-flight goes again marked, and its arrival answers the question", () => {
    const cut = [
      ...afterTurn,
      answered,
      prepared(2),
      recovered([effectId(r(2), "provider.send", 1)]),
    ];
    const restarted = playAll(cut);
    expect(closes(restarted.log)).toEqual([]);
    expect(restarted.state.runs[r(2)]?.end).toMatchObject({ kind: "cut-by-restart" });
    const { log } = playAll([
      ...cut,
      fired("restart-continuation", r(2)),
      prepared(3),
      opened(3, { session: "s2" }),
      sentTurn(3),
    ]);
    expect(closes(log)).toEqual(["closed answered"]);
  });

  /** The recorded Codex turn up to its async question, and the rest of the trace after it. */
  const recordedAsk = () => {
    const events = readGolden("codex", "async-question");
    const translator = makeTranslator({ driver: "codex", threadId: String(events[0]!.threadId) });
    const toCore = makeToCore({ nativeTurn: translator.nativeTurn });
    const inputs = commandLogAround("codex", events);
    // Codex takes the answer into the running turn: its user message is the second one.
    const injected = inputs.findIndex(
      (input, index) =>
        input.kind === "event" &&
        input.event.type === "item.started" &&
        inputs
          .slice(0, index)
          .some(
            (before) =>
              before.kind === "event" &&
              before.event.type === "item.started" &&
              (before.event.payload as { itemType?: string }).itemType === "user_message",
          ) &&
        (input.event.payload as { itemType?: string }).itemType === "user_message",
    );
    const native = events.find((event) => event.type === "turn.started")?.turnId;
    const core = (part: ReadonlyArray<(typeof inputs)[number]>) =>
      part
        .flatMap((input) => translator.step(input))
        .flatMap((driverSignal) => toCore.step(driverSignal, T0).signals);
    const asking = core(inputs.slice(0, injected));
    const turn = asking.find((one) => one.kind === "turn-started");
    const traceTurn: ReadonlyArray<Step> = [
      send("go"),
      prepared(1),
      opened(1),
      settled(r(1), "provider.send", {
        kind: "ok",
        value: { turn: turn?.kind === "turn-started" ? turn.turn : null, providerTurnId: "x" },
      }),
      { _tag: "ProviderSignals", sessionId: s1, signals: asking } as Command,
    ];
    return { traceTurn, core, inputs, injected, native };
  };

  it("codex/async-question [recorded]: the answer goes into the turn that waits on it, which ends with the agent's reply", () => {
    const { traceTurn, core, inputs, injected, native } = recordedAsk();
    const asked = playAll(traceTurn);
    expect(asked.state.runs[r(1)]?.state).toBe("running");
    const answering: Command = {
      _tag: "Answer",
      requestId: requestId(r(1), 1),
      answer: { answers: { "0": "Red" } },
      summary: "Answered",
    };
    const steer = steered(play([...traceTurn, answering]));
    const replied = core([
      { kind: "send", turn: steer.item as string as TurnHandle, mode: "steer" },
      { kind: "sent", turn: steer.item as string as TurnHandle, nativeTurn: String(native) },
      ...inputs.slice(injected),
    ]);
    const { log, state } = playAll([
      ...traceTurn,
      answering,
      settled(steer.item, "provider.steer", { kind: "ok", value: { as: "steered" } }),
      { _tag: "ProviderSignals", sessionId: s1, signals: replied } as Command,
    ]);
    expect(log.some((e) => e._tag === "RunQueued" && e.runId !== r(1))).toBe(false);
    expect(log.some((e) => e._tag === "EffectRequested" && e.kind === "provider.respond")).toBe(
      false,
    );
    expect(closes(log)).toEqual(["closed answered"]);
    expect(state.runs[r(1)]?.end).toMatchObject({ kind: "completed" });
    // No empty words: the message that asked is the question's place, the reply is a note.
    const bodies = new Map<string, ItemBody>();
    for (const e of log)
      if (e._tag === "ItemOpened" || e._tag === "ItemUpdated" || e._tag === "ItemClosed")
        bodies.set(e.itemId, e.body);
    expect(
      [...bodies.values()].map((body) =>
        body.kind === "note" ? `note ${body.text}` : body.kind === "person" ? "person" : body.kind,
      ),
    ).toEqual(["person", "request", "person", "note Red"]);
  });

  it("codex/async-question [recorded]: after the question is dismissed, the next message goes into the turn that still waits on it, which ends with the agent's reply", () => {
    const { traceTurn, core, inputs, injected, native } = recordedAsk();
    const dismissed: Command = { _tag: "Dismiss", requestId: requestId(r(1), 1) };
    const scene = play([...traceTurn, dismissed, send("Red")]);
    expect(scene.events.some((e) => e._tag === "RunQueued")).toBe(false);
    expect(scene.events.find((e) => e._tag === "ItemOpened")).toMatchObject({
      runId: r(1),
      body: { kind: "person", text: "Red", delivery: { state: "steered" } },
    });
    const steer = steered(scene);
    expect(scene.effects.map((effect) => effect.kind)).toEqual(["provider.steer"]);
    const replied = core([
      { kind: "send", turn: steer.item as string as TurnHandle, mode: "steer" },
      { kind: "sent", turn: steer.item as string as TurnHandle, nativeTurn: String(native) },
      ...inputs.slice(injected),
    ]);
    const { log, state } = playAll([
      ...traceTurn,
      dismissed,
      send("Red"),
      settled(steer.item, "provider.steer", { kind: "ok", value: { as: "steered" } }),
      { _tag: "ProviderSignals", sessionId: s1, signals: replied } as Command,
    ]);
    expect(log.some((e) => e._tag === "RunQueued" && e.runId !== r(1))).toBe(false);
    expect(closes(log)).toEqual(["closed dismissed"]);
    expect(state.runs[r(1)]?.end).toMatchObject({ kind: "completed" });
  });

  it.each([
    ["the turn that asked has ended", [...whileAsking, dismissedQ, ended(1)]],
    ["a message already went into the turn that asked", [...whileAsking, dismissedQ, send("one")]],
    ["the question was answered, not dismissed", [...whileAsking, answered]],
  ] as const)(
    "a message after a dismissed question goes as the next run once %s",
    (_name, given) => {
      const scene = play([...given, send("next")]);
      expect(scene.events.find((e) => e._tag === "RunQueued")).toMatchObject({ runId: r(2) });
      expect(scene.events.find((e) => e._tag === "ItemOpened")).toMatchObject({
        runId: r(2),
        body: { kind: "person", text: "next", delivery: { state: "queued" } },
      });
    },
  );

  it("refuses an answer that leaves a question unanswered", () => {
    const scene = play([
      ...afterTurn,
      { ...answered, answer: { answers: { "0": "pnpm", "1": " " } } } as Command,
    ]);
    expect(scene.decision).toMatchObject({
      _tag: "Reject",
      rejection: { reason: "empty-message" },
    });
  });
});

describe("decide: an answer the provider refused", () => {
  it("a failed answer leaves the run waiting on its request", () => {
    const { state } = playAll([
      send("go"),
      prepared(1),
      opened(1),
      sent(1),
      requestOpened("q"),
      { _tag: "Answer", requestId: requestId(r(1), 1), answer: "yes", summary: "yes" },
      settled(requestId(r(1), 1), "provider.respond", { kind: "failed", reason: "callback gone" }),
    ]);
    expect(state.runs[r(1)]?.state).toBe("waiting");
  });
});

describe("decide: a usage limit, a refused answer and a message's delivery", () => {
  const unknownLimit = signal({ kind: "usage-limit", resetsAt: null });
  const probeOf = (n: number) => wakeId(conversation, "usage-probe", r(n));
  it("a limit whose reset is unknown is probed after 15 minutes, then twice as long, up to an hour", () => {
    const first = playAll([...proofRunning, unknownLimit]);
    expect(first.state.wakes[probeOf(1)]?.dueAt).toBe(T0 + 15 * MINUTE);
    const second = playAll([
      ...proofRunning,
      unknownLimit,
      fired("usage-probe", r(1), T0 + 15 * MINUTE),
      prepared(2),
      signal({ kind: "usage-limit", turn: T(2), resetsAt: null }),
    ]);
    expect(second.state.runs[r(2)]).toMatchObject({ joins: r(1), end: { kind: "usage-limit" } });
    expect(second.state.wakes[probeOf(2)]?.dueAt).toBe(T0 + 45 * MINUTE);
    const capped = playAll([
      ...proofRunning,
      unknownLimit,
      fired("usage-probe", r(1), T0 + 15 * MINUTE),
      prepared(2),
      signal({ kind: "usage-limit", turn: T(2), resetsAt: null }),
      fired("usage-probe", r(2), T0 + 45 * MINUTE),
      prepared(3),
      signal({ kind: "usage-limit", turn: T(3), resetsAt: null }),
      fired("usage-probe", r(3), T0 + 105 * MINUTE),
      prepared(4),
      signal({ kind: "usage-limit", turn: T(4), resetsAt: null }),
    ]);
    expect(capped.state.wakes[probeOf(4)]?.dueAt).toBe(T0 + 165 * MINUTE);
  });
  it("the person writing again lifts a limit whose reset nobody knows", () => {
    const { state } = playAll([...proofRunning, unknownLimit, send("try again")]);
    expect({ run: state.runs[r(2)]?.state, paused: state.pausedUntil }).toEqual({
      run: "admitted",
      paused: null,
    });
    expect(state.wakes[probeOf(1)]).toBeUndefined();
  });
  it("a reset learned later replaces the probe with a resume at that time", () => {
    const reset = T0 + 40 * MINUTE;
    const { state } = playAll([
      ...proofRunning,
      send("queued"),
      unknownLimit,
      signal({ kind: "usage-reset-known", resetsAt: reset }),
    ]);
    expect(state.wakes[probeOf(1)]).toBeUndefined();
    expect(state.wakes[wakeId(conversation, "usage-resume", r(1))]).toMatchObject({
      dueAt: reset,
      joins: r(1),
    });
    expect({ queued: state.runs[r(2)]?.state, paused: state.pausedUntil }).toEqual({
      queued: "queued",
      paused: reset,
    });
  });
  it("an answer the provider can no longer take expires its request", () => {
    const { state, log } = playAll([
      ...proofRunning,
      requestOpened("q"),
      { _tag: "Answer", requestId: requestId(r(1), 1), answer: "yes", summary: "yes" },
      settled(requestId(r(1), 1), "provider.respond", {
        kind: "failed",
        reason: "the callback is gone",
        refused: true,
      }),
    ]);
    expect(log.at(-1)).toMatchObject({ _tag: "RequestClosed", state: "expired" });
    expect(state.requests).toEqual({});
  });
  it("an answer given again after a failed one is a new effect", () => {
    const { log } = playAll([
      ...proofRunning,
      requestOpened("q"),
      { _tag: "Answer", requestId: requestId(r(1), 1), answer: "yes", summary: "yes" },
      settled(requestId(r(1), 1), "provider.respond", { kind: "failed", reason: "timeout" }),
      { _tag: "Answer", requestId: requestId(r(1), 1), answer: "yes", summary: "yes" },
    ]);
    expect(
      log.flatMap((e) =>
        e._tag === "EffectRequested" && e.kind === "provider.respond" ? [e.effectId] : [],
      ),
    ).toEqual([
      effectId(requestId(r(1), 1), "provider.respond", 1),
      effectId(requestId(r(1), 1), "provider.respond", 2),
    ]);
  });
  it.each([
    [
      "a send the provider refused reads refused",
      settled(r(1), "provider.send", { kind: "failed", reason: "socket closed" }),
      "refused",
    ],
    [
      "a send a restart cut mid-flight reads unknown",
      recovered([effectId(r(1), "provider.send", 1)]),
      "unknown",
    ],
  ] as const)("%s", (_name, last, expected) => {
    expect(delivery(playAll([send("go"), prepared(1), opened(1), last]).log)).toBe(expected);
  });
});

describe("decide: a signal delivered again changes nothing", () => {
  const batch = signal(
    { kind: "item-opened", turn: T(1), key: "k", by: { kind: "mate" }, body: note("k") },
    { kind: "item-closed", turn: T(1), key: "k", body: { ...note("k"), streaming: false } },
    { kind: "request-opened", turn: T(1), key: "q", ask },
  );
  it("a batch delivered again under a new batch id records nothing", () => {
    const once = playAll([...proofRunning, batch]);
    const twice = playAll([...proofRunning, batch, batch]);
    expect(twice.log).toEqual(once.log);
  });
  it("a request delivered again after it was answered is not asked again", () => {
    const answered = playAll([
      ...proofRunning,
      requestOpened("q"),
      { _tag: "Answer", requestId: requestId(r(1), 1), answer: "yes", summary: "yes" },
      requestOpened("q"),
    ]);
    expect(answered.log.filter((e) => e._tag === "RequestOpened")).toHaveLength(1);
    expect(answered.state.runs[r(1)]?.state).toBe("running");
  });
  it("an item whose content changed after it closed is updated in place, never opened twice", () => {
    const { log } = playAll([
      ...proofRunning,
      batch,
      signal({
        kind: "item-closed",
        turn: T(1),
        key: "k",
        body: { ...note("k"), text: "the full note", streaming: false },
        afterEnd: true,
      }),
    ]);
    expect(log.filter((e) => e._tag === "ItemOpened" && e.key === "k")).toHaveLength(1);
    expect(log.at(-1)).toMatchObject({
      _tag: "ItemUpdated",
      itemId: `${r(1)}/i/2`,
      body: { text: "the full note" },
    });
  });
});

/** Lost-work notes that would wake the Mate on their own: one held for a message never does. */
const dueLostWork = (
  wakes: ReadonlyArray<{ readonly kind: string; readonly dueAt: number | null }>,
) => wakes.filter((wake) => wake.kind === "lost-work" && wake.dueAt !== Number.MAX_SAFE_INTEGER);

describe("decide: helpers and jobs are items under their run", () => {
  const work = (
    status: Extract<ProviderSignal, { kind: "work-upserted" }>["status"],
    origin: TurnHandle | "unknown" = T(1),
  ): Command =>
    signal({
      kind: "work-upserted",
      work: "w1",
      origin,
      workKind: "helper",
      status,
      title: "Explore",
    });
  it("a helper the agent started is an item under the run whose turn started it", () => {
    const { log, state } = playAll([...proofRunning, work("running")]);
    expect(log.at(-1)).toMatchObject({
      _tag: "ItemOpened",
      runId: r(1),
      key: "w1",
      body: { kind: "work", workKind: "helper", status: "running", title: "Explore" },
    });
    expect(Object.values(state.items).map((item) => item.key)).toEqual(["w1"]);
  });
  it("background work outlives its turn's end and closes on its own end", () => {
    const { log, state } = playAll([
      ...proofRunning,
      work("running"),
      turnEnded,
      work("completed"),
    ]);
    expect(log.filter((e) => e._tag === "ItemClosed").map((e) => e.body.kind)).toEqual(["work"]);
    expect(log.at(-1)).toMatchObject({
      _tag: "ItemClosed",
      runId: r(1),
      body: { status: "completed" },
    });
    expect(state.items).toEqual({});
  });
  it("work whose turn the driver cannot name is filed under the latest run", () => {
    const { log } = playAll([...proofRunning, turnEnded, work("running", "unknown")]);
    expect(log.at(-1)).toMatchObject({ _tag: "ItemOpened", runId: r(1), key: "w1" });
  });

  // Milo's stress run 4, A and C: a helper finished, the row read idle for 1.6–1.9 s and the card
  // folded to "worked", then the turn its end woke opened the card again.
  const selfTurning: ReadonlyArray<Step> = [
    send("go"),
    prepared(1),
    opened(1, { selfTurns: true }),
    sentTurn(1),
  ];
  const turnDue = (state: ConversationState) =>
    Object.values(state.wakes).filter((wake) => wake.kind === "agent-turn-due");
  const second = (status: "running" | "completed"): Command =>
    signal({
      kind: "work-upserted",
      work: "w2",
      origin: T(1),
      workKind: "helper",
      status,
      title: "Explore more",
    });
  it.each([
    {
      when: "its run is over, with an agent that opens its own turns",
      given: [...selfTurning, work("running"), turnEnded],
      ends: "completed" as const,
      due: true,
    },
    {
      when: "the helper failed",
      given: [...selfTurning, work("running"), turnEnded],
      ends: "failed" as const,
      due: true,
    },
    {
      when: "its run still works, which is the conversation going on",
      given: [...selfTurning, work("running")],
      ends: "completed" as const,
      due: false,
    },
    {
      when: "its agent never opens a turn of its own",
      given: [...proofRunning, work("running"), turnEnded],
      ends: "completed" as const,
      due: false,
    },
    {
      when: "its session lost it, which tells no one",
      given: [...selfTurning, work("running"), turnEnded],
      ends: "lost" as const,
      due: false,
    },
  ])(
    "a helper finishing after its run keeps the conversation going until the turn it wakes: $when",
    ({ given, ends, due }) => {
      const { state } = playAll([...given, work(ends)]);
      expect(turnDue(state).map((wake) => wake.dueAt)).toEqual(due ? [T0 + AGENT_TURN_DUE_MS] : []);
    },
  );
  it("a helper that finished while its run worked is still due a turn once the run ends", () => {
    const { state } = playAll([...selfTurning, work("running"), work("completed"), turnEnded]);
    expect(turnDue(state).map((wake) => wake.dueAt)).toEqual([T0 + AGENT_TURN_DUE_MS]);
  });
  it("each turn the agent opens itself takes one finished result; the rest stay due", () => {
    const both = [
      ...selfTurning,
      work("running"),
      second("running"),
      turnEnded,
      work("completed"),
      second("completed"),
      signal({
        kind: "turn-started",
        turn: "bg" as TurnHandle,
        origin: "self",
        providerTurnId: "bg",
      }),
    ];
    expect(turnDue(playAll(both).state)).toEqual([]);
    const reported = playAll([
      ...both,
      signal({
        kind: "turn-ended",
        turn: "bg" as TurnHandle,
        outcome: { kind: "completed" },
        source: "agent",
      }),
    ]);
    expect(turnDue(reported.state)).toHaveLength(1);
  });
  // Milo's stress run 6 (U3): two helpers finished while the run worked and Claude folded both
  // results into that run; the conversation read "Waiting for its helpers" 35 s after the table.
  it.each([
    {
      when: "both finished while its run worked",
      steps: [
        work("running"),
        second("running"),
        work("completed"),
        second("completed"),
        turnEnded,
      ],
    },
    {
      when: "both finished after its run, taken in one turn of its own",
      steps: [
        work("running"),
        second("running"),
        turnEnded,
        work("completed"),
        second("completed"),
        signal({
          kind: "turn-started",
          turn: "bg" as TurnHandle,
          origin: "self",
          providerTurnId: "bg",
        }),
        signal({
          kind: "turn-ended",
          turn: "bg" as TurnHandle,
          outcome: { kind: "completed" },
          source: "agent",
        }),
      ],
    },
  ])("a turn that reports several finished results at once leaves none due: $when", ({ steps }) => {
    const before = playAll([...selfTurning, ...steps]);
    expect(turnDue(before.state)).toHaveLength(1);
    const { state, log } = playAll([...selfTurning, ...steps, signal({ kind: "agent-caught-up" })]);
    expect(turnDue(state)).toEqual([]);
    expect(state.reportsDue).toBe(0);
    expect(log.map((event) => event._tag)).toContain("ReportsTaken");
  });
  it("the agent's word that it is caught up changes nothing when nothing is due", () => {
    const { log } = playAll([...selfTurning, turnEnded]);
    const after = playAll([...selfTurning, turnEnded, signal({ kind: "agent-caught-up" })]);
    expect(after.log).toHaveLength(log.length);
  });
  it("the turn a helper's end wakes, or the wait's bound, ends the wait for it", () => {
    const finished = [...selfTurning, work("running"), turnEnded, work("completed")];
    const woke = playAll([
      ...finished,
      signal({
        kind: "turn-started",
        turn: "bg" as TurnHandle,
        origin: "self",
        providerTurnId: "bg",
      }),
    ]);
    expect(turnDue(woke.state)).toEqual([]);
    const due = turnDue(playAll(finished).state)[0]!;
    const bounded = playAll([
      ...finished,
      { command: { _tag: "WakeFired", wakeId: due.id }, at: due.dueAt },
    ]);
    expect(turnDue(bounded.state)).toEqual([]);
    expect(Object.keys(bounded.state.runs)).toEqual([r(1)]);
  });

  // Milo's stress run 5: a job's end was dated at its start, so the wake it caused was headed by
  // the helper that wake started itself, and a finished job's row read "1s".
  const endedAtOf = (log: ReadonlyArray<KnownEngineEvent>) =>
    log.flatMap((e) =>
      (e._tag === "ItemClosed" || e._tag === "ItemUpdated") && e.body.kind === "work"
        ? [e.body.endedAt]
        : [],
    );
  it.each([
    { how: "its own end", steps: [work("completed")], at: [T0 + 5_000] },
    {
      how: "its session's end",
      steps: [signal({ kind: "session-exited", reason: "exit 137" })],
      at: [T0 + 5_000],
    },
    {
      how: "its end, then a word on it delivered again",
      steps: [work("completed"), { command: work("completed"), at: T0 + 9_000 }],
      at: [T0 + 5_000],
    },
  ])("background work records when it ended, by $how", ({ steps, at }) => {
    const [first, ...rest] = steps;
    const { log } = playAll([
      ...proofRunning,
      work("running"),
      turnEnded,
      { command: first as Command, at: T0 + 5_000 },
      ...rest,
    ]);
    expect(endedAtOf(log)).toEqual(at);
  });
  it("a word on work that ended keeps the time it ended", () => {
    const { log } = playAll([
      ...proofRunning,
      work("running"),
      turnEnded,
      { command: work("completed"), at: T0 + 5_000 },
      {
        command: signal({
          kind: "work-upserted",
          work: "w1",
          origin: T(1),
          workKind: "helper",
          status: "completed",
          title: "Explore",
          report: "Explored again.",
        }),
        at: T0 + 9_000,
      },
    ]);
    expect(endedAtOf(log)).toEqual([T0 + 5_000, T0 + 5_000]);
  });

  const workClosed = (log: ReadonlyArray<KnownEngineEvent>) =>
    log.flatMap((e) =>
      e._tag === "ItemClosed" && e.body.kind === "work" ? [`${e.runId}:${e.body.status}`] : [],
    );
  it("Stop after the turn ended stops the helpers still running in its session", () => {
    const scene = play([...proofRunning, work("running"), turnEnded, stop()]);
    expect(scene.decision).toMatchObject({ _tag: "Accept", step: { result: { runId: r(1) } } });
    expect(scene.effects).toMatchObject([
      { kind: "session.close", payload: { sessionId: "s1", reason: "stop" } },
    ]);
  });
  it.each([
    ["the session's close", [sessionClosed()]],
    ["the bridge's word that the work was cut", [work("lost"), sessionClosed()]],
  ] as const)("helpers a Stop ended close as stopped, by %s, and wake no one", (_, close) => {
    const { log, state } = playAll([...proofRunning, work("running"), turnEnded, stop(), ...close]);
    expect(workClosed(log)).toEqual([`${r(1)}:stopped`]);
    expect(state.items).toEqual({});
    expect(state.session).toBeNull();
    expect(dueLostWork(Object.values(state.wakes))).toEqual([]);
  });
  it("a second Stop while the helpers' session closes is already asked", () => {
    const scene = play([...proofRunning, work("running"), turnEnded, stop(), stop()]);
    expect(scene.decision).toMatchObject({
      _tag: "Reject",
      rejection: { reason: "stop-already-asked" },
    });
  });
  it("Stop after the helpers ended finds nothing to stop", () => {
    const scene = play([...proofRunning, work("running"), turnEnded, work("completed"), stop()]);
    expect(scene.decision).toMatchObject({
      _tag: "Reject",
      rejection: { reason: "run-not-running" },
    });
  });
});

describe("decide: the conversation holds the agent it belongs to", () => {
  const agent = {
    instanceId: "claude-ana",
    driver: "claudeAgent",
    model: "opus",
    profile: { kind: "mate" },
  } as const;
  it("a conversation given its agent runs that agent's model and opens sessions on its instance", () => {
    const { state, log } = playAll([{ _tag: "AssignAgent", agent }, send("go")]);
    expect(state.agent).toEqual(agent);
    expect(state.model).toBe("opus");
    expect(log.find((e) => e._tag === "AgentAssigned")).toMatchObject({ agent, by: ana });
    const scene = play([{ _tag: "AssignAgent", agent }, send("go"), prepared(1)]);
    expect(scene.effects[0]).toMatchObject({
      kind: "session.open",
      payload: { instanceId: "claude-ana", driver: "claudeAgent", model: "opus" },
    });
  });
  it("a model switch is the conversation agent's model", () => {
    const { state } = playAll([
      { _tag: "AssignAgent", agent },
      { _tag: "SwitchModel", model: "sonnet" },
    ]);
    expect(state.agent).toEqual({ ...agent, model: "sonnet" });
  });
  const openedAs = (
    run: number,
    asked: { readonly instanceId: string; readonly model: string | null },
  ) =>
    settled(r(run), "session.open", {
      kind: "ok",
      value: {
        sessionId: "s1",
        driver: "claudeAgent",
        model: asked.model,
        nativeRef: "native-1",
        capabilities: { steer: false },
        requestedModel: asked.model,
        instanceId: asked.instanceId,
      },
    });
  it("a model switched while the session opens rotates it before the next message", () => {
    const scene = play([
      { _tag: "AssignAgent", agent },
      send("go"),
      prepared(1),
      { _tag: "SwitchModel", model: "sonnet" },
      openedAs(1, { instanceId: "claude-ana", model: "opus" }),
      ended(1),
      send("next"),
      prepared(2),
    ]);
    expect(scene.effects).toMatchObject([{ kind: "session.close", payload: { reason: "model" } }]);
  });
  it.each([
    ["another instance of its driver", { ...agent, instanceId: "claude-bo" }],
    ["no model of its own", { ...agent, model: null }],
  ] as const)("a conversation given %s rotates its session before the next message", (_, next) => {
    const scene = play([
      { _tag: "AssignAgent", agent },
      send("go"),
      prepared(1),
      openedAs(1, { instanceId: "claude-ana", model: "opus" }),
      ended(1),
      { _tag: "AssignAgent", agent: next },
      send("next"),
      prepared(2),
    ]);
    expect(scene.effects).toMatchObject([{ kind: "session.close", payload: { reason: "model" } }]);
  });
  it("a conversation given another instance opens a fresh native session; a model switch resumes its own", () => {
    const generationOf = (steps: ReadonlyArray<Step>) =>
      (play(steps).effects[0]?.payload as { readonly generation?: number }).generation;
    const first = [{ _tag: "AssignAgent", agent } as const, send("go")];
    expect(generationOf([...first, prepared(1)])).toBe(1);
    expect(
      generationOf([
        { _tag: "AssignAgent", agent },
        { _tag: "SwitchModel", model: "sonnet" },
        send("go"),
        prepared(1),
      ]),
    ).toBe(1);
    expect(
      generationOf([
        { _tag: "AssignAgent", agent },
        { _tag: "AssignAgent", agent: { ...agent, instanceId: "claude-bo" } },
        send("go"),
        prepared(1),
      ]),
    ).toBe(2);
  });
  it("giving a conversation the agent it already has records nothing", () => {
    const scene = play([
      { _tag: "AssignAgent", agent },
      { _tag: "AssignAgent", agent },
    ]);
    expect(scene.events).toEqual([]);
  });
});

describe("decide: effect lanes", () => {
  it("a send queues in the turn lane; a Stop and an answer in the control lane, never behind it", () => {
    const sendScene = play([send(), prepared(1), opened(1)]);
    const stopScene = play([...running, stop()]);
    const answerScene = play([
      ...waiting,
      { _tag: "Answer", requestId: requestId(r(1), 1), answer: null, summary: "Allowed" },
    ]);
    expect(
      [sendScene, stopScene, answerScene].flatMap((scene) =>
        scene.effects.map((effect) => `${effect.kind}:${effect.lane}`),
      ),
    ).toEqual(["provider.send:turn", "provider.interrupt:control", "provider.respond:control"]);
  });
});

describe("decide: sessions close as the engine asks", () => {
  const closing = (scene: Scene) => scene.state.closing;
  it("a second Stop on a turn whose first was not confirmed closes its session", () => {
    const scene = play([...running, stop(), stop()]);
    expect(scene.effects).toMatchObject([
      { kind: "session.close", lane: "close", payload: { sessionId: "s1", reason: "stop" } },
    ]);
    expect(closing(scene)).toMatchObject({ sessionId: "s1", reason: "stop" });
    expect(scene.state.runs[r(1)]?.state).toBe("running");
  });
  it("the closed session ends a stopped run from the close and the next is admitted", () => {
    const { state, log } = playAll([...running, send("next"), stop(), stop(), sessionClosed()]);
    expect(ends(log)).toEqual(["1:stopped/inferred-from-close"]);
    expect(log.find((e) => e._tag === "SessionClosed")).toMatchObject({ reason: "stop" });
    expect(state.runs[r(2)]?.state).toBe("admitted");
  });
  it("a usage limit that parks its turn closes the session; the resume opens a new one", () => {
    const reset = T0 + 60 * MINUTE;
    const scene = play([
      ...running,
      signal({ kind: "usage-limit", turn: T(1), resetsAt: reset, parks: true }),
    ]);
    expect(scene.effects.map((effect) => effect.kind)).toEqual([
      "workspace.finish",
      "session.close",
    ]);
    const resumed = play([
      ...running,
      signal({ kind: "usage-limit", turn: T(1), resetsAt: reset, parks: true }),
      sessionClosed(),
      fired("usage-resume", r(1), reset),
      prepared(2),
    ]);
    expect(resumed.effects).toMatchObject([
      { kind: "session.open", payload: { resume: "native-1" } },
    ]);
  });
  it("a session with nothing to do starts its idle time, and an admission cancels it", () => {
    const idle = play([...running, turnEnded]);
    expect(idle.state.wakes[wakeId(conversation, "session-idle", "s1")]?.dueAt).toBe(
      T0 + SESSION_IDLE_MS,
    );
    const busy = play([...running, turnEnded, send("again")]);
    expect(busy.events.filter((e) => e._tag === "WakeCancelled")).toMatchObject([
      { wakeId: wakeId(conversation, "session-idle", "s1") },
    ]);
  });
  it("a session idle for its whole time is closed; one busy with background work is kept", () => {
    const idleFired = fired("session-idle", "s1", T0 + SESSION_IDLE_MS);
    const closed = play([...running, turnEnded, idleFired]);
    expect(closed.effects).toMatchObject([{ kind: "session.close", payload: { reason: "idle" } }]);
    const kept = play([
      ...running,
      turnEnded,
      idleFired,
      settled("s1", "session.close", { kind: "ok", value: { kept: true } }),
    ]);
    expect(kept.state.session?.id).toBe("s1");
    expect(kept.events.map((e) => e._tag)).toEqual(["EffectOutcomeRecorded", "WakeArmed"]);
  });
  it("signing out closes the conversation's session", () => {
    const scene = play([...running, turnEnded, { _tag: "CloseSession", reason: "signed-out" }]);
    expect(scene.effects).toMatchObject([
      { kind: "session.close", payload: { reason: "signed-out" } },
    ]);
  });
  it("a session closed under a live run ends the run from the close", () => {
    const { log } = playAll([
      ...running,
      { _tag: "CloseSession", reason: "signed-out" },
      sessionClosed(),
    ]);
    expect(ends(log)).toEqual(["1:crashed/inferred-from-close"]);
  });
});

describe("decide: a turn the agent starts itself while a run is prepared", () => {
  const selfTurn = signal({
    kind: "turn-started",
    turn: "bg" as TurnHandle,
    origin: "self",
    providerTurnId: "bg",
  });
  // Codex takes no message into a running turn: the message waits for the agent's turn to end.
  it("requeues the prepared run, which is sent when the agent's own turn ends", () => {
    const scene = play([...running, turnEnded, send("next"), selfTurn]);
    expect(tags(scene)).toEqual([
      "RunRequeued",
      "RunQueued",
      "RunAdmitted",
      "RunStarted",
      "WakeArmed",
    ]);
    expect(scene.state.queue).toEqual([r(2)]);
    expect(scene.state.runs[r(3)]).toMatchObject({ state: "running", joins: r(1) });
    const after = play([
      ...running,
      turnEnded,
      send("next"),
      selfTurn,
      prepared(2),
      signal({
        kind: "turn-ended",
        turn: "bg" as TurnHandle,
        outcome: { kind: "completed" },
        source: "agent",
      }),
    ]);
    expect(after.state.runs[r(2)]?.state).toBe("sending");
    expect(after.effects.map((effect) => effect.kind)).toEqual(["provider.send"]);
  });
});

// Milo's second stress run, 2026-10-09: two turns Claude opened to report background work ran
// ahead of the person's queued "carry on".
describe("decide: a person's waiting message goes into a turn the agent starts itself", () => {
  const BG = "bg" as TurnHandle;
  const selfTurn = (turn: TurnHandle = BG) =>
    signal({ kind: "turn-started", turn, origin: "self", providerTurnId: turn });
  const bgEnded = (turn: TurnHandle = BG) =>
    signal({ kind: "turn-ended", turn, outcome: { kind: "completed" }, source: "agent" });
  const idle: ReadonlyArray<Step> = [...runningWithSteer, turnEnded];
  const message = (n: number) => `${r(n)}/i/1`;

  it("is steered into that turn, which becomes its run", () => {
    const scene = play([...idle, send("carry on"), selfTurn()]);
    expect(scene.state.runs[r(2)]).toMatchObject({ state: "running", turn: BG });
    expect(scene.state.runs[r(3)]).toBeUndefined();
    expect(scene.effects).toMatchObject([
      {
        kind: "provider.steer",
        payload: { runId: r(2), sessionId: "s1", itemId: message(2), text: "carry on" },
      },
    ]);
    expect(scene.events.find((event) => event._tag === "ItemUpdated")).toMatchObject({
      itemId: message(2),
      body: { kind: "person", text: "carry on", delivery: { state: "steered" } },
    });
  });

  it("the agent's words in that turn land on the message's run, after it", () => {
    const scene = play([
      ...idle,
      send("carry on"),
      selfTurn(),
      signal({ kind: "item-opened", turn: BG, key: "k", by: { kind: "mate" }, body: note("k") }),
    ]);
    expect(scene.events).toMatchObject([
      { _tag: "ItemOpened", runId: r(2), itemId: `${r(2)}/i/2` },
    ]);
  });

  it("the turn's end ends the message's run and the next waiting message is admitted", () => {
    const { state, log } = playAll([...idle, send("first"), send("second"), selfTurn(), bgEnded()]);
    expect(ends(log)).toEqual(["1:completed/agent", "2:completed/agent"]);
    expect(state.activeRunId).toBe(r(3));
    expect(state.runs[r(3)]?.state).toBe("admitted");
  });

  it("of two waiting messages, the first goes into the turn and the second waits for it", () => {
    const scene = play([...idle, send("first"), send("second"), selfTurn()]);
    expect(scene.state.runs[r(2)]?.state).toBe("running");
    expect(scene.state.queue).toEqual([r(3)]);
    expect(scene.effects).toMatchObject([
      { kind: "provider.steer", payload: { itemId: message(2), text: "first" } },
    ]);
  });

  it("the second goes into the agent's next turn of its own as well", () => {
    const scene = play([
      ...idle,
      send("first"),
      send("second"),
      selfTurn(),
      bgEnded(),
      selfTurn("bg2" as TurnHandle),
    ]);
    expect(scene.state.runs[r(3)]).toMatchObject({ state: "running", turn: "bg2" });
    expect(scene.effects).toMatchObject([
      { kind: "provider.steer", payload: { itemId: message(3), text: "second" } },
    ]);
  });

  it("a message stopped before the agent's turn opens never goes into it", () => {
    const scene = play([...idle, send("carry on"), stop(2), selfTurn()]);
    expect(scene.state.runs[r(2)]?.end).toMatchObject({ kind: "stopped" });
    expect(scene.state.runs[r(3)]).toMatchObject({ state: "running", joins: r(2) });
    expect(scene.effects.map((effect) => effect.kind)).not.toContain("provider.steer");
  });

  it("a Stop on a message that went into the agent's turn stops that turn", () => {
    const scene = play([...idle, send("carry on"), selfTurn(), stop(2)]);
    expect(scene.effects).toMatchObject([
      { kind: "provider.interrupt", payload: { runId: r(2), turn: BG } },
    ]);
  });

  it("a steer the agent never took reads refused", () => {
    const scene = play([
      ...idle,
      send("carry on"),
      selfTurn(),
      settled(message(2), "provider.steer", {
        kind: "failed",
        reason: "no live session",
        undelivered: true,
      }),
    ]);
    expect(scene.events.find((event) => event._tag === "ItemUpdated")).toMatchObject({
      itemId: message(2),
      body: { delivery: { state: "refused" } },
    });
  });

  it("an admission that refuses a message already in the agent's turn leaves that turn running", () => {
    const scene = play([
      ...idle,
      send("carry on"),
      selfTurn(),
      prepared(2, { kind: "failed", reason: "the signer is offboarded", refused: true }),
    ]);
    expect(scene.state.runs[r(2)]?.state).toBe("running");
  });

  it("a waiting message steered in as the agent's turn ended runs as a turn of its own", () => {
    const scene = play([
      ...idle,
      send("carry on"),
      selfTurn(),
      bgEnded(),
      signal({
        kind: "turn-started",
        turn: message(2) as TurnHandle,
        origin: "engine",
        providerTurnId: "T3",
      }),
    ]);
    expect(scene.state.runs[r(3)]).toMatchObject({
      state: "running",
      joins: r(2),
      trigger: { kind: "wake", cause: "self" },
    });
  });

  it.each([
    { name: "a plan", given: [send("plan it", { interactionMode: "plan" })] },
    { name: "a maintenance command", given: [send("/compact", { maintenance: true })] },
  ])("$name waits for the agent's turn to end, first in line", ({ given }) => {
    const scene = play([...idle, ...given, selfTurn()]);
    expect(scene.state.queue).toEqual([r(2)]);
    expect(scene.state.runs[r(3)]).toMatchObject({ state: "running", trigger: { cause: "self" } });
    expect(scene.effects.map((effect) => effect.kind)).not.toContain("provider.steer");
  });

  it("a message waiting behind a turn the person started still waits for it", () => {
    const scene = play([...runningWithSteer, send("next")]);
    expect(scene.state.runs[r(2)]?.state).toBe("queued");
    expect(scene.effects).toEqual([]);
  });
});

describe("decide: a message the session could not take", () => {
  const undelivered = (n = 1) =>
    settled(
      r(1),
      "provider.send",
      { kind: "failed", reason: "no live session", undelivered: true },
      n,
    );
  it("goes again once, on a new session", () => {
    const scene = play([send("go"), prepared(1), opened(1), undelivered()]);
    expect(tags(scene)).toEqual([
      "EffectOutcomeRecorded",
      "SessionClosed",
      "RunRequeued",
      "RunAdmitted",
      "EffectRequested",
    ]);
    expect(scene.effects).toMatchObject([{ kind: "session.open" }]);
    const resent = play([
      send("go"),
      prepared(1),
      opened(1),
      undelivered(),
      opened(1, { session: "s2", n: 2 }),
    ]);
    expect(resent.effects).toMatchObject([
      {
        kind: "provider.send",
        effectId: effectId(r(1), "provider.send", 2),
        payload: { text: "go" },
      },
    ]);
  });
  it("ends the run failed, its message refused, when it could not go twice", () => {
    const { state, log } = playAll([
      send("go"),
      prepared(1),
      opened(1),
      undelivered(),
      opened(1, { session: "s2", n: 2 }),
      undelivered(2),
    ]);
    expect(state.runs[r(1)]?.end).toMatchObject({ kind: "failed" });
    expect(delivery(log)).toBe("refused");
  });
  it("a turn the bridge says never reached the agent goes again the same way", () => {
    const scene = play([
      send("go"),
      prepared(1),
      opened(1),
      ended(1, { kind: "undelivered", words: "the session was closed" }),
    ]);
    expect(tags(scene)).toContain("RunRequeued");
    expect(scene.state.runs[r(1)]?.state).toBe("admitted");
  });
});

describe("decide: a restart's words", () => {
  it("are on the run the restart cut, for the person", () => {
    const { state } = playAll([
      ...running,
      {
        _tag: "Recovered",
        bootId: "boot-2" as never,
        cutEffects: [],
        words: "Zerops restarted the service after an update.",
      },
    ]);
    expect(state.runs[r(1)]?.end).toMatchObject({
      kind: "cut-by-restart",
      words: "Zerops restarted the service after an update.",
    });
  });
});

describe("decide: pictures go by reference", () => {
  const picture = {
    type: "image",
    id: "img-1",
    name: "screen.png",
    mimeType: "image/png",
    sizeBytes: 2048,
    asset: {
      id: "occ-1",
      threadId: "mate",
      ownerId: "mate/r/1/i/1",
      name: "screen.png",
      provenance: "upload",
      original: {
        status: "ready",
        digest: "a".repeat(64),
        mimeType: "image/png",
        sizeBytes: 2048,
      },
    },
  } as unknown as ChatImageAttachment;
  it("a message's pictures are in its record and in its send, by their asset reference", () => {
    const queued = play([{ _tag: "Send", text: "look", attachments: [picture] }]);
    expect(queued.events[1]).toMatchObject({ body: { kind: "person", attachments: [picture] } });
    const sending = play([
      { _tag: "Send", text: "look", attachments: [picture] },
      prepared(1),
      opened(1),
    ]);
    expect(sending.effects[0]).toMatchObject({
      kind: "provider.send",
      payload: { attachments: [picture] },
    });
  });
  it("a message of pictures alone is not empty", () => {
    expect(play([{ _tag: "Send", text: " ", attachments: [picture] }]).decision._tag).toBe(
      "Accept",
    );
  });
});

describe("decide: every run acts for someone", () => {
  it("a self-started run and a wake's run act for a person or the wake's principal", () => {
    const { state } = playAll([
      ...running,
      turnEnded,
      signal({
        kind: "turn-started",
        turn: "bg" as TurnHandle,
        origin: "self",
        providerTurnId: "bg",
      }),
      {
        command: { _tag: "ArmWake", kind: "standup", key: "daily", dueAt: T0 },
        by: { kind: "standup", startedBy: "ana" },
      },
    ]);
    expect(Object.values(state.runs).every((run) => run.principal.kind !== "engine")).toBe(true);
  });
});

describe("decide: a run's end says what it cost, how full its context was, why it broke off", () => {
  const endWith = (
    outcome: TurnOutcome,
    facts: { readonly costUsd?: number; readonly contextTokens?: number } = {},
  ): Command => signal({ kind: "turn-ended", turn: T(1), outcome, source: "agent", ...facts });
  const runEnded = (steps: ReadonlyArray<Step>) =>
    playAll(steps).log.find((event) => event._tag === "RunEnded");

  it("a turn's end records its cost and the context the conversation held", () => {
    const end = runEnded([
      ...running,
      endWith({ kind: "completed" }, { costUsd: 0.42, contextTokens: 91_000 }),
    ]);
    expect(end).toMatchObject({ end: { kind: "completed" }, costUsd: 0.42, contextTokens: 91_000 });
    expect(end).not.toHaveProperty("detail");
  });

  it.each([
    [
      "the prompt outgrew the context",
      "overflow",
      { kind: "completed", reason: "prompt_too_long" },
    ],
    [
      "the context refilled faster than it compacts",
      "overflow",
      { kind: "failed", class: "provider", words: "refill", reason: "rapid_refill_breaker" },
    ],
    ["an ACP agent ran out of tokens", "overflow", { kind: "completed", reason: "max_tokens" }],
    [
      "the provider's API failed",
      "provider-error",
      { kind: "failed", class: "provider", words: "API error", reason: "api_error" },
    ],
    [
      "the turn's setup failed",
      "provider-error",
      { kind: "failed", class: "unknown", words: "no setup", reason: "turn_setup_failed" },
    ],
    ["the agent finished", "no detail", { kind: "completed", reason: "end_turn" }],
  ] as const)("%s: its end reads %s", (_name, detail, outcome) => {
    const end = runEnded([...running, endWith(outcome as TurnOutcome)]);
    if (detail === "no detail") expect(end).not.toHaveProperty("detail");
    else expect(end).toMatchObject({ detail });
  });

  it("a run admission refuses ends failed, its refusal in admission's own words", () => {
    const words = "Ana's Claude login is not yours to use.";
    const end = runEnded([send(), prepared(1, { kind: "failed", reason: words, refused: true })]);
    expect(end).toMatchObject({
      end: { kind: "failed", reason: words },
      detail: "refused",
      refusal: words,
    });
  });
});

describe("decide: a crew run's continuation is its crew's", () => {
  const crew: Principal = { kind: "crew", startedBy: "ana" };
  const crewRunning: ReadonlyArray<Step> = [
    { command: send("task card"), by: crew },
    prepared(1),
    opened(1),
    sent(1),
  ];

  it("a restart cuts a crew run and arms no continuation: its crew decides", () => {
    const { state, log } = playAll([...crewRunning, recovered()]);
    expect(state.runs[r(1)]?.end).toEqual({ kind: "cut-by-restart", continuedBy: null });
    expect(Object.values(state.wakes).map((wake) => wake.kind)).not.toContain(
      "restart-continuation",
    );
    expect(log.filter((event) => event._tag === "RunQueued")).toHaveLength(1);
  });

  it("a crew run a restart caught before its send ends cut, for its crew to send again", () => {
    const { state } = playAll([
      { command: send("task card"), by: crew },
      prepared(1),
      opened(1),
      {
        _tag: "Recovered",
        bootId: "boot-2" as never,
        cutEffects: [],
        unstartedEffects: [effectId(r(1), "provider.send", 1)],
      },
    ]);
    expect(state.runs[r(1)]?.state).toBe("ended");
    expect(state.runs[r(1)]?.end?.kind).toBe("cut-by-restart");
    expect(state.queue).toEqual([]);
  });

  it("a usage limit on a crew run resumes nothing: its wake only lifts the pause", () => {
    const reset = T0 + 60 * MINUTE;
    const { state, log } = playAll([
      ...crewRunning,
      signal({ kind: "usage-limit", resetsAt: reset }),
      fired("usage-resume", r(1), reset),
    ]);
    expect(log.filter((event) => event._tag === "RunQueued")).toHaveLength(1);
    expect(state.pausedUntil).toBeNull();
  });

  it("a run in a crewmate's chat is its crew's to carry on after a restart, whoever it ran for", () => {
    const crewmate: ReadonlyArray<Step> = [
      {
        command: {
          _tag: "AssignAgent",
          agent: {
            instanceId: "claudeAgent",
            driver: "claudeAgent",
            model: null,
            profile: { kind: "crewmate", id: "backend", name: "Backend" },
          },
        },
        by: crew,
      },
    ];
    const { state, log } = playAll([...crewmate, ...running, recovered()]);
    expect(state.runs[r(1)]?.end).toEqual({ kind: "cut-by-restart", continuedBy: null });
    expect(Object.values(state.wakes).map((wake) => wake.kind)).not.toContain(
      "restart-continuation",
    );
    expect(log.filter((event) => event._tag === "RunQueued")).toHaveLength(1);
  });

  it("a person's message in a crewmate's chat is continued after a restart like any person's", () => {
    const { state } = playAll([...running, recovered()]);
    expect(Object.values(state.wakes).map((wake) => wake.kind)).toContain("restart-continuation");
  });
});

describe("decide: a conversation's settings reach its agent as V1's do", () => {
  const effortHigh = [{ id: "effort", value: "high" }] as const;
  const agent = {
    instanceId: "claude-ana",
    driver: "claudeAgent",
    model: "opus",
    options: effortHigh,
    profile: { kind: "mate" },
  } as const;
  /** The session opened as asked; `inSessionOptions` is what its driver takes per turn. */
  const openedWith = (run: number, inSessionOptions: "all" | ReadonlyArray<string>) =>
    settled(r(run), "session.open", {
      kind: "ok",
      value: {
        sessionId: "s1",
        driver: "claudeAgent",
        model: "opus",
        nativeRef: "native-1",
        capabilities: { steer: false, inSessionOptions },
        requestedModel: "opus",
        instanceId: "claude-ana",
        options: effortHigh,
        runtimeMode: "full-access",
      },
    });
  const firstRun = (inSession: "all" | ReadonlyArray<string>): ReadonlyArray<Step> => [
    { _tag: "AssignAgent", agent },
    send("go"),
    prepared(1),
    openedWith(1, inSession),
    sentTurn(1),
  ];
  const firstRunOver = (inSession: "all" | ReadonlyArray<string>) => [
    ...firstRun(inSession),
    ended(1),
  ];
  const effortLow: Command = {
    _tag: "SwitchModel",
    model: "opus",
    options: [{ id: "effort", value: "low" }],
  };
  const fastMode: Command = {
    _tag: "SwitchModel",
    model: "opus",
    options: [...effortHigh, { id: "fastMode", value: true }],
  };
  const approvalRequired: Command = { _tag: "SetRuntimeMode", runtimeMode: "approval-required" };
  const work = (status: "running" | "completed"): Command =>
    signal({
      kind: "work-upserted",
      work: "w1",
      origin: T(1),
      workKind: "shell",
      status,
      title: "watch",
    });

  it.each([
    ["Claude's effort", ["effort"], effortLow],
    ["an option its driver reads per turn", "all", fastMode],
  ] as const)("%s goes with the next message, in the same session", (_name, inSession, change) => {
    const scene = play([...firstRunOver(inSession), change, send("next"), prepared(2)]);
    expect(scene.effects).toMatchObject([
      {
        kind: "provider.send",
        payload: {
          sessionId: "s1",
          modelSelection: {
            instanceId: "claude-ana",
            model: "opus",
            options: (change as Extract<Command, { _tag: "SwitchModel" }>).options,
          },
        },
      },
    ]);
  });

  it("an option only a new session runs with closes the session between runs, and the next one resumes it", () => {
    const steps = [...firstRunOver(["effort"]), fastMode, send("next"), prepared(2)];
    expect(play(steps).effects).toMatchObject([
      { kind: "session.close", payload: { reason: "settings" } },
    ]);
    expect(play([...steps, sessionClosed()]).effects).toMatchObject([
      {
        kind: "session.open",
        payload: {
          options: [...effortHigh, { id: "fastMode", value: true }],
          resume: "native-1",
          rotateFrom: "s1",
        },
      },
    ]);
  });

  it("a runtime mode change reopens the session with it between runs, resuming the old one", () => {
    const steps = [...firstRunOver("all"), approvalRequired, send("next"), prepared(2)];
    expect(play(steps).effects).toMatchObject([
      { kind: "session.close", payload: { reason: "settings" } },
    ]);
    expect(play([...steps, sessionClosed()]).effects).toMatchObject([
      {
        kind: "session.open",
        payload: { runtimeMode: "approval-required", resume: "native-1", rotateFrom: "s1" },
      },
    ]);
  });

  it("the session opens with the conversation's runtime mode once a person set it", () => {
    const scene = play([{ _tag: "AssignAgent", agent }, approvalRequired, send("go"), prepared(1)]);
    expect(scene.effects).toMatchObject([
      { kind: "session.open", payload: { runtimeMode: "approval-required" } },
    ]);
    const unset = play([{ _tag: "AssignAgent", agent }, send("go"), prepared(1)]);
    expect(unset.effects[0]?.payload).not.toHaveProperty("runtimeMode");
  });

  it("a setting never cuts a running turn: it applies at the next run", () => {
    const { log, state } = playAll([...firstRun(["effort"]), approvalRequired, fastMode]);
    expect(log.some((e) => e._tag === "SessionClosing")).toBe(false);
    expect(state.runs[r(1)]?.state).toBe("running");
    const next = play([
      ...firstRun(["effort"]),
      approvalRequired,
      fastMode,
      ended(1),
      send("next"),
      prepared(2),
    ]);
    expect(next.effects).toMatchObject([
      { kind: "session.close", payload: { reason: "settings" } },
    ]);
  });

  it.each([
    ["a runtime mode", approvalRequired],
    ["an option only a new session runs with", fastMode],
  ] as const)(
    "%s is refused in V1's words while the agent's background work lives in the session",
    (_name, change) => {
      const scene = play([...firstRun(["effort"]), work("running"), ended(1), change]);
      expect(scene.decision).toEqual({
        _tag: "Reject",
        rejection: { reason: "background-work", detail: BACKGROUND_WORK_WORDS },
      });
      const done = play([...firstRun(["effort"]), work("running"), work("completed"), change]);
      expect(done.decision._tag).toBe("Accept");
    },
  );

  it("an option the session takes per turn is taken while background work lives", () => {
    const scene = play([...firstRun(["effort"]), work("running"), ended(1), effortLow]);
    expect(scene.decision._tag).toBe("Accept");
  });

  it("a message that needs a new session while background work lives is refused in V1's words, the session kept", () => {
    const steps = [...firstRunOver(["effort"]), approvalRequired, work("running")];
    const scene = play([...steps, send("next")]);
    expect(scene.decision).toEqual({
      _tag: "Reject",
      rejection: { reason: "background-work", detail: BACKGROUND_WORK_WORDS },
    });
    const { log, state } = playAll(steps);
    expect(log.some((e) => e._tag === "SessionClosing")).toBe(false);
    expect(state.session?.id).toBe("s1");
  });

  it("a message queued before the work started waits while it lives, never ending it, and goes once it ends", () => {
    const held = [
      ...firstRun(["effort"]),
      send("next"),
      approvalRequired,
      work("running"),
      ended(1),
      prepared(2),
    ];
    const { log, state } = playAll(held);
    expect(state.runs[r(2)]?.state).toBe("admitted");
    expect(
      log.some((e) => e._tag === "SessionClosing" || (e._tag === "RunEnded" && e.runId === r(2))),
    ).toBe(false);
    expect(play([...held, work("completed")]).effects).toMatchObject([
      { kind: "session.close", payload: { reason: "settings" } },
    ]);
  });

  it("background work a restart cut is lost, and holds no setting after it", () => {
    const afterRestart = [
      ...firstRun(["effort"]),
      work("running"),
      ended(1),
      recovered(),
      send("next"),
      prepared(2),
      openedWith(2, ["effort"]),
    ];
    const { log, state } = playAll(afterRestart);
    expect(log).toContainEqual(
      expect.objectContaining({
        _tag: "ItemClosed",
        body: expect.objectContaining({ kind: "work", status: "lost" }),
      }),
    );
    expect(Object.values(state.items).some((item) => item.body.kind === "work")).toBe(false);
    expect(play([...afterRestart, approvalRequired]).decision._tag).toBe("Accept");
  });

  it("a message held for background work whose session dies goes on a new session", () => {
    const held = [
      ...firstRun(["effort"]),
      send("next"),
      approvalRequired,
      work("running"),
      ended(1),
      prepared(2),
    ];
    const scene = play([...held, signal({ kind: "session-exited", reason: "exit 137" })]);
    expect(scene.events).toContainEqual(
      expect.objectContaining({
        _tag: "ItemClosed",
        body: expect.objectContaining({ status: "lost" }),
      }),
    );
    expect(scene.effects).toMatchObject([
      { kind: "session.open", runId: r(2), payload: { runtimeMode: "approval-required" } },
    ]);
  });

  it.each([
    ["plan", { interactionMode: "plan" } as const, "plan"],
    ["default", {}, undefined],
  ] as const)("a %s message goes to the agent in its interaction mode", (_name, extra, mode) => {
    const scene = play([send("go", extra), prepared(1), opened(1)]);
    expect(scene.effects).toMatchObject([{ kind: "provider.send" }]);
    const payload = scene.effects[0]?.payload as { readonly interactionMode?: string } | undefined;
    expect(payload?.interactionMode).toBe(mode);
  });

  it("the conversation keeps its runtime mode and the latest message's interaction mode", () => {
    const { state } = playAll([approvalRequired, send("go", { interactionMode: "plan" })]);
    expect(state.runtimeMode).toBe("approval-required");
    expect(state.interactionMode).toBe("plan");
  });

  it("the same setting again records nothing", () => {
    expect(play([approvalRequired, approvalRequired]).events).toEqual([]);
    const same = play([
      { _tag: "AssignAgent", agent },
      { _tag: "SwitchModel", model: "opus", options: [...effortHigh] },
    ]);
    expect(same.events).toEqual([]);
  });
});

describe("decide: a person picks the conversation's agent", () => {
  const agent = {
    instanceId: "claude",
    driver: "claudeAgent",
    model: "opus",
    profile: { kind: "mate" },
  } as const;
  const choose = (instanceId: string, driver: string, resumes = false): Command => ({
    _tag: "ChooseAgent",
    instanceId,
    driver,
    model: "m2",
    resumes,
  });
  const started: ReadonlyArray<Step> = [{ _tag: "AssignAgent", agent }, ...proofRunning, ended(1)];

  it("before the conversation starts, any agent: its sessions open on it", () => {
    const scene = play([
      { _tag: "AssignAgent", agent },
      choose("codex", "codex"),
      send("go"),
      prepared(1),
    ]);
    expect(scene.effects).toMatchObject([
      { kind: "session.open", payload: { instanceId: "codex", driver: "codex", model: "m2" } },
    ]);
    expect(scene.state.agent?.profile).toEqual({ kind: "mate" });
  });

  it("after it started, another driver is refused in V1's words", () => {
    expect(play([...started, choose("codex", "codex", true)]).decision).toEqual({
      _tag: "Reject",
      rejection: {
        reason: "agent-locked",
        detail: "This conversation is bound to driver 'claudeAgent' and cannot switch to 'codex'.",
      },
    });
  });

  it("after it started, an instance of its driver whose sessions do not resume the old one's is refused", () => {
    expect(play([...started, choose("claude-2", "claudeAgent")]).decision).toMatchObject({
      _tag: "Reject",
      rejection: { reason: "agent-locked" },
    });
  });

  it("after it started, an instance of its driver whose sessions resume the old one's carries the thread over", () => {
    const steps = [...started, choose("claude-2", "claudeAgent", true), send("next"), prepared(2)];
    const scene = play(steps);
    expect(scene.state.threadGeneration).toBe(1);
    expect(scene.effects).toMatchObject([{ kind: "session.close", payload: { reason: "model" } }]);
    expect(play([...steps, sessionClosed()]).effects).toMatchObject([
      {
        kind: "session.open",
        payload: { instanceId: "claude-2", generation: 1, resume: "native-1", rotateFrom: "s1" },
      },
    ]);
  });

  it("the agent it already runs takes a model and its options as a model switch", () => {
    const scene = play([
      ...started,
      {
        _tag: "ChooseAgent",
        instanceId: "claude",
        driver: "claudeAgent",
        model: "sonnet",
        options: [{ id: "effort", value: "low" }],
        resumes: false,
      },
    ]);
    expect(scene.events).toMatchObject([
      { _tag: "ModelSwitched", model: "sonnet", options: [{ id: "effort", value: "low" }] },
    ]);
  });
});

describe("decide: files go with a message", () => {
  const file = {
    type: "file",
    id: "file-1",
    name: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4096,
  } as unknown as ChatFileAttachment;

  it("a message's files are in its record and in its send, by the id they were uploaded under", () => {
    const queued = play([{ _tag: "Send", text: "read this", attachments: [file] }]);
    expect(queued.events[1]).toMatchObject({ body: { kind: "person", attachments: [file] } });
    const sending = play([
      { _tag: "Send", text: "read this", attachments: [file] },
      prepared(1),
      opened(1),
    ]);
    expect(sending.effects[0]).toMatchObject({
      kind: "provider.send",
      payload: { attachments: [file] },
    });
  });

  it("an answer by message carries the files attached to each question, each also named", () => {
    const scene = play([
      ...proofRunning,
      signal({
        kind: "request-opened",
        turn: T(1),
        key: "codex-async:q1",
        ask: {
          kind: "question",
          questions: [{ id: "0", question: "Which spec?" }],
          dismissible: true,
        },
      }),
      ended(1),
      {
        _tag: "Answer",
        requestId: requestId(r(1), 1),
        answer: { answers: { "0": "this one" }, attachmentsByQuestionId: { "0": [file] } },
        summary: "Answered",
      },
    ]);
    expect(scene.events.find((e) => e._tag === "ItemOpened")).toMatchObject({
      body: {
        kind: "person",
        text: "Which spec?\nthis one\nAttached file: notes.pdf (file-1)",
        attachments: [file],
      },
    });
  });

  it("an answer steered into the turn that waits on it carries its files too, each also named", () => {
    const scene = play([
      ...proofRunning,
      signal({
        kind: "request-opened",
        turn: T(1),
        key: "codex-async:q1",
        ask: {
          kind: "question",
          questions: [{ id: "0", question: "Which spec?" }],
          dismissible: true,
        },
      }),
      {
        _tag: "Answer",
        requestId: requestId(r(1), 1),
        answer: { answers: { "0": "this one" }, attachmentsByQuestionId: { "0": [file] } },
        summary: "Answered",
      },
    ]);
    expect(scene.events.find((e) => e._tag === "ItemOpened")).toMatchObject({
      runId: r(1),
      body: {
        kind: "person",
        text: "Which spec?\nthis one\nAttached file: notes.pdf (file-1)",
        attachments: [file],
        delivery: { state: "steered" },
      },
    });
    expect(scene.effects).toMatchObject([
      { kind: "provider.steer", runId: r(1), payload: { attachments: [file] } },
    ]);
  });
});

// Milo, 2026-10-08: the agent ran `sleep 120` in the background and said it would reply once it
// finished; a restart killed the work, nothing re-invoked the agent, and the promise was never kept.
describe("background work its session lost", () => {
  const SLEEP = "Wait two minutes, then print a confirmation";
  const lostNote = (titles: string, how = "by a restart", plural = false) =>
    plural
      ? `Your background work ${titles} were stopped ${how} before they reported.`
      : `Your background work ${titles} was stopped ${how} before it reported.`;
  const upserted = (key: string, title: string, status: "running" | "lost" | "stopped", n = 1) =>
    ({
      kind: "work-upserted",
      work: key,
      origin: T(n),
      workKind: "shell",
      status,
      title,
    }) as const;
  const work = (key: string, title: string, n = 1): Command =>
    signal(upserted(key, title, "running", n));
  /** The bridge's own order as a session dies: its live work lost, then the exit. */
  const exited = (...titles: ReadonlyArray<readonly [string, string]>): Command =>
    signal(...titles.map(([key, title]) => upserted(key, title, "lost")), {
      kind: "session-exited",
      reason: "exit 137",
    });
  const backgrounded: ReadonlyArray<Step> = [...running, work("w1", SLEEP), ended(1)];
  const lostWakeId = wakeId(conversation, "lost-work", "note");
  const sendText = (scene: Scene) =>
    scene.effects.flatMap((effect) =>
      effect.kind === "provider.send" ? [(effect.payload as { text: string }).text] : [],
    );

  it.each([
    {
      name: "a restart",
      steps: [...backgrounded, recovered()],
      text: lostNote(`“${SLEEP}”`),
    },
    {
      name: "its session's process exiting",
      steps: [...backgrounded, exited(["w1", SLEEP])],
      text: lostNote(`“${SLEEP}”`, "when its session ended"),
    },
    {
      name: "its session's process exiting, several items at once",
      steps: [
        ...running,
        work("w1", SLEEP),
        work("w2", "Tail the api log"),
        ended(1),
        exited(["w1", SLEEP], ["w2", "Tail the api log"]),
      ],
      text: lostNote(`“${SLEEP}” and “Tail the api log”`, "when its session ended", true),
    },
    {
      name: "a restart, several items at once",
      steps: [...running, work("w1", SLEEP), work("w2", "Tail the api log"), ended(1), recovered()],
      text: lostNote(`“${SLEEP}” and “Tail the api log”`, "by a restart", true),
    },
  ])(
    "work its session lost wakes the Mate once, on its own lane, naming the work: $name",
    ({ steps, text }) => {
      const { log, state } = playAll(steps);
      expect(
        log.filter((event) => event._tag === "WakeArmed" && event.kind === "lost-work"),
      ).toEqual([expect.objectContaining({ wakeId: lostWakeId, dueAt: T0, joins: r(1), text })]);
      const woken = [...steps, fired("lost-work", "note")];
      expect(playAll(woken).state.runs[r(2)]).toMatchObject({
        joins: r(1),
        trigger: { kind: "wake", cause: "lost-work" },
      });
      expect(sendText(play([...woken, prepared(2), opened(2)]))).toEqual([text]);
      expect(state.runs[r(2)]).toBeUndefined();
    },
  );

  it.each([
    {
      name: "in a crewmate's chat",
      steps: [
        {
          command: {
            _tag: "AssignAgent",
            agent: {
              instanceId: "claudeAgent",
              driver: "claudeAgent",
              model: null,
              profile: { kind: "crewmate", id: "backend", name: "Backend" },
            },
          },
          by: { kind: "crew", startedBy: "ana" },
        } satisfies Input,
        ...backgrounded,
        recovered(),
      ],
    },
    {
      name: "a run its crew started",
      steps: [
        { command: send(), by: { kind: "crew", startedBy: "ana" } } satisfies Input,
        prepared(1),
        opened(1),
        sent(1),
        work("w1", SLEEP),
        ended(1),
        recovered(),
      ],
    },
  ])(
    "work its session lost wakes no turn where its crew carries the task on: $name",
    ({ steps }) => {
      const { log, state } = playAll(steps);
      expect(
        log.filter((event) => event._tag === "WakeArmed" && event.kind === "lost-work"),
      ).toEqual([]);
      expect(Object.values(state.wakes).map((wake) => wake.kind)).not.toContain("lost-work");
    },
  );

  it.each([
    {
      name: "a message queued before the restart",
      steps: [...running, work("w1", SLEEP), send("next"), ended(1), recovered()],
    },
    {
      name: "a message sent after the restart, before the wake fired",
      steps: [...backgrounded, recovered(), send("next")],
    },
    {
      name: "a message sent after the restart, waiting as the wake fired",
      steps: [...backgrounded, recovered(), send("next"), fired("lost-work", "note")],
    },
  ])(
    "a person's message already waiting carries the note, no wake of its own: $name",
    ({ steps }) => {
      const scene = play([...steps, prepared(2), opened(2)]);
      expect(sendText(scene)).toEqual([`${lostNote(`“${SLEEP}”`)}\n\nnext`]);
      expect(Object.keys(scene.state.runs)).toEqual([r(1), r(2)]);
      expect(
        play([...steps, prepared(2), opened(2), sent(2)]).state.wakes[lostWakeId],
      ).toBeUndefined();
    },
  );

  it("a run the restart cut continues with the note, no wake of its own", () => {
    const steps = [...running, work("w1", SLEEP), recovered(), fired("restart-continuation", r(1))];
    const scene = play([...steps, prepared(2), opened(2)]);
    expect(sendText(scene)).toEqual([`${lostNote(`“${SLEEP}”`)}\n\n${CONTINUE_TEXT}`]);
    expect(Object.keys(scene.state.runs)).toEqual([r(1), r(2)]);
  });

  it.each([
    {
      name: "a person's Stop",
      steps: [...running, work("w1", SLEEP), stop(), ended(1), recovered()],
    },
    { name: "an archive", steps: [...backgrounded, { _tag: "Archive" } as Command, recovered()] },
    {
      name: "a session the person closed by a second Stop",
      steps: [...running, work("w1", SLEEP), stop(), stop(), sessionClosed()],
    },
  ])("no wake after $name", ({ steps }) => {
    const { log } = playAll(steps);
    expect(log.some((event) => event._tag === "ItemClosed" && event.body.kind === "work")).toBe(
      true,
    );
    expect(
      dueLostWork(log.flatMap((event) => (event._tag === "WakeArmed" ? [event] : []))),
    ).toEqual([]);
  });

  // Milo, 2026-10-09: the person stopped two helpers and a job living on after the turn; nothing
  // told Milo, who later called the Stop "the restart".
  const HELPER = "Watch the api build";
  const JOB = "Tail the worker log";
  const stoppedNote = lostNote(`“${HELPER}” and “${JOB}”`, "by the person", true);
  const twoLive = [...running, work("w1", HELPER), work("w2", JOB)];
  const stoppedSignals = signal(upserted("w1", HELPER, "stopped"), upserted("w2", JOB, "stopped"));
  it.each([
    {
      name: "a Stop after the turn, by its session's close",
      steps: [...twoLive, ended(1), stop(), sessionClosed()],
      reopens: true,
    },
    {
      name: "a Stop after the turn, by the driver's word that each stopped",
      steps: [...twoLive, ended(1), stop(), stoppedSignals, sessionClosed()],
      reopens: true,
    },
    {
      name: "a Stop on the running turn whose close took the work",
      steps: [
        ...twoLive,
        stop(),
        stoppedSignals,
        ended(1, { kind: "interrupted" }, "stop-confirmed"),
      ],
      reopens: false,
    },
  ])(
    "work a person's Stop ended reaches the agent with the next message, stopped by the person: $name",
    ({ steps, reopens }) => {
      const { log, state } = playAll(steps);
      expect(
        log.flatMap((e) =>
          e._tag === "ItemClosed" && e.body.kind === "work" ? [e.body.status] : [],
        ),
      ).toEqual(["stopped", "stopped"]);
      // Nothing runs for it on its own: the person stopped the work, and the agent learns it when
      // someone writes again.
      expect(playAll([...steps, fired("lost-work", "note")]).state.runs[r(2)]).toBeUndefined();
      expect(state.runs[r(2)]).toBeUndefined();
      const next = [
        ...steps,
        send("carry on"),
        prepared(2),
        ...(reopens ? [opened(2, { session: "s2" })] : []),
      ];
      expect(sendText(play(next))).toEqual([`${stoppedNote}\n\ncarry on`]);
      expect(
        Object.values(play([...next, sent(2)]).state.wakes).map((wake) => wake.kind),
      ).not.toContain("lost-work");
    },
  );

  it("a session change that took the work tells the Mate with the message that changed it", () => {
    const steps = [
      ...backgrounded,
      { _tag: "SwitchModel", model: "sonnet" } as Command,
      send("next"),
      prepared(2),
      signal(upserted("w1", SLEEP, "lost")),
      sessionClosed(),
      opened(2, { session: "s2" }),
    ];
    expect(sendText(play(steps))).toEqual([
      `${lostNote(`“${SLEEP}”`, "by a session change")}\n\nnext`,
    ]);
  });

  it("a note held for a message that never went fires on its own", () => {
    const held = [...running, work("w1", SLEEP), send("next"), ended(1), recovered()];
    const { log } = playAll([...held, stop(2)]);
    expect(
      log.findLast((event) => event._tag === "WakeArmed" && event.kind === "lost-work"),
    ).toMatchObject({ dueAt: T0, text: lostNote(`“${SLEEP}”`) });
    const woken = [...held, stop(2), fired("lost-work", "note"), prepared(3), opened(3)];
    expect(sendText(play(woken))).toEqual([lostNote(`“${SLEEP}”`)]);
  });

  it("a send a restart cut goes again with the note", () => {
    const steps = [
      ...running,
      work("w1", SLEEP),
      send("next"),
      ended(1),
      recovered(),
      prepared(2),
      opened(2),
      recovered([effectId(r(2), "provider.send", 1)]),
      fired("restart-continuation", r(2)),
      prepared(3),
      opened(3),
    ];
    expect(sendText(play(steps))).toEqual([`${lostNote(`“${SLEEP}”`)}\n\n${resentText("next")}`]);
  });
});
