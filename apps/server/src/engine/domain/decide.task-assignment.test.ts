import { prepared, opened, sent, signal, turn } from "../testing/fixtures.ts";
import { describe, expect, it } from "@effect/vitest";
import { CommandId, ConversationId, type Principal, TurnHandle } from "@t3tools/contracts";

import type { Command } from "./command.ts";
import { decide } from "./decide.ts";
import { fold, stampEvents } from "./evolve.ts";
import { initialState, type ConversationState } from "./state.ts";

const conversation = ConversationId.make("mate");
const taskId = "task-from-hq";
const principal = (assignment?: string): Principal => ({
  kind: "task",
  taskId,
  ...(assignment === undefined ? {} : { assignment }),
});
const apply = (state: ConversationState, command: Command, assignment?: string) => {
  const envelope = {
    conversationId: conversation,
    commandId: CommandId.make(`test:${state.headSeq}:${command._tag}`),
    principal: principal(assignment),
    command,
  };
  const decision = decide(state, envelope, 1_000_000);
  const events =
    decision._tag === "Accept"
      ? stampEvents(state.headSeq, envelope, decision.step.events, 1_000_000)
      : [];
  return { decision, events, state: fold(state, events) };
};
const offer = (assignment: string): Command => ({
  _tag: "Send",
  text: "Actual task brief",
  taskId,
  taskAssignment: assignment,
});

