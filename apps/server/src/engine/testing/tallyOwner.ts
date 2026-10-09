/**
 * A second owner kind for the engine's tests: the smallest crew. It keeps a tally, queues effects
 * on lanes it names, arms wakes, and records what the worker, the scheduler and boot tell it — so
 * a test proves the machinery (one writer, the receipt, the outbox, wakes, recovery) for an owner
 * that is not a conversation, without crew's own rules.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  CREW_OWNER_ID,
  CommandId,
  ConversationId,
  EffectOutcomeRecorded,
  EffectRequested,
  WakeArmed,
  WakeFired,
  effectId as deriveEffectId,
  wakeId as deriveWakeId,
  type Principal,
} from "@t3tools/contracts";

import type { EffectClass } from "../domain/command.ts";
import type { EngineInput, Domain, DraftOf, OwnerDecision } from "../owners.ts";

const header = {
  v: Schema.Int,
  conversationId: ConversationId,
  seq: Schema.Int,
  at: Schema.Number,
  commandId: CommandId,
};

const Tallied = Schema.TaggedStruct("Tallied", { ...header, by: Schema.Int, total: Schema.Int });
const TallyRecovered = Schema.TaggedStruct("TallyRecovered", { ...header, bootId: Schema.String });

export const TallyEvent = Schema.Union([
  Tallied,
  TallyRecovered,
  EffectRequested,
  EffectOutcomeRecorded,
  WakeArmed,
  WakeFired,
]);
export type TallyEvent = typeof TallyEvent.Type;

export type TallyCommand =
  | { readonly _tag: "Tally"; readonly by: number }
  /** Queues one effect of `kind` on `lane`; its id derives from `key`. */
  | {
      readonly _tag: "Ask";
      readonly kind: string;
      readonly lane: string;
      readonly key: string;
      readonly class?: EffectClass;
    }
  | { readonly _tag: "Arm"; readonly key: string; readonly dueAt: number }
  | EngineInput;

export interface TallyState {
  readonly owner: ConversationId;
  readonly headSeq: number;
  readonly total: number;
  readonly effects: Readonly<Record<string, string>>;
  readonly wakes: Readonly<Record<string, number>>;
  readonly settled: ReadonlyArray<string>;
  readonly recoveries: number;
}

export const tallyOwner = CREW_OWNER_ID;
const CREW: Principal = { kind: "crew", startedBy: "ana" };

export const tallyEffectId = (key: string, kind: string) =>
  deriveEffectId(`${tallyOwner}/${key}`, kind, 1);
export const tallyWakeId = (key: string) => deriveWakeId(tallyOwner, "tally", key);

const reject = (reason: "unknown-effect" | "wake-not-armed"): OwnerDecision<never> => ({
  _tag: "Reject",
  rejection: { reason },
});

const decideTally = (
  state: TallyState,
  envelope: { readonly command: TallyCommand },
): OwnerDecision<DraftOf<TallyEvent>> => {
  const accept = (events: ReadonlyArray<DraftOf<TallyEvent>>) => ({
    _tag: "Accept" as const,
    step: {
      events,
      effects: [],
      details: [],
      result: { _tag: "Accepted" as const, seq: state.headSeq + events.length },
    },
  });
  const tally = (by: number): DraftOf<TallyEvent> => ({
    _tag: "Tallied",
    by,
    total: state.total + by,
  });
  const command = envelope.command;
  switch (command._tag) {
    case "Tally":
      return accept([tally(command.by)]);
    case "Ask": {
      const id = tallyEffectId(command.key, command.kind);
      return {
        _tag: "Accept",
        step: {
          events: [{ _tag: "EffectRequested", effectId: id, kind: command.kind, runId: null }],
          effects: [
            {
              effectId: id,
              kind: command.kind,
              lane: command.lane,
              class: command.class ?? "replay-safe",
              runId: null,
              payload: { key: command.key },
            },
          ],
          details: [],
          result: { _tag: "Accepted", seq: state.headSeq + 1 },
        },
      };
    }
    case "Arm":
      return accept([
        {
          _tag: "WakeArmed",
          wakeId: tallyWakeId(command.key),
          kind: "tally",
          dueAt: command.dueAt,
          cron: null,
          principal: CREW,
          joins: null,
          text: null,
        },
      ]);
    case "EffectSettled": {
      const kind = state.effects[command.effectId];
      if (kind === undefined) return reject("unknown-effect");
      return accept([
        {
          _tag: "EffectOutcomeRecorded",
          effectId: command.effectId,
          kind,
          outcome: command.outcome,
        },
        tally(1),
      ]);
    }
    case "WakeFired": {
      const armed = state.wakes[command.wakeId];
      if (armed === undefined) return reject("wake-not-armed");
      if (command.armedSeq !== undefined && command.armedSeq !== armed) {
        return reject("wake-not-armed");
      }
      return accept([{ _tag: "WakeFired", wakeId: command.wakeId, dueAt: 0 }, tally(1)]);
    }
    case "Recovered":
      return accept([{ _tag: "TallyRecovered", bootId: command.bootId }]);
  }
};

const without = <V>(record: Readonly<Record<string, V>>, key: string) => {
  const { [key]: _gone, ...rest } = record;
  return rest;
};

const evolveTally = (previous: TallyState, event: TallyEvent): TallyState => {
  const state = { ...previous, headSeq: event.seq };
  switch (event._tag) {
    case "Tallied":
      return { ...state, total: event.total };
    case "TallyRecovered":
      return { ...state, recoveries: state.recoveries + 1 };
    case "EffectRequested":
      return { ...state, effects: { ...state.effects, [event.effectId]: event.kind } };
    case "EffectOutcomeRecorded":
      return {
        ...state,
        effects: without(state.effects, event.effectId),
        settled: [...state.settled, event.effectId],
      };
    case "WakeArmed":
      return { ...state, wakes: { ...state.wakes, [event.wakeId]: event.seq } };
    case "WakeFired":
      return { ...state, wakes: without(state.wakes, event.wakeId) };
  }
};

const decodeEvent = Schema.decodeUnknownEffect(TallyEvent);
const encodeEvent = Schema.encodeUnknownEffect(TallyEvent);

export const tallyDomain: Domain<TallyState, TallyCommand, TallyEvent> = {
  kind: "crew",
  owns: (owner) => owner.startsWith("crew/"),
  stateVersion: 1,
  initial: (owner) => ({
    owner,
    headSeq: 0,
    total: 0,
    effects: {},
    wakes: {},
    settled: [],
    recoveries: 0,
  }),
  decide: (state, envelope) => decideTally(state, envelope),
  evolve: evolveTally,
  decode: (row) => decodeEvent(row),
  encode: (event) => encodeEvent(event),
  project: () => Effect.void,
  rowAgent: () => null,
  runOf: () => null,
};
