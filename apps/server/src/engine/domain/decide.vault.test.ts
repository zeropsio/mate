import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ConversationId,
  SessionId,
  effectId,
  requestId,
  runId,
  wakeId,
  type KnownEngineEvent,
  type Principal,
  type RequestAsk,
  type TurnHandle,
} from "@t3tools/contracts";

import type { Command } from "./command.ts";
import { decide, vaultAnswerWords } from "./decide.ts";
import { fold, stampEvents } from "./evolve.ts";
import { initialState, type ConversationState } from "./state.ts";

const conversation = ConversationId.make("mate");
const ana: Principal = { kind: "person", subject: "ana" };
const T0 = 1_000_000_000;
const r = (n: number) => runId(conversation, n);
const T = (n: number) => r(n) as string as TurnHandle;
const s1 = SessionId.make("s1");
/** A value shaped like a live Stripe key, made from parts. */
const VALUE = ["sk", "_live_", "Zq".repeat(12)].join("");

const stripe: Extract<RequestAsk, { kind: "vault" }> = {
  kind: "vault",
  key: "STRIPE_SECRET_KEY",
  scope: { kind: "shared" },
  sensitive: true,
  reason: "Stripe charges cards.",
};

const settled = (cause: string, kind: string, value?: unknown): Command => ({
  _tag: "EffectSettled",
  effectId: effectId(cause, kind, 1),
  outcome: value === undefined ? { kind: "ok" } : { kind: "ok", value },
});
const send = (text: string): Command => ({ _tag: "Send", text });
const opened = settled(r(1), "session.open", {
  sessionId: "s1",
  driver: "claude",
  model: null,
  nativeRef: "native-1",
  capabilities: { steer: false },
});
const signal = (
  ...signals: ReadonlyArray<Extract<Command, { _tag: "ProviderSignals" }>["signals"][number]>
): Command => ({
  _tag: "ProviderSignals",
  sessionId: s1,
  signals,
});
const asked = (ask: RequestAsk = stripe) =>
  signal({ kind: "request-opened", turn: T(1), key: "vault:call-1", ask });
const turnEnded = (n: number) =>
  signal({ kind: "turn-ended", turn: T(n), outcome: { kind: "completed" }, source: "agent" });
const answer = (given: unknown, summary = "Saved"): Command => ({
  _tag: "Answer",
  requestId: requestId(r(1), 1),
  answer: given,
  summary,
});
const fire: Command = {
  _tag: "WakeFired",
  wakeId: wakeId(conversation, "vault-answer", requestId(r(1), 1)),
};

const running: ReadonlyArray<Command> = [
  send("set up payments"),
  settled(r(1), "run.prepare"),
  opened,
  settled(r(1), "provider.send", { providerTurnId: "t1" }),
];
const afterTurn: ReadonlyArray<Command> = [...running, asked(), turnEnded(1)];

const play = (steps: ReadonlyArray<Command>) => {
  let state: ConversationState = initialState(conversation);
  const log: Array<KnownEngineEvent> = [];
  let last: ReturnType<typeof decide> | undefined;
  steps.forEach((command, index) => {
    const envelope = {
      commandId: CommandId.make(`c${index}`),
      conversationId: conversation,
      principal: ana,
      command,
    };
    last = decide(state, envelope, T0 + index);
    if (last._tag === "Reject") return;
    const events = stampEvents(state.headSeq, envelope, last.step.events, T0 + index);
    log.push(...events);
    state = fold(state, events);
  });
  return { state, log, last: last! };
};

const of = <Tag extends KnownEngineEvent["_tag"]>(
  log: ReadonlyArray<KnownEngineEvent>,
  tag: Tag,
): ReadonlyArray<Extract<KnownEngineEvent, { _tag: Tag }>> =>
  log.filter((event): event is Extract<KnownEngineEvent, { _tag: Tag }> => event._tag === tag);

