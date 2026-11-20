/**
 * The working step every rule writes into (`StepBuilder`, `Rejected`), the engine's own principal, the effect kinds,
 * and the four reads of the state every family shares.
 *
 * @module engine/domain/decide.step
 */
import {
  effectId as deriveEffectId,
  type CommandResult,
  type EffectId,
  type Principal,
  type RejectionReason,
  type RunId,
} from "@t3tools/contracts";

import type {
  EffectClass,
  EffectDraft,
  ConversationLane,
  Envelope,
  EventDraft,
  ItemDataDraft,
  ItemDetailDraft,
} from "./command.ts";
import { evolve, stampEvents } from "./evolve.ts";
import type { ConversationState, RunRecord } from "./state.ts";

/** The effects `decide` asks for, with the lane they queue in and what a restart does to them. */
export const EFFECT_KINDS = {
  "session.open": { lane: "turn", class: "process-bound" },
  "provider.send": { lane: "turn", class: "process-bound" },
  "provider.interrupt": { lane: "control", class: "process-bound" },
  "provider.respond": { lane: "control", class: "process-bound" },
  "session.close": { lane: "close", class: "process-bound" },
  "run.prepare": { lane: "side", class: "replay-safe" },
  "provider.steer": { lane: "turn", class: "process-bound" },
  // Its own lane, run by the Mate-wide fibers: a parked container waking holds no session's work.
  "lease.release": { lane: "workspace", class: "replay-safe" },
} as const satisfies Record<string, { lane: ConversationLane; class: EffectClass }>;
export type EngineEffectKind = keyof typeof EFFECT_KINDS;

export const ENGINE: Principal = { kind: "engine" };
export const ENGINE_ACTOR = { kind: "engine" } as const;

export class Rejected {
  readonly reason: RejectionReason;
  readonly detail: string | undefined;
  constructor(reason: RejectionReason, detail?: string) {
    this.reason = reason;
    this.detail = detail;
  }
}

/** The working step: each emitted event is folded at once, so later rules read the new state. */
export class StepBuilder {
  state: ConversationState;
  readonly events: Array<EventDraft> = [];
  readonly effects: Array<EffectDraft> = [];
  readonly details: Array<ItemDetailDraft> = [];
  readonly data: Array<ItemDataDraft> = [];
  /** Background work this step closed as lost, for the note that tells the Mate (`noteLostWork`). */
  readonly lost: Array<LostWork> = [];
  result: Omit<Extract<CommandResult, { _tag: "Accepted" }>, "_tag" | "seq"> = {};

  readonly envelope: Envelope;
  readonly now: number;

  constructor(state: ConversationState, envelope: Envelope, now: number) {
    this.state = state;
    this.envelope = envelope;
    this.now = now;
  }

  emit(draft: EventDraft): void {
    const [event] = stampEvents(this.state.headSeq, this.envelope, [draft], this.now);
    this.events.push(draft);
    this.state = evolve(this.state, event!);
  }

  effect(
    kind: EngineEffectKind,
    cause: string,
    n: number,
    runId: RunId | null,
    payload: unknown,
  ): EffectId {
    const id = deriveEffectId(cause, kind, n);
    this.effects.push({ effectId: id, kind, ...EFFECT_KINDS[kind], runId, payload });
    this.emit({ _tag: "EffectRequested", effectId: id, kind, runId });
    return id;
  }

  run(id: RunId): RunRecord {
    const run = this.state.runs[id];
    if (run === undefined) throw new Error(`run ${id} is not in the state`);
    return run;
  }
}

export const paused = (b: StepBuilder) =>
  b.state.pausedUntil === "unknown" ||
  (b.state.pausedUntil !== null && b.now < b.state.pausedUntil);

/** Every run is admitted but one the agent started itself. */
export const needsPrepare = (run: RunRecord): boolean =>
  !(run.trigger.kind === "wake" && run.trigger.cause === "self");

/** Work closed as lost, and how its session went, in the note's words (none: tell nothing). */
export interface LostWork {
  readonly title: string | null;
  readonly runId: RunId | null;
  readonly how: string | undefined;
}

export const isLive = (run: RunRecord) =>
  run.state === "sending" || run.state === "running" || run.state === "waiting";

/**
 * A run its crew started is its crew's to carry on (CREW-DESIGN §2.2): the engine arms no
 * continuation and no usage resume for it. So is every run in a crewmate's chat, whoever it ran
 * for: a person's message reaches it through its crew, which holds it while the crew is paused or
 * its copy frozen.
 */
export const crewCarriesOn = (
  state: ConversationState,
  run: { readonly principal: Principal },
): boolean => run.principal.kind === "crew" || state.agent?.profile.kind === "crewmate";
