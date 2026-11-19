import { expect, it } from "vite-plus/test";
import {
  CommandId,
  ConversationId,
  SessionId,
  effectId,
  requestId,
  runId,
  type KnownEngineEvent,
  type Principal,
  type RequestAsk,
  type TurnHandle,
} from "@t3tools/contracts";

import type { Command } from "./command.ts";
import { ORIGIN_ANSWER_WAKE } from "./decide.asks.ts";
import { decide } from "./decide.ts";
import { fold, stampEvents } from "./evolve.ts";
import { initialState, type ConversationState } from "./state.ts";

const conversation = ConversationId.make("mate");
const ana: Principal = { kind: "person", subject: "ana" };
const T0 = 1_000_000_000;
const r = (n: number) => runId(conversation, n);
const T = (n: number) => r(n) as string as TurnHandle;
const s1 = SessionId.make("s1");
const KILN = "https://github.com/acme/kiln";

const origin = (repo: string, url = KILN): Extract<RequestAsk, { kind: "origin" }> => ({
  kind: "origin",
  url,
  repo,
  reason: "Finished work goes back there.",
});

const settled = (cause: string, kind: string, value?: unknown): Command => ({
  _tag: "EffectSettled",
  effectId: effectId(cause, kind, 1),
  outcome: value === undefined ? { kind: "ok" } : { kind: "ok", value },
});
const signal = (
  ...signals: ReadonlyArray<Extract<Command, { _tag: "ProviderSignals" }>["signals"][number]>
): Command => ({ _tag: "ProviderSignals", sessionId: s1, signals });
let calls = 0;
const asked = (ask: Extract<RequestAsk, { kind: "origin" }>) =>
  signal({ kind: "request-opened", turn: T(1), key: `origin:call-${String(++calls)}`, ask });
const settledOrigin = (url: string, how: "connected" | "withdrawn", repo?: string): Command =>
  signal({ kind: "origin-settled", url, how, ...(repo === undefined ? {} : { repo }) });

const running: ReadonlyArray<Command> = [
  { _tag: "Send", text: "set up development for acme/kiln" },
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

/** Decides each command under a literal clock and folds what it emits. */
const play = (steps: ReadonlyArray<Command>) => {
  let state: ConversationState = initialState(conversation);
  const log: Array<KnownEngineEvent> = [];
  steps.forEach((command, index) => {
    const envelope = {
      commandId: CommandId.make(`c${index}`),
      conversationId: conversation,
      principal: ana,
      command,
    };
    const decided = decide(state, envelope, T0 + index);
    if (decided._tag === "Reject") return;
    const events = stampEvents(state.headSeq, envelope, decided.step.events, T0 + index);
    log.push(...events);
    state = fold(state, events);
  });
  return { state, log };
};

const of = <Tag extends KnownEngineEvent["_tag"]>(
  log: ReadonlyArray<KnownEngineEvent>,
  tag: Tag,
): ReadonlyArray<Extract<KnownEngineEvent, { _tag: Tag }>> =>
  log.filter((event): event is Extract<KnownEngineEvent, { _tag: Tag }> => event._tag === tag);

/** The repositories whose origin asks still wait on the person. */
const stillAsked = (state: ConversationState) =>
  Object.values(state.requests).flatMap((request) =>
    request.origin === undefined ? [] : [request.origin.repo],
  );

/** apidev and webdev asked about one address, then `settling`: what stays open, and what the agent hears. */
const settle = (settling: Command, open: ReadonlyArray<string>) => {
  const { state, log } = play([
    ...running,
    asked(origin("apidev")),
    asked(origin("webdev")),
    settling,
  ]);
  expect(stillAsked(state)).toEqual(open);
  expect(of(log, "RequestAnswered")).toEqual([]);
  expect(of(log, "RequestClosed").every((closed) => closed.state === "dismissed")).toBe(true);
  expect(of(log, "WakeArmed").filter((wake) => wake.kind === ORIGIN_ANSWER_WAKE)).toEqual([]);
};

// witness: apps/server/src/engine/domain/decide.signals.ts | sameOriginAddress(asked.url, url) && (repo === undefined || asked.repo === repo) → sameOriginAddress(asked.url, url)
it("ED1: An origin ask is closed without the person's answer, and the agent hears nothing, once zcp says its repository's address already is an origin in HQ or the Mate withdraws it; another repository's ask of that address and an ask of another address stay open", () => {
  // zcp told the agent the person's pick would come for webdev: that ask waits for its own word.
  settle(settledOrigin(KILN, "connected", "apidev"), ["webdev"]);
  settle(settledOrigin(KILN, "withdrawn", "apidev"), ["webdev"]);
  settle(settledOrigin("https://github.com/fxck/other", "connected", "apidev"), [
    "apidev",
    "webdev",
  ]);
});

// witness: apps/server/src/engine/domain/decide.signals.ts | asked.repo === repo && sameOriginAddress(asked.url, url) → sameOriginAddress(asked.url, url)
it("ED2: An origin asked again for the same repository supersedes the earlier ask, never another repository's", () => {
  const { state, log } = play([
    ...running,
    asked(origin("apidev")),
    asked(origin("webdev")),
    asked(origin("apidev")),
  ]);
  expect(stillAsked(state).toSorted()).toEqual(["apidev", "webdev"]);
  expect(of(log, "RequestClosed")).toMatchObject([
    { requestId: requestId(r(1), 1), state: "dismissed" },
  ]);
});

// witness: apps/server/src/engine/domain/decide.asks.ts | if (ended.declined) { → if (!ended.declined) {
it("ED3: An origin ask the person answered stays as the person answered it", () => {
  const { log } = play([
    ...running,
    asked(origin("apidev")),
    {
      _tag: "Answer",
      requestId: requestId(r(1), 1),
      answer: { outcome: "connected" },
      summary: "Kept on GitHub",
    },
    settledOrigin(KILN, "withdrawn"),
  ]);
  expect(of(log, "RequestAnswered")).toMatchObject([{ summary: "Kept on GitHub" }]);
  expect(of(log, "RequestClosed")).toEqual([]);
});
