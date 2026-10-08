/**
 * `crew.mergeIn` (replay-safe, lane `git/<handle>`): your tree's head taken into a crewmate's
 * copy (`CrewIntegration.mergeIn`, unchanged), so its check runs on exactly the tree that would
 * land. The merge commit carries the effect id as its `Crew-Operation:` trailer.
 *
 * Run again after a crash, the handler first reads what its earlier attempt left: its own merge
 * commit (recorded or not) is adopted and answered as merged; a merge git left open on a conflict
 * with a head of your tree is answered as that conflict. An adopted merge cannot tell whether it
 * moved a lockfile, so it says one moved and the copy's setup runs again.
 *
 * @module zerops/crew/engine/effects/mergeIn
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { EffectOutcome } from "@t3tools/contracts";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import type { EffectRow } from "../../../../engine/outbox/EffectOutbox.ts";
import { CrewIntegration, type MergeOutcome } from "../../CrewIntegration.ts";
import { CrewShell } from "../../CrewShell.ts";
import { CrewStore } from "../../CrewStore.ts";
import { CrewWorkspace } from "../../CrewWorkspace.ts";
import { CREW_EFFECT_KINDS, done, laneKey, payloadOf, readLane, settled } from "./shared.ts";

export interface MergeInPayload {
  readonly handle: string;
}

export type MergeInValue = MergeOutcome;

export const makeMergeIn = Effect.gen(function* () {
  const integration = yield* CrewIntegration;
  const workspace = yield* CrewWorkspace;
  const shell = yield* CrewShell;
  const store = yield* CrewStore;

  const adopt = (row: EffectRow) =>
    Effect.gen(function* () {
      const key = laneKey(payloadOf<MergeInPayload>(row).handle);
      yield* workspace.adopt(key, { operation: row.effectId });
      const lane = yield* store.requireLane(key.crew, key.handle);
      if (lane.frozenSince !== null) return Option.none<EffectOutcome>();
      const evidence = yield* readLane(shell, lane.host, key.handle);
      if (!evidence.present || evidence.tip !== lane.recordedTip) return Option.none();
      if (evidence.operation === row.effectId && evidence.mergedFrom !== null) {
        const value: MergeInValue = {
          _tag: "merged",
          head: evidence.mergedFrom,
          tip: evidence.tip,
          lockfileChanged: true,
        };
        return Option.some<EffectOutcome>({ kind: "ok", value });
      }
      if (evidence.mergeHead !== null && evidence.mergeHeadInHead) {
        const value: MergeInValue = {
          _tag: "conflict",
          head: evidence.mergeHead,
          paths: evidence.unmerged,
        };
        return Option.some<EffectOutcome>({ kind: "ok", value });
      }
      return Option.none();
    }).pipe(Effect.orElseSucceed(() => Option.none<EffectOutcome>()));

  return {
    kind: CREW_EFFECT_KINDS.mergeIn,
    adopt,
    run: (row) =>
      settled(
        Effect.map(
          integration.mergeIn(laneKey(payloadOf<MergeInPayload>(row).handle), row.effectId),
          (outcome) => done(outcome satisfies MergeInValue),
        ),
      ),
  } satisfies EffectHandler;
});
