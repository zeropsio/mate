import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ConversationId,
  type KnownEngineEvent,
  type Principal,
  type ThreadLease,
} from "@t3tools/contracts";

import { ended, opened, prepared, send, sent, signal } from "../testing/fixtures.ts";
import type { Command, Decision, EffectDraft } from "./command.ts";
import { decide } from "./decide.ts";
import { fold, stampEvents } from "./evolve.ts";
import { initialState, type ConversationState } from "./state.ts";

const conversation = ConversationId.make("mate");
const engine: Principal = { kind: "engine" };
const ana: Principal = { kind: "person", subject: "ana" };
const T0 = 1_000_000_000;

const webpool3: ThreadLease = { alias: "webpool-3", pool: "webpool", branch: "feat-x" };
const webpool4: ThreadLease = { alias: "webpool-4", pool: "webpool", branch: "feat-y" };

interface Scene {
  readonly state: ConversationState;
  readonly decision: Decision;
  readonly events: ReadonlyArray<KnownEngineEvent>;
  readonly effects: ReadonlyArray<EffectDraft>;
}

const play = (steps: ReadonlyArray<Command>): Scene => {
  let state = initialState(conversation);
  let scene: Scene | undefined;
  steps.forEach((command, index) => {
    const envelope = {
      commandId: CommandId.make(`c${index}`),
      conversationId: conversation,
      principal: command._tag === "Send" ? ana : engine,
      command,
    };
    const decision = decide(state, envelope, T0);
    const events =
      decision._tag === "Accept"
        ? stampEvents(state.headSeq, envelope, decision.step.events, T0)
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

const bind = (lease: ThreadLease): Command => ({ _tag: "BindLease", lease });
const released = (alias: string): Command => ({ _tag: "UnbindLease", ended: alias });

describe("a conversation's lease", () => {
  it("a conversation has no lease until its agent acquires one", () => {
    expect(initialState(conversation).lease).toBeNull();
  });

  it("the lease its agent acquired binds the conversation", () => {
    const scene = play([bind(webpool3)]);
    expect(scene.events.map((event) => event._tag)).toEqual(["LeaseBound"]);
    expect(scene.state.lease).toEqual(webpool3);
  });

  it("the first lease stays the conversation's: a second acquire binds nothing", () => {
    const scene = play([bind(webpool3), bind(webpool4)]);
    expect(scene.decision._tag).toBe("Accept");
    expect(scene.events).toEqual([]);
    expect(scene.state.lease).toEqual(webpool3);
  });

  it("a release of its lease unbinds the conversation; a release of another lease does not", () => {
    const other = play([bind(webpool3), released("webpool-4")]);
    expect(other.events).toEqual([]);
    expect(other.state.lease).toEqual(webpool3);

    const own = play([bind(webpool3), released("webpool-3")]);
    expect(own.events.map((event) => event._tag)).toEqual(["LeaseUnbound"]);
    expect(own.state.lease).toBeNull();
  });

  it("nothing unbinds a conversation without a lease", () => {
    expect(play([released("webpool-3")]).events).toEqual([]);
  });

  it("after a release the next lease its agent acquires binds it", () => {
    expect(play([bind(webpool3), released("webpool-3"), bind(webpool4)]).state.lease).toEqual(
      webpool4,
    );
  });

  // zcp keeps its state (its lease records, its work session) in the session's working directory,
  // so a session that moved into the lease would leave zcp's records behind: a lease changes what
  // the person's views show, never where the agent's sessions open or what they resume.
  it.each<{
    readonly name: string;
    readonly before: ReadonlyArray<Command>;
    readonly after: ReadonlyArray<Command>;
  }>([
    { name: "bound", before: [], after: [bind(webpool3)] },
    { name: "unbound", before: [bind(webpool3)], after: [released("webpool-3")] },
  ])(
    "a lease $name between sessions keeps the agent's conversation where it works: the next session resumes it and names no lease",
    ({ before, after }) => {
      const scene = play([
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
      ]);
      const payload = scene.effects.find((effect) => effect.kind === "session.open")?.payload;
      expect(payload).toMatchObject({ resume: "native-1", generation: 1 });
      expect(payload).not.toHaveProperty("fresh");
      expect(payload).not.toHaveProperty("lease");
    },
  );
});
