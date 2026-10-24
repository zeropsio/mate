import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ConversationId,
  effectId,
  runId,
  type EffectOutcome,
  type KnownEngineEvent,
  type Principal,
  type RotateSessionReason,
  type TurnHandle,
} from "@t3tools/contracts";

import type { Command, Decision, EffectDraft } from "./command.ts";
import { decide } from "./decide.ts";
import { fold, stampEvents } from "./evolve.ts";
import { initialState, type ConversationState } from "./state.ts";

const conversation = ConversationId.make("crew-main-ana-1");
const crew: Principal = { kind: "crew", startedBy: "ana" };
const T0 = 1_000_000_000;
const r = (n: number) => runId(conversation, n);
const T = (n: number) => r(n) as string as TurnHandle;
const PACKET = "You are Ana. Your task #3: make the login form remember the email.";

interface Scene {
  readonly state: ConversationState;
  readonly decision: Decision;
  readonly events: ReadonlyArray<KnownEngineEvent>;
  readonly effects: ReadonlyArray<EffectDraft>;
  readonly log: ReadonlyArray<KnownEngineEvent>;
}

/** A command, or one sent on behalf of someone other than the scene's principal. */
type Step = Command | { readonly as: Principal; readonly command: Command };
const by = (as: Principal, commands: ReadonlyArray<Command>): ReadonlyArray<Step> =>
  commands.map((command) => ({ as, command }));

/** Plays commands through decide and evolve; the scene is the last one, the log every one's. */
const play = (steps: ReadonlyArray<Step>, principal: Principal = crew): Scene => {
  let state = initialState(conversation);
  const log: Array<KnownEngineEvent> = [];
  let scene: Omit<Scene, "log"> | undefined;
  steps.forEach((step, index) => {
    const envelope = {
      commandId: CommandId.make(`c${index}`),
      conversationId: conversation,
      principal: "as" in step ? step.as : principal,
      command: "as" in step ? step.command : step,
    };
    const decision = decide(state, envelope, T0);
    const events =
      decision._tag === "Accept"
        ? stampEvents(state.headSeq, envelope, decision.step.events, T0)
        : [];
    log.push(...events);
    state = fold(state, events);
    scene = {
      state,
      decision,
      events,
      effects: decision._tag === "Accept" ? decision.step.effects : [],
    };
  });
  return { ...scene!, log };
};

const settled = (cause: string, kind: string, outcome: EffectOutcome, n = 1): Command => ({
  _tag: "EffectSettled",
  effectId: effectId(cause, kind, n),
  outcome,
});
const opened = (run: number, session: string, n = 1): Command =>
  settled(
    r(run),
    "session.open",
    {
      kind: "ok",
      value: {
        sessionId: session,
        driver: "claudeAgent",
        model: null,
        nativeRef: `native-${session}`,
        capabilities: { steer: false },
      },
    },
    n,
  );
const send = (text: string): Command => ({ _tag: "Send", text });
const prepared = (run: number): Command => settled(r(run), "run.prepare", { kind: "ok" });
const sent = (run: number): Command => settled(r(run), "provider.send", { kind: "ok" });
const closed = (session: string): Command => settled(session, "session.close", { kind: "ok" });
const ended = (run: number, session = "s1"): Command => ({
  _tag: "ProviderSignals",
  sessionId: session as never,
  signals: [{ kind: "turn-ended", turn: T(run), outcome: { kind: "completed" }, source: "agent" }],
});
const rotate = (reason: RotateSessionReason, fresh: boolean, seed: string | null): Command => ({
  _tag: "RotateSession",
  reason,
  fresh,
  seed,
});

/** A crewmate's first turn, over: its session s1 still open. */
const firstTurn: ReadonlyArray<Command> = [
  send("task card"),
  prepared(1),
  opened(1, "s1"),
  sent(1),
  ended(1),
];

