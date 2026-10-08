/**
 * `crew.land` (replay-safe, lane `host/<host>`): a checked copy landed on your tree as one squash
 * commit (`CrewIntegration.land`, unchanged: its anchor, its fast-forward, git's refusals).
 *
 * A landing's own evidence is its `Crew-Assignment:` trailer in your tree's first-parent history:
 * one landing per task, which survives zcp's rebase where a sha does not. Run again after a crash,
 * the handler first reads it; a landing that went through is adopted — the copy moved to it as
 * the landing would have, its anchor dropped, the copy's last landing recorded — and answered as
 * already landed, so a task lands once wherever the restart cut it.
 *
 * @module zerops/crew/engine/effects/land
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { EffectOutcome } from "@t3tools/contracts";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import type { EffectRow } from "../../../../engine/outbox/EffectOutbox.ts";
import { CrewIntegration, type LandInput, type LandOutcome } from "../../CrewIntegration.ts";
import { CrewStore } from "../../CrewStore.ts";
import { CrewWorkspace } from "../../CrewWorkspace.ts";
import { CREW_EFFECT_KINDS, done, laneKey, payloadOf, settled } from "./shared.ts";

export interface LandPayload {
  readonly handle: string;
  readonly assignment: string;
  /** The task's title; its first line is the landing's subject. */
  readonly title: string;
  /** The copy's tip its check passed on: any other tip is refused `unchecked`. */
  readonly checkedTip?: string;
}

export type LandValue = LandOutcome;

const inputOf = (payload: LandPayload): LandInput => ({
  ...laneKey(payload.handle),
  assignment: payload.assignment,
  title: payload.title,
  checkedTip: payload.checkedTip,
});

export const makeLand = Effect.gen(function* () {
  const integration = yield* CrewIntegration;
  const workspace = yield* CrewWorkspace;
  const store = yield* CrewStore;

  const adopt = (row: EffectRow) =>
    Effect.gen(function* () {
      const payload = payloadOf<LandPayload>(row);
      const key = laneKey(payload.handle);
      const lane = yield* store.requireLane(key.crew, key.handle);
      const commit = yield* integration.landingEvidence(lane.host, payload.assignment);
      if (commit === null) return Option.none<EffectOutcome>();
      // The copy stands where the landing would have left it, recorded.
      if (lane.lastLanding !== commit) {
        yield* workspace.adopt(key, { operation: row.effectId, landed: commit });
      }
      // The landing itself answers `already-landed` and drops an anchor a cut script left.
      const value: LandValue = yield* integration.land(inputOf(payload));
      return Option.some<EffectOutcome>({ kind: "ok", value });
    }).pipe(Effect.orElseSucceed(() => Option.none<EffectOutcome>()));

  return {
    kind: CREW_EFFECT_KINDS.land,
    adopt,
    run: (row) =>
      settled(
        Effect.map(integration.land(inputOf(payloadOf<LandPayload>(row))), (outcome) =>
          done(outcome satisfies LandValue),
        ),
      ),
  } satisfies EffectHandler;
});
