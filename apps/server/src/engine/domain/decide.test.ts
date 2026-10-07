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
import { CONTINUE_TEXT, WATCHDOG_SILENCE_MS, decide } from "./decide.ts";
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

const running: ReadonlyArray<Step> = [send(), opened(1), sent(1)];
const waiting: ReadonlyArray<Step> = [...running, requestOpened()];
const runningWithSteer: ReadonlyArray<Step> = [send(), opened(1, { steer: true }), sent(1)];
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
    name: "a person's message queues a run and asks for a session when none is open",
    given: [],
    when: send(),
    events: ["RunQueued", "ItemOpened", "RunAdmitted", "EffectRequested"],
    effects: ["session.open"],
    run: { n: 1, state: "admitted", principal: ana },
  },
  {
    name: "an opened session sends the admitted run",
    given: [send()],
    when: opened(1),
    events: ["EffectOutcomeRecorded", "SessionOpened", "EffectRequested", "RunSending"],
    effects: ["provider.send"],
    run: { n: 1, state: "sending" },
  },
  {
    name: "the provider accepting the send starts the run and delivers the message",
    given: [send(), opened(1)],
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
    given: [send(), opened(1)],
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
    given: [...running, turnEnded],
    when: send("again"),
    events: ["RunQueued", "ItemOpened", "RunAdmitted", "EffectRequested", "RunSending"],
    effects: ["provider.send"],
    run: { n: 2, state: "sending" },
  },
  {
    name: "a request makes the run wait",
    given: running,
    when: requestOpened(),
    events: ["RequestOpened", "RunWaiting"],
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
    events: ["EffectRequested", "RequestAnswered", "RunResumed"],
    effects: ["provider.respond"],
    run: { n: 1, state: "running" },
  },
  {
    name: "a request the provider closes resumes the run",
    given: waiting,
    when: signal({ kind: "request-closed", key: "q1", state: "dismissed" }),
    events: ["RequestClosed", "RunResumed"],
    run: { n: 1, state: "running" },
  },
  {
    name: "the agent ending its turn completes the run and admits the next",
    given: [...running, send("next")],
    when: turnEnded,
    events: ["WakeCancelled", "RunEnded", "RunAdmitted", "EffectRequested", "RunSending"],
    run: { n: 1, end: "completed", source: "agent" },
    also: (scene) => expect(scene.state.runs[r(2)]?.state).toBe("sending"),
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
    events: ["ItemClosed", "RequestClosed", "WakeCancelled", "RunEnded", "SessionClosed"],
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
    also: (scene) => expect(scene.state.runs[r(2)]?.state).toBe("sending"),
  },
  {
    name: "an interrupt that fails still ends the run, said by the Stop",
    given: [...running, stop()],
    when: settled(r(1), "provider.interrupt", { kind: "failed", reason: "no process" }),
    run: { n: 1, end: "stopped", source: "stop-asked" },
  },
  {
    name: "a session that fails to open ends the admitted run failed, inferred",
    given: [send()],
    when: settled(r(1), "session.open", { kind: "failed", reason: "not signed in" }),
    run: { n: 1, end: "failed", source: "inferred-from-effect" },
  },
  {
    name: "a send that fails ends the run failed, inferred",
    given: [send(), opened(1)],
    when: settled(r(1), "provider.send", { kind: "failed", reason: "socket closed" }),
    run: { n: 1, end: "failed", source: "inferred-from-effect" },
  },
  {
    name: "a usage limit ends the run and arms a resume at the reset",
    given: running,
    when: signal({ kind: "usage-limit", resetsAt: T0 + 60 * MINUTE }),
    events: ["WakeCancelled", "RunEnded", "WakeArmed"],
    run: { n: 1, end: "usage-limit", source: "agent" },
    also: (scene) => {
      expect(scene.events[2]).toMatchObject({ kind: "usage-resume", dueAt: T0 + 60 * MINUTE });
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
    events: ["WakeFired", "RunQueued", "RunAdmitted", "EffectRequested", "RunSending"],
    run: { n: 2, state: "sending", joins: 1, cause: "usage-resume", principal: ana },
    also: (scene) => expect(scene.state.pausedUntil).toBeNull(),
  },
  {
    name: "the usage resume gives way to a message sent during the limit",
    given: [...limited, { command: send("me first"), by: bo }],
    when: fired("usage-resume", r(1), T0 + 60 * MINUTE),
    events: ["WakeFired", "RunAdmitted", "EffectRequested", "RunSending"],
    run: { n: 2, state: "sending", principal: bo },
  },
  {
    name: "a restart cuts the live run and arms its continuation",
    given: running,
    when: recovered(),
    events: ["WakeCancelled", "RunEnded", "WakeArmed", "SessionClosed"],
    run: { n: 1, end: "cut-by-restart", source: "inferred-from-restart" },
    also: (scene) =>
      expect(scene.events[2]).toMatchObject({
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
    effects: ["session.open"],
    run: { n: 2, state: "admitted", joins: 1, cause: "restart-continuation", principal: ana },
    also: (scene) => {
      expect(scene.state.runs[r(1)]?.end).toEqual({ kind: "cut-by-restart", continuedBy: r(2) });
      expect(scene.effects[0]?.payload).toMatchObject({ resume: "native-1" });
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
    name: "a restart asks again for the session of an admitted run whose opening it cut",
    given: [send()],
    when: recovered([effectId(r(1), "session.open", 1)]),
    events: ["EffectOutcomeRecorded", "EffectRequested"],
    effects: ["session.open"],
    also: (scene) => expect(scene.effects[0]?.effectId).toBe(effectId(r(1), "session.open", 2)),
  },
  {
    name: "a turn the agent starts itself joins the run whose work it reports",
    given: [...running, turnEnded, { command: send("other"), by: bo }, ended(2)],
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
    events: ["RunResponsive", "ItemOpened"],
  },
  {
    name: "activity is recorded at most every half watchdog",
    given: [...running, { command: signal({ kind: "activity", turn: T(1) }), at: T0 + MINUTE }],
    when: { command: signal({ kind: "activity", turn: T(1) }), at: T0 + WATCHDOG_SILENCE_MS / 2 },
    events: ["RunResponsive"],
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
    name: "a model switch opens a new session for the next run, rotating the old one",
    given: [...running, turnEnded, { _tag: "SwitchModel", model: "opus" }, send("with opus")],
    when: opened(2, { session: "s2" }),
    events: [
      "EffectOutcomeRecorded",
      "SessionClosed",
      "SessionOpened",
      "EffectRequested",
      "RunSending",
    ],
    also: (scene) => expect(scene.events[2]).toMatchObject({ rotatedFrom: s1 }),
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
    name: "a second Stop",
    given: [...running, stop()],
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
const proofRunning: ReadonlyArray<Step> = [send("go"), opened(1), sentTurn(1)];

describe("decide: a turn's signals land on its own run", () => {
  it("the provider's own end of a stopped turn never ends the next run", () => {
    const { log, state } = playAll([
      ...proofRunning,
      send("next"),
      stop(),
      settled(r(1), "provider.interrupt", { kind: "ok" }),
      ended(1, { kind: "interrupted" }, "stop-confirmed"),
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
    const { state, log } = playAll([send("go"), opened(1), ...last]);
    expect(state.runs[r(1)]?.state).toBe("ended");
    expect(delivery(log)).not.toBe("queued");
  });
});

describe("decide: an answer the provider refused", () => {
  it("a failed answer leaves the run waiting on its request", () => {
    const { state } = playAll([
      send("go"),
      opened(1),
      sent(1),
      requestOpened("q"),
      { _tag: "Answer", requestId: requestId(r(1), 1), answer: "yes", summary: "yes" },
      settled(requestId(r(1), 1), "provider.respond", { kind: "failed", reason: "callback gone" }),
    ]);
    expect(state.runs[r(1)]?.state).toBe("waiting");
  });
});
