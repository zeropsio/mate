import { describe, expect, it } from "@effect/vitest";
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
import { ORIGIN_ANSWER_WAKE, decide } from "./decide.ts";
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

describe("decide: an origin ask the person no longer needs to answer", () => {
  it.each([
    [
      "zcp answers that its address already is an origin in HQ: every ask naming that address",
      settledOrigin(KILN, "connected", "kiln"),
      [],
    ],
    [
      "zcp answers so for the address written another way",
      settledOrigin("https://github.com/ACME/kiln.git", "connected", "kiln"),
      [],
    ],
    ["the Mate withdraws the address: every ask naming it", settledOrigin(KILN, "withdrawn"), []],
    [
      "the Mate withdraws one repository's ask: that ask only",
      settledOrigin(KILN, "withdrawn", "apidev"),
      ["webdev"],
    ],
    [
      "zcp answers that another address already is an origin: none",
      settledOrigin("https://github.com/fxck/other", "connected", "other"),
      ["apidev", "webdev"],
    ],
  ])(
    "%s is closed without the person's answer, and the agent hears nothing",
    (_name, settling, open) => {
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
    },
  );

  it("an origin asked again for the same repository supersedes the earlier ask, never another repository's", () => {
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

  it("an ask the person answered stays as the person answered it", () => {
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
});