describe("decide: a value the agent asks the person for", () => {
  it("does not hold the run, and waits on the person after the turn that asked it ends", () => {
    const { state, log } = play(afterTurn);
    expect(of(log, "RunWaiting")).toEqual([]);
    expect(state.runs[r(1)]?.end).toMatchObject({ kind: "completed" });
    expect(of(log, "RequestClosed")).toEqual([]);
    expect(state.requests[requestId(r(1), 1)]).toMatchObject({ kind: "vault", answerable: true });
  });

  it("saved: the record keeps who and when, and the agent is told where it went in a run of its own", () => {
    const { state, log } = play([...afterTurn, answer({ outcome: "saved" }), fire]);
    expect(of(log, "RequestAnswered")).toMatchObject([
      { requestId: requestId(r(1), 1), by: ana, summary: "Saved to Shared/STRIPE_SECRET_KEY" },
    ]);
    expect(of(log, "RequestClosed")).toEqual([]);
    expect(state.requests).toEqual({});
    expect(of(log, "RunQueued").at(-1)).toMatchObject({
      runId: r(2),
      trigger: { kind: "wake", cause: "vault-answer" },
      joins: r(1),
      principal: ana,
      text: vaultAnswerWords(stripe, "saved"),
    });
  });

  it("declined: the record closes it declined, keeping who and when, and the agent is told", () => {
    const { log } = play([...afterTurn, answer({ outcome: "declined" }, "Declined"), fire]);
    expect(of(log, "RequestAnswered")).toMatchObject([{ by: ana, summary: "Declined" }]);
    expect(of(log, "RequestClosed")).toMatchObject([{ state: "declined" }]);
    expect(of(log, "RunQueued").at(-1)).toMatchObject({
      text: vaultAnswerWords(stripe, "declined"),
    });
  });

  it("answered while the turn that asked still runs, the agent hears it after that turn", () => {
    const { state, log } = play([...running, asked(), answer({ outcome: "saved" }), fire]);
    expect(of(log, "RunQueued").at(-1)).toMatchObject({ runId: r(2), joins: r(1) });
    expect(state.activeRunId).toBe(r(1));
    expect(state.queue).toEqual([r(2)]);
  });

  it("a secret the person gives never reaches the Mate's records or its agent", () => {
    // A client that put the value where only an outcome goes is refused; one that put it in the
    // summary has its words replaced by the engine's own.
    const refused = play([...afterTurn, answer({ outcome: "saved", value: VALUE })]);
    expect(refused.last).toMatchObject({ _tag: "Reject" });
    const { log } = play([...afterTurn, answer({ outcome: "saved" }, VALUE), fire]);
    expect(JSON.stringify(log)).not.toContain(VALUE);
  });

  it.each([
    ["no outcome", {}],
    ["an outcome the engine does not know", { outcome: "maybe" }],
    ["a question's answer", { answers: { "0": "yes" } }],
    ["nothing", null],
  ])("an answer that is not saved or declined is refused: %s", (_name, given) => {
    expect(play([...afterTurn, answer(given)]).last).toMatchObject({ _tag: "Reject" });
  });

  it("is answered once", () => {
    const { last } = play([
      ...afterTurn,
      answer({ outcome: "saved" }),
      answer({ outcome: "saved" }),
    ]);
    expect(last).toMatchObject({ _tag: "Reject" });
  });

  it("keeps no session open: an idle session closes with the ask still open", () => {
    const { state, log } = play([
      ...afterTurn,
      { _tag: "WakeFired", wakeId: wakeId(conversation, "session-idle", s1) },
    ]);
    expect(of(log, "SessionClosing").length).toBe(1);
    expect(state.requests[requestId(r(1), 1)]).toMatchObject({ kind: "vault" });
  });
});

describe("the agent's word on a value it asked for", () => {
  it.each([
    [
      "saved to Shared",
      stripe,
      "saved" as const,
      "Secret request for STRIPE_SECRET_KEY: saved to Shared/STRIPE_SECRET_KEY.",
    ],
    [
      "saved to a service's vault",
      { ...stripe, key: "SMTP_PASSWORD", scope: { kind: "service" as const, hostname: "api" } },
      "saved" as const,
      "Secret request for SMTP_PASSWORD: saved to api/SMTP_PASSWORD.",
    ],
    ["declined", stripe, "declined" as const, "Secret request for STRIPE_SECRET_KEY: declined."],
  ])("%s", (_name, ask, outcome, words) => {
    expect(vaultAnswerWords(ask, outcome)).toBe(words);
  });
});
