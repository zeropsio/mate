/**
 * `evolveCrew(state, event)`: the crew owner's one fold, shared by the actor after a commit and by
 * rehydration. Pure; an event this build does not know only moves the head.
 *
 * @module crew/engine/evolve
 */
import { isKnownCrewEvent, type CrewEvent } from "./events.ts";
import type { CrewState, MemberRecord, TaskRecord } from "./state.ts";

const without = <V>(record: Readonly<Record<string, V>>, key: string): Record<string, V> => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

const withMember = (
  state: CrewState,
  handle: string,
  update: (member: MemberRecord) => MemberRecord,
): CrewState => {
  const member = state.members[handle];
  return member === undefined
    ? state
    : { ...state, members: { ...state.members, [handle]: update(member) } };
};

const withTask = (
  state: CrewState,
  taskId: string,
  update: (task: TaskRecord) => TaskRecord,
): CrewState => {
  const task = state.tasks[taskId];
  return task === undefined
    ? state
    : { ...state, tasks: { ...state.tasks, [taskId]: update(task) } };
};

export const evolveCrew = (
  state: CrewState,
  event: { readonly _tag: string; readonly seq: number },
): CrewState => {
  const moved: CrewState = { ...state, headSeq: event.seq };
  if (!isKnownCrewEvent(event)) return moved;
  return fold(moved, event);
};

const fold = (state: CrewState, event: CrewEvent): CrewState => {
  switch (event._tag) {
    case "WakeArmed":
      return {
        ...state,
        wakes: {
          ...state.wakes,
          [event.wakeId]: { kind: event.kind, dueAt: event.dueAt, armedSeq: event.seq },
        },
      };
    case "WakeFired":
    case "WakeCancelled":
      return { ...state, wakes: without(state.wakes, event.wakeId) };
    case "EffectOutcomeRecorded":
      return { ...state, effects: without(state.effects, event.effectId) };
    case "EffectAsked":
      return {
        ...state,
        effectSeq: state.effectSeq + 1,
        effects: { ...state.effects, [event.effectId]: event.pending },
      };
    case "CrewApplied": {
      const members: Record<string, MemberRecord> = {};
      const ordinals: Record<string, number> = { ...state.ordinals };
      for (const member of event.members) {
        members[member.handle] = member;
        const n = Number(member.conversationId.split("-").at(-1));
        if (Number.isInteger(n)) ordinals[member.handle] = n;
      }
      return {
        ...state,
        applied: { definition: event.definition, briefVersion: event.briefVersion },
        order: event.members.map((member) => member.handle),
        members,
        ordinals,
      };
    }
    case "CrewmateUpdated":
      return withMember(state, event.handle, (member) => ({ ...member, ...event.set }));
    case "SessionRotated":
      return withMember(state, event.handle, (member) => ({
        ...member,
        session: {
          count: member.session.count + 1,
          lastReason: event.reason,
          // A resumed session (a run's new cap) keeps the prompt it started with.
          running: event.fresh ? null : member.session.running,
          principal: event.fresh ? null : member.session.principal,
          login: member.login,
          compactions: 0,
          startedAt: event.at,
        },
        rotateWhenFree: null,
        apply: event.rotation === "prompt-changed" ? null : member.apply,
      }));
    case "TaskCreated":
      return {
        ...state,
        tasks: { ...state.tasks, [event.task.id]: event.task },
        nextTaskNumber: Math.max(state.nextTaskNumber, event.task.number + 1),
      };
    case "TaskStepped":
      return withTask(state, event.taskId, (task) => ({
        ...task,
        ...event.set,
        state: event.to,
        counters: event.counters,
        updatedAt: event.at,
      }));
    case "TaskUpdated":
      return withTask(state, event.taskId, (task) => ({ ...task, ...event.set }));
    case "RunStarted":
      return { ...state, run: event.run };
    case "RunUpdated":
      return state.run === null ? state : { ...state, run: { ...state.run, ...event.set } };
    case "LeadUpdated":
      return { ...state, lead: { ...state.lead, ...event.set } };
    case "ClaimUpdated":
      return {
        ...state,
        claims:
          event.claim === null
            ? without(state.claims, event.host)
            : { ...state.claims, [event.host]: event.claim },
      };
    case "HostUpdated": {
      const host = state.hosts[event.host] ?? {
        frozenSince: null,
        crewPorts: [],
        served: { by: "unknown" as const },
        integration: null,
        polls: 0,
      };
      return { ...state, hosts: { ...state.hosts, [event.host]: { ...host, ...event.set } } };
    }
    case "UsageRead":
      return { ...state, usage: { ...state.usage, [event.login]: event.percent } };
    case "DeliveryRecorded": {
      const recorded = {
        ...state,
        deliveries: { ...state.deliveries, [event.effectId]: event.delivery },
      };
      // A turn sent to a task counts toward its attempt's turns.
      const task =
        event.delivery.taskId === null || event.delivery.text === null
          ? undefined
          : state.tasks[event.delivery.taskId];
      if (task === undefined) return recorded;
      const { attempt } = task.counters;
      const count = task.turns?.attempt === attempt ? task.turns.count + 1 : 1;
      return {
        ...recorded,
        tasks: { ...state.tasks, [task.id]: { ...task, turns: { attempt, count } } },
      };
    }
    case "DeliveryLinked": {
      const delivery = state.deliveries[event.effectId];
      return delivery === undefined
        ? state
        : {
            ...state,
            deliveries: {
              ...state.deliveries,
              [event.effectId]: { ...delivery, runId: event.runId },
            },
          };
    }
    case "DeliveryClosed":
      return { ...state, deliveries: without(state.deliveries, event.effectId) };
    case "MateRunChanged":
      return { ...state, mate: { conversationId: event.conversationId, runId: event.runId } };
    case "ObservedUpTo":
      return { ...state, cursors: { ...state.cursors, [event.conversationId]: event.seq } };
    case "LandingHeld":
      return {
        ...state,
        heldLandings:
          event.words === null
            ? without(state.heldLandings, event.taskId)
            : { ...state.heldLandings, [event.taskId]: event.words },
      };
    case "AttentionRaised":
      return {
        ...state,
        attention: [...state.attention.filter((row) => row.id !== event.row.id), event.row],
      };
    case "AttentionCleared":
      return { ...state, attention: state.attention.filter((row) => row.id !== event.id) };
    case "ErrorNoted":
      return { ...state, lastError: event.text };
    case "Due":
    case "MemoryChanged":
      return state;
  }
};
