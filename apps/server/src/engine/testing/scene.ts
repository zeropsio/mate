import {
  CommandId,
  ConversationId,
  SessionId,
  effectId,
  runId,
  wakeId,
  type EffectOutcome,
  type KnownEngineEvent,
  type Principal,
  type TurnEndSource,
  type TurnHandle,
} from "@t3tools/contracts";
import type {
  Command,
  Decision,
  EffectDraft,
  ProviderSignal,
  TurnOutcome,
} from "../domain/command.ts";
import { decide } from "../domain/decide.ts";
import { fold, stampEvents } from "../domain/evolve.ts";
import { initialState, type ConversationState } from "../domain/state.ts";

const conversation = ConversationId.make("mate");
const ana: Principal = { kind: "person", subject: "ana" };
export const T0 = 1_000_000_000;
export const r = (n: number) => runId(conversation, n);
/** The engine's handle for run n's turn: the run's own id. */
export const T = (n: number) => r(n) as string as TurnHandle;
const s1 = SessionId.make("s1");

interface Input {
  readonly command: Command;
  readonly by?: Principal;
  readonly at?: number;
}
type Step = Command | Input;

interface Scene {
  readonly log: ReadonlyArray<KnownEngineEvent>;
  readonly state: ConversationState;
  readonly decision: Decision;
  readonly events: ReadonlyArray<KnownEngineEvent>;
  readonly effects: ReadonlyArray<EffectDraft>;
}

/** Plays commands through decide and evolve; the scene describes the last one. */
export const play = (
  steps: ReadonlyArray<Step>,
  from: ConversationState = initialState(conversation),
): Scene => {
  let state = from;
  let now = T0;
  const log: Array<KnownEngineEvent> = [];
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
    log.push(...events);
    state = fold(state, events);
    scene = {
      state,
      log,
      decision,
      events,
      effects: decision._tag === "Accept" ? decision.step.effects : [],
    };
  });
  return scene!;
};

export const send = (
  text = "hello",
  extra: Partial<Extract<Command, { _tag: "Send" }>> = {},
): Command => ({
  _tag: "Send",
  text,
  ...extra,
});
export const settled = (
  cause: string,
  kind: string,
  outcome: Extract<Command, { _tag: "EffectSettled" }>["outcome"],
  n = 1,
): Command => ({ _tag: "EffectSettled", effectId: effectId(cause, kind, n), outcome });
export const opened = (
  run: number,
  options: {
    session?: string;
    steer?: boolean;
    steerAttachments?: boolean;
    selfTurns?: boolean;
    stopClosesSession?: boolean;
    n?: number;
  } = {},
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
          ...(options.steerAttachments === undefined
            ? {}
            : { steerAttachments: options.steerAttachments }),
          ...(options.selfTurns === undefined ? {} : { selfTurns: options.selfTurns }),
          ...(options.stopClosesSession === undefined
            ? {}
            : { stopClosesSession: options.stopClosesSession }),
        },
      },
    },
    options.n,
  );
const sent = (run: number) => settled(r(run), "provider.send", { kind: "ok" });
/** Run n's admission settles: its send may go. */
export const prepared = (run: number, outcome: EffectOutcome = { kind: "ok" }) =>
  settled(r(run), "run.prepare", outcome);
/** The session closed as the engine asked. */
export const signal = (...signals: ReadonlyArray<ProviderSignal>): Command => ({
  _tag: "ProviderSignals",
  sessionId: s1,
  signals,
});
const ask = { kind: "approval", requestKind: "command", detail: "rm -rf build" } as const;
export const requestOpened = (key = "q1", answerable = true) =>
  signal({ kind: "request-opened", key, ask, answerable });
export const ended = (
  n = 1,
  outcome: TurnOutcome = { kind: "completed" },
  source: TurnEndSource = "agent",
): Command => signal({ kind: "turn-ended", turn: T(n), outcome, source });
export const turnEnded = ended(1);
export const stop = (run?: number): Command =>
  run === undefined ? { _tag: "Stop" } : { _tag: "Stop", runId: r(run) };
export const note = (key: string) =>
  ({ kind: "note", text: `note ${key}`, streaming: true, answer: false }) as const;

// ── scenes ──────────────────────────────────────────────────────────────────────────────────

export const running: ReadonlyArray<Step> = [send(), prepared(1), opened(1), sent(1)];
export const waiting: ReadonlyArray<Step> = [...running, requestOpened()];

export const fired = (kind: string, key: string, at: number): Input => ({
  command: { _tag: "WakeFired", wakeId: wakeId(conversation, kind, key) },
  at,
});
