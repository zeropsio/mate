import { expect, it } from "vite-plus/test";
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
import { vaultAnswerWords } from "./decide.asks.ts";
import { decide } from "./decide.ts";
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
const apiOwn: typeof stripe = { ...stripe, scope: { kind: "service", hostname: "api" } };

const settled = (cause: string, kind: string, value?: unknown): Command => ({
  _tag: "EffectSettled",
  effectId: effectId(cause, kind, 1),
  outcome: value === undefined ? { kind: "ok" } : { kind: "ok", value },
});
const signal = (
  ...signals: ReadonlyArray<Extract<Command, { _tag: "ProviderSignals" }>["signals"][number]>
): Command => ({ _tag: "ProviderSignals", sessionId: s1, signals });
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
const stored = (
  keys: ReadonlyArray<string>,
  scope: (typeof stripe)["scope"] = { kind: "shared" },
) => signal({ kind: "vault-stored", keys, scope });

const running: ReadonlyArray<Command> = [
  { _tag: "Send", text: "set up payments" },
  settled(r(1), "run.prepare"),
  settled(r(1), "session.open", {
    sessionId: "s1",
    driver: "claude",
    model: null,
    nativeRef: "native-1",
    capabilities: { steer: false },
  }),
  settled(r(1), "provider.send", { providerTurnId: "t1" }),
];
const afterTurn: ReadonlyArray<Command> = [...running, asked(), turnEnded(1)];

/** Decides each command as Ana under a literal clock and folds what it emits; the last decision. */
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

// witness: apps/server/src/engine/domain/decide.signals.ts | (signal.ask.kind === "question" && signal.ask.dismissible) || isCardAsk(signal.ask.kind); → (signal.ask.kind === "question" && signal.ask.dismissible);
it("ED24: A value the agent asks the person for does not hold the run, and waits on the person after the turn that asked it ends", () => {
  const { state, log } = play(afterTurn);
  expect(of(log, "RunWaiting")).toEqual([]);
  expect(state.runs[r(1)]?.end).toMatchObject({ kind: "completed" });
  expect(of(log, "RequestClosed")).toEqual([]);
  expect(state.requests[requestId(r(1), 1)]).toMatchObject({ kind: "vault", answerable: true });
});

// witness: apps/server/src/engine/domain/decide.asks.ts | text: vaultAnswerWords(request.vault, outcome, restarts), → text: vaultAnswerWords(request.vault, "declined", restarts),
it("ED25: A value the person saved keeps who saved it and when, and the agent is told where it went in a run of its own", () => {
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

// witness: apps/server/src/engine/domain/decide.asks.ts | state: "declined", → state: "dismissed",
it("ED26: A value the person declined closes its ask declined, keeping who and when, and the agent is told", () => {
  const { log } = play([...afterTurn, answer({ outcome: "declined" }, "Declined"), fire]);
  expect(of(log, "RequestAnswered")).toMatchObject([{ by: ana, summary: "Declined" }]);
  expect(of(log, "RequestClosed")).toMatchObject([{ state: "declined" }]);
  expect(of(log, "RunQueued").at(-1)).toMatchObject({
    text: vaultAnswerWords(stripe, "declined"),
  });
});

// witness: apps/server/src/engine/domain/decide.asks.ts | if (outcome !== "saved" || Object.keys(rest).length > 0) return null; → if (outcome !== "saved") return null;
it("ED27: A secret the person gives never reaches the Mate's records or its agent", () => {
  // A client that put the value where only an outcome goes is refused; one that put it in the
  // summary has its words replaced by the engine's own.
  const refused = play([...afterTurn, answer({ outcome: "saved", value: VALUE })]);
  expect(refused.last).toMatchObject({ _tag: "Reject" });
  const { log } = play([...afterTurn, answer({ outcome: "saved" }, VALUE), fire]);
  expect(JSON.stringify(log)).not.toContain(VALUE);
});

// witness: apps/server/src/engine/domain/decide.asks.ts | if (outcome !== "saved" || Object.keys(rest).length > 0) return null; → if (Object.keys(rest).length > 0) return null;
it("ED28: A value's ask is answered once, and an answer that is not saved or declined is refused", () => {
  const twice = play([...afterTurn, answer({ outcome: "saved" }), answer({ outcome: "saved" })]);
  expect(twice.last).toMatchObject({ _tag: "Reject" });
  // No outcome.
  expect(play([...afterTurn, answer({})]).last).toMatchObject({ _tag: "Reject" });
  // An outcome the engine does not know.
  expect(play([...afterTurn, answer({ outcome: "maybe" })]).last).toMatchObject({ _tag: "Reject" });
  // A question's answer.
  expect(play([...afterTurn, answer({ answers: { "0": "yes" } })]).last).toMatchObject({
    _tag: "Reject",
  });
  // Nothing.
  expect(play([...afterTurn, answer(null)]).last).toMatchObject({ _tag: "Reject" });
});

// witness: apps/server/src/engine/domain/decide.signals.ts | : signal.scope.kind === "service" && signal.scope.hostname === scope.hostname; → : signal.scope.kind === "service";
it("ED29: The agent storing the key it asked the person for, in the vault it asked for, answers the ask saved; storing another key, or in another vault, leaves the ask open", () => {
  const answers = (ask: typeof stripe, storing: Command, summary: string) => {
    const { state, log } = play([...running, asked(ask), turnEnded(1), storing]);
    expect(of(log, "RequestAnswered")).toMatchObject([{ requestId: requestId(r(1), 1), summary }]);
    expect(of(log, "RequestClosed")).toEqual([]);
    expect(state.requests).toEqual({});
  };
  const staysOpen = (ask: typeof stripe, storing: Command) => {
    const { state, log } = play([...running, asked(ask), turnEnded(1), storing]);
    expect(of(log, "RequestAnswered")).toEqual([]);
    expect(state.requests[requestId(r(1), 1)]).toMatchObject({ kind: "vault", answerable: true });
  };
  // Shared.
  answers(stripe, stored(["STRIPE_SECRET_KEY"]), "Saved to Shared/STRIPE_SECRET_KEY");
  // A service's own vault.
  answers(
    apiOwn,
    stored(["SUPPORT_EMAIL", "STRIPE_SECRET_KEY"], { kind: "service", hostname: "api" }),
    "Saved to api/STRIPE_SECRET_KEY",
  );
  // Another key.
  staysOpen(stripe, stored(["STRIPE_PUBLIC_KEY"]));
  // The key in a service's vault, asked for Shared.
  staysOpen(stripe, stored(["STRIPE_SECRET_KEY"], { kind: "service", hostname: "api" }));
  // The key in Shared, asked for a service's vault.
  staysOpen(apiOwn, stored(["STRIPE_SECRET_KEY"]));
  // The key in another service's vault.
  staysOpen(apiOwn, stored(["STRIPE_SECRET_KEY"], { kind: "service", hostname: "web" }));
});