describe("a durable task assignment", () => {
  it("an older offer or stop cannot change a successor assignment, and a retired grant cannot be reactivated", () => {
    const first = apply(initialState(conversation), offer("1"), "1");
    expect(first.events.some((event) => event._tag === "TaskAssignmentChanged")).toBe(true);
    const retired = apply(
      first.state,
      {
        _tag: "StopTaskAssignment",
        taskId,
        assignment: "1",
        requeued: true,
        reason: "Budget reached",
      },
      "1",
    );
    expect(retired.state.taskAssignments[taskId]?.state).toBe("requeued");
    expect(apply(retired.state, offer("1"), "1").decision._tag).toBe("Reject");
    const successor = apply(retired.state, offer("2"), "2");
    expect(successor.decision._tag).toBe("Accept");
    const before = successor.state.runs;
    const oldStop = apply(
      successor.state,
      { _tag: "StopTaskAssignment", taskId, assignment: "1", requeued: false, reason: "Old stop" },
      "1",
    );
    expect(oldStop.events.some((event) => event._tag === "TaskAssignmentChanged")).toBe(true);
    expect(oldStop.state.taskAssignments[taskId]?.assignment).toBe("2");
    expect(oldStop.state.taskAssignments[taskId]?.state).toBe("active");
    expect(oldStop.state.runs).toEqual(before);
    expect(apply(oldStop.state, offer("1"), "1").decision._tag).toBe("Reject");
  });

  it("adopting an actually kept legacy task binds the grant without starting another run", () => {
    const legacy = apply(initialState(conversation), {
      _tag: "Send",
      text: "Already accepted tester work",
      taskId,
    });
    const run = Object.values(legacy.state.runs)[0]!;
    const adopted = apply(
      legacy.state,
      { _tag: "AdoptTaskAssignment", taskId, assignment: "9007199254740993", runId: run.id },
      "9007199254740993",
    );
    expect(adopted.decision._tag).toBe("Accept");
    expect(adopted.events.map((event) => event._tag)).toEqual(["TaskAssignmentChanged"]);
    expect(adopted.state.runs).toEqual({
      ...legacy.state.runs,
      [run.id]: { ...run, taskAssignment: "9007199254740993" },
    });
    expect(adopted.state.taskAssignments[taskId]).toEqual({
      assignment: "9007199254740993",
      state: "active",
      runId: run.id,
    });
    const wrong = apply(
      legacy.state,
      { _tag: "AdoptTaskAssignment", taskId: "another-task", assignment: "1", runId: run.id },
      "1",
    );
    expect(wrong.decision._tag).toBe("Reject");
  });

  it("a stop arriving before its offer remains a durable retirement without starting a run", () => {
    const stopped = apply(
      initialState(conversation),
      {
        _tag: "StopTaskAssignment",
        taskId,
        assignment: "9223372036854775807",
        requeued: false,
        reason: "Already stopped",
      },
      "9223372036854775807",
    );
    expect(stopped.events.map((event) => event._tag)).toEqual(["TaskAssignmentChanged"]);
    expect(stopped.state.taskAssignments[taskId]?.state).toBe("stopped");
    expect(Object.keys(stopped.state.runs)).toHaveLength(0);
    const lateRequeue = apply(
      stopped.state,
      {
        _tag: "StopTaskAssignment",
        taskId,
        assignment: "9223372036854775807",
        requeued: true,
        reason: "Late budget instruction",
      },
      "9223372036854775807",
    );
    expect(lateRequeue.state.taskAssignments[taskId]?.state).toBe("stopped");
    expect(lateRequeue.state.taskAssignments[taskId]?.reason).toBe("Already stopped");
    expect(
      apply(stopped.state, offer("9223372036854775807"), "9223372036854775807").decision._tag,
    ).toBe("Reject");
  });
  it("a late control can stop its own unadopted older run without lowering a higher retired grant", () => {
    const first = apply(initialState(conversation), offer("1"), "1");
    const run = Object.values(first.state.runs)[0]!;
    const future = apply(
      first.state,
      {
        _tag: "StopTaskAssignment",
        taskId,
        assignment: "2",
        requeued: true,
        reason: "Newer unreceived offer retired",
      },
      "2",
    );
    const old = apply(
      future.state,
      {
        _tag: "StopTaskAssignment",
        taskId,
        assignment: "1",
        requeued: true,
        reason: "Withdraw old run",
      },
      "1",
    );
    expect(old.state.taskAssignments[taskId]?.assignment).toBe("2");
    expect(old.state.taskAssignments[taskId]?.state).toBe("requeued");
    expect(old.state.runs[run.id]?.state).toBe("ended");
  });

  it("a joined continuation carries its run's actual adopted grant", () => {
    const first = apply(initialState(conversation), offer("1"), "1");
    const run = Object.values(first.state.runs)[0]!;
    const armed = apply(
      first.state,
      {
        _tag: "ArmWake",
        kind: "restart-continuation",
        key: "kept-run",
        dueAt: 1,
        joins: run.id,
        text: "Continue the kept task",
      },
      "1",
    );
    const wake = Object.values(armed.state.wakes).find(
      (wake) => wake.kind === "restart-continuation",
    )!;
    const adopted = apply(
      armed.state,
      { _tag: "AdoptTaskAssignment", taskId, assignment: "2", runId: run.id },
      "2",
    );
    const fired = apply(adopted.state, { _tag: "WakeFired", wakeId: wake.id }, "2");
    const next = Object.values(fired.state.runs).sort((a, b) => b.ordinal - a.ordinal)[0]!;
    expect(next.id).not.toBe(run.id);
    expect(next.principal).toEqual({ kind: "task", taskId, assignment: "2" });
  });
  it("a retained wake cannot start work after its task grant was retired", () => {
    const first = apply(initialState(conversation), offer("1"), "1");
    const run = Object.values(first.state.runs)[0]!;
    const armed = apply(
      first.state,
      {
        _tag: "ArmWake",
        kind: "restart-continuation",
        key: "kept-run",
        dueAt: 1,
        joins: run.id,
        text: "Continue the kept task",
      },
      "1",
    );
    const wake = Object.values(armed.state.wakes).find(
      (wake) => wake.kind === "restart-continuation",
    )!;
    const retired = apply(
      armed.state,
      { _tag: "StopTaskAssignment", taskId, assignment: "1", requeued: true, reason: "Withdrawn" },
      "1",
    );
    expect(retired.state.wakes[wake.id]).toBeDefined();
    const fired = apply(retired.state, { _tag: "WakeFired", wakeId: wake.id }, "1");
    expect(Object.values(fired.state.runs).every((run) => run.state === "ended")).toBe(true);
    expect(fired.decision._tag === "Accept" ? fired.decision.step.effects : []).toEqual([]);
    expect(fired.state.wakes[wake.id]).toBeUndefined();
  });
  it("a self-started provider turn after retirement is recorded and interrupted without a new grant", () => {
    let current = apply(initialState(conversation), offer("1"), "1");
    for (const command of [prepared(1), opened(1), sent(1)])
      current = apply(current.state, command, "1");
    current = apply(
      current.state,
      { _tag: "StopTaskAssignment", taskId, assignment: "1", requeued: false, reason: "Retired" },
      "1",
    );
    current = apply(
      current.state,
      signal({
        kind: "turn-ended",
        turn: turn(1),
        outcome: { kind: "completed" },
        source: "agent",
      }),
      "1",
    );
    const late = apply(
      current.state,
      signal({
        kind: "turn-started",
        turn: TurnHandle.make("native-after-retirement"),
        providerTurnId: "native-late",
        origin: "self",
      }),
      "1",
    );
    const run = Object.values(late.state.runs).sort((a, b) => b.ordinal - a.ordinal)[0]!;
    expect(run.ordinal).toBe(2);
    expect(run.stopAsked).not.toBeNull();
    // It really started outside HQ. The engine requests its stop, never lies
    // that an unconfirmed provider turn is already ended.
    expect(run.state).toBe("running");
    expect(
      late.decision._tag === "Accept"
        ? late.decision.step.effects.some((effect) => effect.kind === "provider.interrupt")
        : false,
    ).toBe(true);
  });
});