describe("decide: a session rotates between turns", () => {
  it("a rotation between turns opens a fresh session seeded with the packet, recorded as context", () => {
    const rotated = play([...firstTurn, rotate("context", true, PACKET)]);
    expect(rotated.effects).toEqual([]);
    expect(
      rotated.events.flatMap((event) => (event._tag === "ItemOpened" ? [event.body] : [])),
    ).toEqual([
      { kind: "marker", marker: { kind: "session-rotated", reason: "context" } },
      { kind: "context", notes: [PACKET] },
    ]);
    // The next run closes the session the rotation replaces, then opens the fresh one.
    const closing = play([
      ...firstTurn,
      rotate("context", true, PACKET),
      send("continue"),
      prepared(2),
    ]);
    expect(closing.effects).toMatchObject([
      { kind: "session.close", payload: { sessionId: "s1", reason: "closed" } },
    ]);
    const next = play([
      ...firstTurn,
      rotate("context", true, PACKET),
      send("continue"),
      prepared(2),
      closed("s1"),
    ]);
    expect(next.effects).toMatchObject([
      {
        kind: "session.open",
        payload: { resume: null, fresh: true, seed: PACKET, generation: 2, rotateFrom: "s1" },
      },
    ]);
    const reopened = play([
      ...firstTurn,
      rotate("context", true, PACKET),
      send("continue"),
      prepared(2),
      closed("s1"),
      opened(2, "s2"),
    ]);
    expect(reopened.state.session?.id).toBe("s2");
    expect(
      reopened.log.find((event) => event._tag === "SessionOpened" && event.sessionId === "s2"),
    ).toMatchObject({
      rotatedFrom: "s1",
    });
    expect(reopened.state.rotation).toBeNull();
  });

  it("each task starts on a fresh agent session", () => {
    // An automated Mate's one conversation: the task before ran on s1; the next task's brief
    // follows a fresh rotation, so its run opens a session that resumes nothing.
    const task: Principal = { kind: "task", taskId: "task-2" };
    const next = play(
      [
        ...firstTurn,
        rotate("task", true, null),
        send("next task's card"),
        prepared(2),
        closed("s1"),
      ],
      task,
    );
    expect(next.effects).toMatchObject([
      {
        kind: "session.open",
        payload: { resume: null, fresh: true, seed: null, rotateFrom: "s1" },
      },
    ]);
  });

  describe("a task's run never goes on in another task's agent session", () => {
    const one: Principal = { kind: "task", taskId: "task-1" };
    const two: Principal = { kind: "task", taskId: "task-2" };
    // Task 1 worked on s1; task 2 then took a fresh session, s2, and ended its turn there.
    const twoTasks: ReadonlyArray<Step> = [
      ...by(one, firstTurn),
      ...by(two, [
        rotate("task", true, null),
        send("task 2's card"),
        prepared(2),
        closed("s1"),
        opened(2, "s2"),
        sent(2),
        ended(2, "s2"),
      ]),
    ];

    it("a follow-up on an earlier task starts afresh, resuming nothing of the later one", () => {
      const closing = play([...twoTasks, ...by(one, [send("a review of task 1"), prepared(3)])]);
      expect(closing.effects).toMatchObject([
        { kind: "session.close", payload: { sessionId: "s2", reason: "closed" } },
      ]);
      expect(
        closing.events.flatMap((event) => (event._tag === "ItemOpened" ? [event.body] : [])),
      ).toContainEqual({ kind: "marker", marker: { kind: "session-rotated", reason: "task" } });
      const next = play([
        ...twoTasks,
        ...by(one, [send("a review of task 1"), prepared(3), closed("s2")]),
      ]);
      expect(next.effects).toMatchObject([
        {
          kind: "session.open",
          payload: { resume: null, fresh: true, seed: null, rotateFrom: "s2" },
        },
      ]);
      // Sent there, the session holds task 1's work again: task 1's next run goes on in it.
      const after = play([
        ...twoTasks,
        ...by(one, [
          send("a review of task 1"),
          prepared(3),
          closed("s2"),
          opened(3, "s3"),
          sent(3),
          ended(3, "s3"),
          send("another review of task 1"),
          prepared(4),
        ]),
      ]);
      expect(after.effects).toMatchObject([
        { kind: "provider.send", payload: { sessionId: "s3" } },
      ]);
    });

    it("a follow-up on the task its session holds goes on in it", () => {
      const next = play([...twoTasks, ...by(two, [send("a review of task 2"), prepared(3)])]);
      expect(next.effects).toMatchObject([{ kind: "provider.send", payload: { sessionId: "s2" } }]);
    });

    it("a person's message goes on in the session whichever task it holds", () => {
      const next = play([
        ...twoTasks,
        ...by({ kind: "person", subject: "ana" }, [send("what next?"), prepared(3)]),
      ]);
      expect(next.effects).toMatchObject([{ kind: "provider.send", payload: { sessionId: "s2" } }]);
    });
  });

  it("a rotation for the budget resumes the same thread in its new session", () => {
    const next = play([
      ...firstTurn,
      rotate("budget", false, null),
      send("go on"),
      prepared(2),
      closed("s1"),
    ]);
    expect(next.effects).toMatchObject([
      { kind: "session.open", payload: { resume: "native-s1", fresh: false, generation: 1 } },
    ]);
    expect(
      next.log.some((event) => event._tag === "ItemOpened" && event.body.kind === "context"),
    ).toBe(false);
  });

  it("a rotation asked during a turn waits for it: the session closes before the next run, never under it", () => {
    const during = play([
      send("task card"),
      prepared(1),
      opened(1, "s1"),
      sent(1),
      rotate("job", true, PACKET),
    ]);
    expect(during.effects).toEqual([]);
    expect(during.state.runs[r(1)]?.state).toBe("running");
    const after = play([
      send("task card"),
      prepared(1),
      opened(1, "s1"),
      sent(1),
      rotate("job", true, PACKET),
      ended(1),
      send("next"),
      prepared(2),
    ]);
    expect(after.effects).toMatchObject([{ kind: "session.close", payload: { reason: "closed" } }]);
  });

  it("a Chief rotation does not wait for the agent's background work: the next run closes its session and the work ends as lost", () => {
    const working: Command = {
      _tag: "ProviderSignals",
      sessionId: "s1" as never,
      signals: [
        {
          kind: "work-upserted",
          work: "w1",
          origin: T(1),
          workKind: "helper",
          status: "running",
          title: "Explore",
        },
      ],
    };
    const rotated = [
      send("task card"),
      prepared(1),
      opened(1, "s1"),
      sent(1),
      working,
      ended(1),
      rotate("chief", false, null),
      send("next"),
      prepared(2),
    ];
    expect(play(rotated).effects).toMatchObject([
      { kind: "session.close", payload: { reason: "closed" } },
    ]);
    expect(play([...rotated, closed("s1")]).log).toContainEqual(
      expect.objectContaining({
        _tag: "ItemClosed",
        body: expect.objectContaining({ kind: "work", status: "lost" }),
      }),
    );
  });

  it("a rotation with no session open takes effect at the next open", () => {
    const next = play([rotate("cleared", true, PACKET), send("hello"), prepared(1)]);
    expect(next.effects).toMatchObject([
      { kind: "session.open", payload: { fresh: true, seed: PACKET, generation: 2 } },
    ]);
  });

  it("an archived conversation takes no rotation", () => {
    const archived = play([{ _tag: "Archive" }, rotate("cleared", true, PACKET)]);
    expect(archived.decision).toMatchObject({ _tag: "Reject", rejection: { reason: "archived" } });
  });
});
