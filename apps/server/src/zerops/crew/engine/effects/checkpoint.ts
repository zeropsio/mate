/**
 * `crew.checkpoint` (replay-safe, lane `git/<handle>`): a turn's end, its work kept as a WIP
 * commit by the crew (`commitTurn`, its guards and conflict rule unchanged), then the copy's
 * policed refs read against its dispatch snapshot. A checked copy is the tree that lands: nothing
 * is committed on it, and its tracked edits are reported instead.
 *
 * The commit carries the effect id as its `Crew-Operation:` trailer. Run again after a crash, the
 * handler first adopts a commit its earlier attempt finished on the service — recorded or not —
 * and answers with it, so a turn is never committed twice and never parked on its own write.
 *
 * @module zerops/crew/engine/effects/checkpoint
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { EffectOutcome } from "@t3tools/contracts";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import type { EffectRow } from "../../../../engine/outbox/EffectOutbox.ts";
import { CrewIntegration, type RefChange } from "../../CrewIntegration.ts";
import { CrewShell } from "../../CrewShell.ts";
import { CrewStore } from "../../CrewStore.ts";
import { CrewWorkspace, type LaneCommit } from "../../CrewWorkspace.ts";
import {
  CREW_EFFECT_KINDS,
  done,
  laneKey,
  payloadOf,
  readLane,
  savedBy,
  settled,
} from "./shared.ts";

export interface CheckpointPayload {
  readonly handle: string;
  /** The open task; none for a copy saved outside any task (`wip(idle)`). */
  readonly assignment: string | null;
  /** The turn's number within the task's attempt. */
  readonly turn: number;
  /** The task passed its check: its copy is the tree that lands, never committed on. */
  readonly checked?: boolean;
  readonly maxBlobBytes?: number;
  /** Refs the engine wrote since the dispatch (`engineRefs`): never blamed on the turn. */
  readonly explained: ReadonlyArray<string>;
}

export type CheckpointValue =
  /** A checked copy: whether a tracked file differs from its tip. */
  | { readonly _tag: "checked"; readonly edits: boolean }
  /** The commit's outcome, and the policed refs that moved without an explanation. */
  | {
      readonly _tag: "saved";
      readonly commit: LaneCommit;
      readonly changes: ReadonlyArray<RefChange>;
    };

export const makeCheckpoint = Effect.gen(function* () {
  const workspace = yield* CrewWorkspace;
  const integration = yield* CrewIntegration;
  const shell = yield* CrewShell;
  const store = yield* CrewStore;

  const police = (payload: CheckpointPayload, commit: LaneCommit) =>
    commit._tag === "committed" || commit._tag === "unchanged"
      ? integration.police(laneKey(payload.handle), payload.explained)
      : Effect.succeed<ReadonlyArray<RefChange>>([]);

  const saved = (commit: LaneCommit, changes: ReadonlyArray<RefChange>): CheckpointValue => ({
    _tag: "saved",
    commit,
    changes,
  });

  /** The copy's tip is this effect's own commit: adopted when unrecorded, answered as committed. */
  const adopt = (row: EffectRow) =>
    Effect.gen(function* () {
      const payload = payloadOf<CheckpointPayload>(row);
      if (payload.checked === true) return Option.none<EffectOutcome>();
      const key = laneKey(payload.handle);
      yield* workspace.adopt(key, { operation: row.effectId });
      const lane = yield* store.requireLane(key.crew, key.handle);
      const evidence = yield* readLane(shell, lane.host, payload.handle);
      if (!evidence.present || evidence.operation !== row.effectId) return Option.none();
      if (evidence.tip !== lane.recordedTip) return Option.none();
      const commit: LaneCommit = {
        _tag: "committed",
        tip: evidence.tip,
        saved: yield* savedBy(shell, lane.host, payload.handle, evidence.tip),
      };
      const value = saved(commit, yield* police(payload, commit));
      return Option.some<EffectOutcome>({ kind: "ok", value });
    }).pipe(Effect.orElseSucceed(() => Option.none<EffectOutcome>()));

  return {
    kind: CREW_EFFECT_KINDS.checkpoint,
    adopt,
    run: (row) =>
      settled(
        Effect.gen(function* () {
          const payload = payloadOf<CheckpointPayload>(row);
          const key = laneKey(payload.handle);
          if (payload.checked === true) {
            const edits = yield* workspace.trackedEdits(key);
            return done({ _tag: "checked", edits } satisfies CheckpointValue);
          }
          const commit = yield* workspace.commitTurn(key, {
            assignment: payload.assignment ?? "idle",
            turn: payload.turn,
            maxBlobBytes: payload.maxBlobBytes,
            operation: row.effectId,
          });
          return done(saved(commit, yield* police(payload, commit)));
        }),
      ),
  } satisfies EffectHandler;
});
