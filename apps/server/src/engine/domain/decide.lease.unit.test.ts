import { expect, it } from "vite-plus/test";
import {
  CommandId,
  ConversationId,
  SessionId,
  effectId,
  runId,
  type KnownEngineEvent,
  type Principal,
  type ThreadLease,
  type TurnHandle,
} from "@t3tools/contracts";

import type { Command, Decision, EffectDraft, ProviderSignal } from "./command.ts";
import { decide } from "./decide.ts";
import { fold, stampEvents } from "./evolve.ts";
import { initialState, type ConversationState } from "./state.ts";

const conversation = ConversationId.make("mate");
const engine: Principal = { kind: "engine" };
const ana: Principal = { kind: "person", subject: "ana" };
const T0 = 1_000_000_000;
const r = (n: number) => runId(conversation, n);
const turn = (n: number) => r(n) as string as TurnHandle;
const s1 = SessionId.make("s1");

const webpool3: ThreadLease = { alias: "webpool-3", pool: "webpool", branch: "feat-x" };
const webpool4: ThreadLease = { alias: "webpool-4", pool: "webpool", branch: "feat-y" };

interface Scene {
  readonly state: ConversationState;
  readonly decision: Decision;
  readonly events: ReadonlyArray<KnownEngineEvent>;
  readonly effects: ReadonlyArray<EffectDraft>;
}

/** Decides one command from a scene's state under a literal clock and folds what it emits. */
const step = (state: ConversationState, command: Command, id: string): Scene => {
  const envelope = {
    commandId: CommandId.make(id),
    conversationId: conversation,
    principal: command._tag === "Send" ? ana : engine,
    command,
  };
  const decision = decide(state, envelope, T0);
  const events =
    decision._tag === "Accept"
      ? stampEvents(state.headSeq, envelope, decision.step.events, T0)
      : [];
  return {
    state: fold(state, events),
    decision,
    events,
    effects: decision._tag === "Accept" ? decision.step.effects : [],
  };
};

/** Plays commands from a fresh conversation; the scene is the last one's. */
const play = (steps: ReadonlyArray<Command>): Scene => {
  let scene: Scene | undefined;
  steps.forEach((command, index) => {
    scene = step(scene?.state ?? initialState(conversation), command, `c${index}`);
  });
  return scene!;
};
const playFrom = (scene: Scene, command: Command): Scene =>
  step(scene.state, command, `settle-${scene.state.headSeq}`);

const send = (text = "hello"): Command => ({ _tag: "Send", text });
const opened = (run: number): Command => ({
  _tag: "EffectSettled",
  effectId: effectId(r(run), "session.open", 1),
  outcome: {
    kind: "ok",
    value: {
      sessionId: "s1",
      driver: "claude",
      model: null,
      nativeRef: "native-1",
      capabilities: { steer: false },
    },
  },
});
const prepared = (run: number): Command => ({
  _tag: "EffectSettled",
  effectId: effectId(r(run), "run.prepare", 1),
  outcome: { kind: "ok" },
});
const sent = (run: number): Command => ({
  _tag: "EffectSettled",
  effectId: effectId(r(run), "provider.send", 1),
  outcome: { kind: "ok" },
});
const signal = (...signals: ReadonlyArray<ProviderSignal>): Command => ({
  _tag: "ProviderSignals",
  sessionId: s1,
  signals,
});
const ended = (n = 1): Command =>
  signal({ kind: "turn-ended", turn: turn(n), outcome: { kind: "completed" }, source: "agent" });

const bind = (lease: ThreadLease): Command => ({ _tag: "BindLease", lease });
const released = (alias: string): Command => ({ _tag: "UnbindLease", ended: alias });
const archive: Command = { _tag: "Archive" };
const releaseOf = (scene: Scene) =>
  scene.effects.filter((effect) => effect.kind === "lease.release");
/** The release an archive asked for settles with what zcp answered. */
const settled = (scene: Scene, value: unknown): Command => ({
  _tag: "EffectSettled",
  effectId: releaseOf(scene)[0]!.effectId,
  outcome: { kind: "ok", value },
});
const receipt = (scene: Scene) =>
  scene.events.find((event) => event._tag === "LeaseReleaseSettled");

// witness: apps/server/src/engine/domain/decide.ts | if (b.state.lease === null) b.emit({ _tag: "LeaseBound" → b.emit({ _tag: "LeaseBound"
it("ED5: The first lease a conversation's agent acquires binds the conversation, and a second acquire binds nothing", () => {
  expect(play([bind(webpool3)]).state.lease).toEqual(webpool3);
  const second = play([bind(webpool3), bind(webpool4)]);
  expect(second.decision._tag).toBe("Accept");
  expect(second.events).toEqual([]);
  expect(second.state.lease).toEqual(webpool3);
});

// witness: apps/server/src/engine/domain/decide.ts | if (bound !== null && bound.alias === command.ended) { → if (bound !== null) {
it("ED6: A release of its own lease unbinds the conversation; a release of another lease does not", () => {
  const other = play([bind(webpool3), released("webpool-4")]);
  expect(other.events).toEqual([]);
  expect(other.state.lease).toEqual(webpool3);
  expect(play([bind(webpool3), released("webpool-3")]).state.lease).toBeNull();
});

