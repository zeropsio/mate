/**
 * `crew.lane.reset` (replay-safe, lane `git/<handle>`): a crewmate's copy made ready for a task.
 *
 * - `dispatch`, before a task's first turn: a copy whose tip is its last landing is reset to your
 *   tree's head, its dispatch commit recorded and its policed refs snapshotted
 *   (`prepareDispatch` and `snapshotRefs`, unchanged).
 * - `discard`, the person's ordinary task discard: the attempt's work kept as a WIP commit under
 *   its attempt ref, the copy reset to where the attempt began (`keepAndReset`, unchanged).
 *
 * A reset writes no commit, so it carries no trailer; its evidence is where it leaves the copy. Run
 * again after a crash, the handler first adopts what its earlier attempt finished: a dispatch's
 * reset is a clean copy at a head of your tree past its last landing; a discard's is its attempt
 * ref and the copy at the attempt's start, or its WIP commit (`wip(<task>): keep attempt <n>`)
 * right on the recorded tip. Anything else is not the engine's, and the copy parks as before.
 *
 * @module zerops/crew/engine/effects/laneReset
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { EffectOutcome } from "@t3tools/contracts";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import type { EffectRow } from "../../../../engine/outbox/EffectOutbox.ts";
import { CrewIntegration } from "../../CrewIntegration.ts";
import { CrewShell } from "../../CrewShell.ts";
import { CrewStore } from "../../CrewStore.ts";
import {
  attemptRef,
  CrewWorkspace,
  type DispatchOutcome,
  type KeepOutcome,
} from "../../CrewWorkspace.ts";
import { CREW_EFFECT_KINDS, done, laneKey, payloadOf, readLane, settled } from "./shared.ts";

export type LaneResetPayload =
  | { readonly mode: "dispatch"; readonly handle: string }
  | {
      readonly mode: "discard";
      readonly handle: string;
      /** `null` for a task the person started outside a run. */
      readonly run: string | null;
      readonly assignment: string;
      readonly attempt: number;
      /** The conflict-rework cap was reached: abort the open merge first. */
      readonly abortMerge?: boolean;
    };

export type LaneResetValue = DispatchOutcome | KeepOutcome;

const keepSubject = (assignment: string, attempt: number) =>
  `wip(${assignment}): keep attempt ${attempt}`;

export const makeLaneReset = Effect.gen(function* () {
  const workspace = yield* CrewWorkspace;
  const integration = yield* CrewIntegration;
  const shell = yield* CrewShell;
  const store = yield* CrewStore;

  const ok = (value: LaneResetValue) => Option.some<EffectOutcome>({ kind: "ok", value });

  const adoptDispatch = (row: EffectRow, handle: string) =>
    Effect.gen(function* () {
      const key = laneKey(handle);
      const lane = yield* store.requireLane(key.crew, key.handle);
      if (lane.frozenSince !== null || lane.recordedTip === null) return Option.none();
      if (lane.recordedTip !== lane.lastLanding) return Option.none();
      const evidence = yield* readLane(shell, lane.host, handle, [], lane.recordedTip);
      const ownReset =
        evidence.present &&
        evidence.tip !== lane.recordedTip &&
        evidence.inHead &&
        evidence.descends &&
        !evidence.dirty;
      if (!ownReset) return Option.none();
      const adopted = yield* workspace.adopt(key, {
        operation: row.effectId,
        resetTo: evidence.tip,
      });
      if (adopted._tag !== "adopted") return Option.none();
      yield* integration.snapshotRefs(key);
      return ok({ _tag: "ready", dispatchCommit: adopted.tip, reset: true });
    });

  const adoptDiscard = (payload: Extract<LaneResetPayload, { readonly mode: "discard" }>) =>
    Effect.gen(function* () {
      const key = laneKey(payload.handle);
      const lane = yield* store.requireLane(key.crew, key.handle);
      if (lane.frozenSince !== null) return Option.none();
      const ref = attemptRef(payload);
      const evidence = yield* readLane(shell, lane.host, payload.handle, [ref]);
      if (!evidence.present) return Option.none();
      const kept = evidence.refs[ref];
      if (kept !== undefined) {
        // Its ref is written and the copy stands where the attempt began: the discard is done.
        if (evidence.tip !== (lane.dispatchCommit ?? kept) || evidence.dirty) return Option.none();
        if (lane.recordedTip !== evidence.tip) {
          yield* store.updateLane(lane.crew, lane.lane, (row) => ({
            ...row,
            recordedTip: evidence.tip,
          }));
        }
        return ok({ _tag: "kept", ref, tip: kept });
      }
      // Its WIP commit, unrecorded: recorded, so the discard goes on from it instead of parking.
      if (
        evidence.tip !== lane.recordedTip &&
        evidence.parent === lane.recordedTip &&
        evidence.subject === keepSubject(payload.assignment, payload.attempt)
      ) {
        yield* store.updateLane(lane.crew, lane.lane, (row) => ({
          ...row,
          recordedTip: evidence.tip,
        }));
      }
      return Option.none();
    });

  return {
    kind: CREW_EFFECT_KINDS.laneReset,
    adopt: (row) => {
      const payload = payloadOf<LaneResetPayload>(row);
      return (
        payload.mode === "dispatch" ? adoptDispatch(row, payload.handle) : adoptDiscard(payload)
      ).pipe(Effect.orElseSucceed(() => Option.none<EffectOutcome>()));
    },
    run: (row) =>
      settled(
        Effect.gen(function* () {
          const payload = payloadOf<LaneResetPayload>(row);
          const key = laneKey(payload.handle);
          if (payload.mode === "discard") {
            const kept = yield* workspace.keepAndReset(key, {
              run: payload.run,
              assignment: payload.assignment,
              attempt: payload.attempt,
              abortMerge: payload.abortMerge,
            });
            return done(kept satisfies LaneResetValue);
          }
          const ready = yield* workspace.prepareDispatch(key);
          if (ready._tag === "ready") yield* integration.snapshotRefs(key);
          return done(ready satisfies LaneResetValue);
        }),
      ),
  } satisfies EffectHandler;
});
