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
  type ChatImageAttachment,
  type EffectOutcome,
  type EngineEventTag,
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
  CONTINUE_TEXT,
  SESSION_IDLE_MS,
  USAGE_RESUME_GRACE_MS,
  WATCHDOG_SILENCE_MS,
  decide,
  resentText,
} from "./decide.ts";
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
const play = (steps: ReadonlyArray<Step>): Scene => {
  let state = initialState(conversation);
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
const opened = (run: number, options: { session?: string; steer?: boolean; n?: number } = {}) =>
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
        capabilities: { steer: options.steer ?? false },
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
    effects: ["session.open"],
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
    name: "a usage limit ends the run and arms a resume 30 seconds after the reset",
    given: running,
    when: signal({ kind: "usage-limit", resetsAt: T0 + 60 * MINUTE }),
    events: ["WakeCancelled", "RunEnded", "EffectRequested", "WakeArmed", "WakeArmed"],
    run: { n: 1, end: "usage-limit", source: "agent" },
    also: (scene) => {
      expect(scene.events[3]).toMatchObject({
        kind: "usage-resume",
        dueAt: T0 + 60 * MINUTE + USAGE_RESUME_GRACE_MS,
      });
      expect(scene.state.pausedUntil).toBe(T0 + 60 * MINUTE + USAGE_RESUME_GRACE_MS);
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
      ["a maintenance turn", [send("/compact", { maintenance: true }), opened(1), sent(1)]],
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
      dueAt: reset + USAGE_RESUME_GRACE_MS,
      joins: r(1),
    });
    expect({ queued: state.runs[r(2)]?.state, paused: state.pausedUntil }).toEqual({
      queued: "queued",
      paused: reset + USAGE_RESUME_GRACE_MS,
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