// witness: apps/server/src/engine/domain/evolve.ts | return { ...state, lease: event.lease }; → return { ...state, lease: event.lease, lastNativeRef: null };
it("ED7: A lease bound or unbound between sessions keeps the agent's conversation where it works: the next session resumes it and names no lease", () => {
  // zcp keeps its state in the session's working directory: a lease never moves the agent's sessions.
  const nextOpen = (before: ReadonlyArray<Command>, after: ReadonlyArray<Command>) =>
    play([
      ...before,
      send(),
      prepared(1),
      opened(1),
      sent(1),
      ended(1),
      signal({ kind: "session-exited", reason: "idle" }),
      ...after,
      send(),
      prepared(2),
    ]).effects.find((effect) => effect.kind === "session.open")?.payload;
  const bound = nextOpen([], [bind(webpool3)]);
  expect(bound).toMatchObject({ resume: "native-1", generation: 1 });
  expect(bound).not.toHaveProperty("fresh");
  expect(bound).not.toHaveProperty("lease");
  const unbound = nextOpen([bind(webpool3)], [released("webpool-3")]);
  expect(unbound).toMatchObject({ resume: "native-1", generation: 1 });
  expect(unbound).not.toHaveProperty("fresh");
  expect(unbound).not.toHaveProperty("lease");
});

// witness: apps/server/src/engine/domain/decide.ts | Object.values(b.state.effects).some((effect) => effect.kind === "lease.release") → Object.values(b.state.effects).every((effect) => effect.kind === "lease.release")
it("ED8: Archiving a conversation bound to a lease asks zcp to release its branch once; archiving again, or with no lease or no branch, asks for no release", () => {
  const withRepo: ThreadLease = { ...webpool3, repo: "https://hq.example/git/app/web.git" };
  expect(releaseOf(play([bind(withRepo), archive])).map((effect) => effect.payload)).toEqual([
    { alias: "webpool-3", branch: "feat-x", repo: "https://hq.example/git/app/web.git" },
  ]);
  expect(releaseOf(play([archive]))).toEqual([]);
  expect(releaseOf(play([bind({ ...webpool3, branch: null }), archive]))).toEqual([]);
  const again = play([bind(webpool3), archive, archive]);
  expect(again.decision._tag).toBe("Accept");
  expect(again.effects).toEqual([]);
  // Unarchived and archived again while the first release is still outstanding.
  let state = initialState(conversation);
  const asked: Array<EffectDraft> = [];
  for (const [index, command] of [
    bind(webpool3),
    archive,
    { _tag: "Unarchive" } satisfies Command,
    archive,
  ].entries()) {
    const scene = step(state, command, `again-${index}`);
    asked.push(...releaseOf(scene));
    state = scene.state;
  }
  expect(state.archived).toBe(true);
  expect(asked).toHaveLength(1);
});

// witness: apps/server/src/engine/domain/decide.ts | result.outcome === "released" || → result.outcome === "released" &&
it("ED9: A release zcp made unbinds the conversation and records the receipt", () => {
  const asked = play([bind(webpool3), archive]);
  const result = { outcome: "released", leases: [{ lease: "webpool-3", outcome: "kept-warm" }] };
  const scene = playFrom(asked, settled(asked, { alias: "webpool-3", branch: "feat-x", result }));
  expect(receipt(scene)).toMatchObject({ alias: "webpool-3", branch: "feat-x", result });
  expect(scene.state.lease).toBeNull();
});

// witness: apps/server/src/engine/domain/decide.ts | if (went && b.state.lease?.alias === alias) { → if (b.state.lease?.alias === alias) {
it("ED10: A release zcp refused, failed or withdrew keeps the binding and records only the receipt", () => {
  const settle = (result: unknown) => {
    const asked = play([bind(webpool3), archive]);
    const scene = playFrom(asked, settled(asked, { alias: "webpool-3", branch: "feat-x", result }));
    expect(receipt(scene)).toMatchObject({ result });
    expect(scene.state.lease).toEqual(webpool3);
  };
  settle({
    outcome: "refused",
    leases: [{ lease: "webpool-3", unsaved: { files: ["src/app.ts"], commits: [] } }],
  });
  settle({ outcome: "refused", leases: [{ lease: "webpool-3", inUse: { sessions: 2 } }] });
  settle({ outcome: "failed", reason: "zcp did not answer within 180 s" });
  settle({ outcome: "withdrawn" });
});

// witness: apps/server/src/engine/domain/decide.ts | result.released?.some((lease) => lease.lease === alias) === true); → result.released !== undefined);
it("ED11: A release zcp made only in part unbinds only what went", () => {
  const partly = (went: ReadonlyArray<string>) => {
    const asked = play([bind(webpool3), archive]);
    const result = {
      outcome: "failed",
      reason: "the pool kept one",
      released: went.map((lease) => ({ lease, outcome: "removed" })),
    };
    const scene = playFrom(asked, settled(asked, { alias: "webpool-3", branch: "feat-x", result }));
    expect(receipt(scene)).toMatchObject({ result });
    return scene.state.lease;
  };
  expect(partly(["webpool-3", "apipool-1"])).toBeNull();
  expect(partly(["apipool-1"])).toEqual(webpool3);
});
