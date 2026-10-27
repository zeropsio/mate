/**
 * The pure model run: play generated inputs through `decide` and `evolve`, check every step,
 * and shrink a failing run to the fewest inputs that still break the same invariant.
 */
import { ConversationId, type KnownEngineEvent } from "@t3tools/contracts";

import { decide } from "../domain/decide.ts";
import { fold, stampEvents } from "../domain/evolve.ts";
import { initialState } from "../domain/state.ts";
import { Gen, type GenOptions, type Played } from "./gen.ts";
import { Model, Violation, checkStep, checkTimerStep } from "./invariants.ts";
import { makeRng } from "./rng.ts";

export const T0 = 1_000_000_000;

export interface Failure {
  readonly seed: number;
  readonly step: number;
  readonly violation: Violation;
  readonly played: ReadonlyArray<Played>;
}

/** Plays a fixed list of inputs; the first violation, or none. */
export const replay = (
  conversation: ConversationId,
  played: ReadonlyArray<Played>,
): { readonly violation: Violation; readonly step: number } | undefined => {
  let state = initialState(conversation);
  const model = new Model(conversation);
  for (let i = 0; i < played.length; i++) {
    const { envelope, now } = played[i]!;
    try {
      let decision;
      let again;
      try {
        decision = decide(state, envelope, now);
        again = decide(state, envelope, now);
      } catch (error) {
        throw new Violation(
          "decide answers every input",
          `${envelope.command._tag} threw ${String(error)}`,
        );
      }
      const events: ReadonlyArray<KnownEngineEvent> =
        decision._tag === "Accept"
          ? stampEvents(state.headSeq, envelope, decision.step.events, now)
          : [];
      const after = fold(state, events);
      checkStep({ model, before: state, envelope, now, decision, again, events, after });
      checkTimerStep(envelope, events);
      state = after;
    } catch (error) {
      if (error instanceof Violation) return { violation: error, step: i };
      throw error;
    }
  }
  return undefined;
};

/** Generates and plays `steps` inputs from one seed. */
export const runSeed = (
  seed: number,
  steps: number,
  options: GenOptions = {},
): Failure | undefined => {
  const conversation = ConversationId.make("mate");
  const gen = new Gen(makeRng(seed), conversation, options);
  let state = initialState(conversation);
  let now = T0;
  const played: Array<Played> = [];
  for (let i = 0; i < steps; i++) {
    const next = gen.next(state, now);
    played.push(next);
    now = next.now;
    let decision;
    try {
      decision = decide(state, next.envelope, now);
    } catch {
      break; // replay reports it as a violation
    }
    if (decision._tag === "Accept") {
      state = fold(state, stampEvents(state.headSeq, next.envelope, decision.step.events, now));
    }
  }
  const failed = replay(conversation, played);
  if (failed === undefined) return undefined;
  return {
    seed,
    step: failed.step,
    violation: failed.violation,
    played: played.slice(0, failed.step + 1),
  };
};

/** Delta debugging: drop chunks, then single inputs, while the same invariant still breaks. */
export const shrink = (failure: Failure): Failure => {
  const conversation = failure.played[0]!.envelope.conversationId;
  const same = (played: ReadonlyArray<Played>) => {
    const result = replay(conversation, played);
    return result !== undefined && result.violation.invariant === failure.violation.invariant
      ? result
      : undefined;
  };
  let current = [...failure.played];
  let chunk = Math.max(1, Math.floor(current.length / 2));
  while (chunk >= 1) {
    let removed = false;
    for (let start = 0; start < current.length - 1;) {
      const candidate = [...current.slice(0, start), ...current.slice(start + chunk)];
      const result = candidate.length > 0 ? same(candidate) : undefined;
      if (result !== undefined) {
        current = candidate.slice(0, result.step + 1);
        removed = true;
      } else {
        start += chunk;
      }
    }
    if (!removed) chunk = Math.floor(chunk / 2);
  }
  const final = replay(conversation, current)!;
  return { ...failure, step: final.step, violation: final.violation, played: current };
};

/** How a failure prints: the seed to replay it and the shrunk script, one input per line. */
export const describeFailure = (failure: Failure): string => {
  const lines = failure.played.map(({ envelope, now }, i) => {
    const { _tag, ...rest } = envelope.command as { _tag: string } & Record<string, unknown>;
    return `  ${String(i).padStart(3)} +${now - T0}ms ${_tag} ${JSON.stringify(rest).slice(0, 160)}`;
  });
  return [
    `invariant broken: ${failure.violation.invariant}`,
    `  ${failure.violation.detail}`,
    `seed ${failure.seed} (replay: ENGINE_PROOF_SEED=${failure.seed}), shrunk to ${failure.played.length} inputs:`,
    ...lines,
  ].join("\n");
};
