/**
 * `crew.sweep` (replay-safe, lane `host/<host>`): at boot, every copy on a host read from git,
 * not from memory (`CrewWorkspace.sweep`, unchanged): a dirty copy's work saved as a WIP commit,
 * an open merge left as rework, a checked copy's tracked edits held, a tip the engine did not
 * write or an unreadable ref parked, a missing copy named for `crew.recover`.
 *
 * The sweep's WIP commit carries the sweep's own subject ({@link SWEEP_SUBJECT}) and no trailer.
 * Run again after a crash, the handler first adopts such a commit sitting right on a copy's
 * recorded tip — the sweep's own, unrecorded — and answers it as committed with its files, so
 * nothing parks on the sweep's own write and nothing is committed twice.
 *
 * @module zerops/crew/engine/effects/sweep
 */
import * as Effect from "effect/Effect";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { CrewShell } from "../../CrewShell.ts";
import { CrewStore } from "../../CrewStore.ts";
import { CrewWorkspace, type SweepLane, type SweepOutcome } from "../../CrewWorkspace.ts";
import { CREW_EFFECT_KINDS, done, payloadOf, readLane, savedBy, settled } from "./shared.ts";

/** The subject of the WIP commit `CrewWorkspace.sweep` writes. */
export const SWEEP_SUBJECT = "wip(sweep): lane work left uncommitted at boot";

export interface SweepPayload {
  readonly host: string;
  /** Crewmates whose open task passed its check: their copies are never committed. */
  readonly checked: ReadonlyArray<string>;
}

export type SweepValue = SweepOutcome;

export const makeSweep = Effect.gen(function* () {
  const workspace = yield* CrewWorkspace;
  const shell = yield* CrewShell;
  const store = yield* CrewStore;

  /** The sweep's own unrecorded WIP commits, recorded; their tips by copy. */
  const adoptOwnCommits = (host: string) =>
    Effect.gen(function* () {
      const adopted = new Map<string, string>();
      for (const lane of yield* store.lanesOnHost(host)) {
        if (lane.recordedTip === null || lane.frozenSince !== null) continue;
        const evidence = yield* readLane(shell, host, lane.lane);
        if (
          evidence.present &&
          evidence.tip !== lane.recordedTip &&
          evidence.parent === lane.recordedTip &&
          evidence.subject === SWEEP_SUBJECT
        ) {
          yield* store.updateLane(lane.crew, lane.lane, (row) => ({
            ...row,
            recordedTip: evidence.tip,
          }));
          adopted.set(lane.lane, evidence.tip);
        }
      }
      return adopted;
    });

  return {
    kind: CREW_EFFECT_KINDS.sweep,
    run: (row) =>
      settled(
        Effect.gen(function* () {
          const payload = payloadOf<SweepPayload>(row);
          const adopted = yield* adoptOwnCommits(payload.host);
          const swept = yield* workspace.sweep(payload.host, new Set(payload.checked));
          const lanes = yield* Effect.forEach(swept.lanes, (lane) =>
            lane._tag === "clean" && adopted.get(lane.handle) === lane.tip
              ? Effect.map(
                  savedBy(shell, payload.host, lane.handle, lane.tip),
                  (saved): SweepLane => ({
                    handle: lane.handle,
                    _tag: "committed",
                    tip: lane.tip,
                    saved,
                  }),
                )
              : Effect.succeed(lane),
          );
          return done({ lanes, brokenRefs: swept.brokenRefs } satisfies SweepValue);
        }),
      ),
  } satisfies EffectHandler;
});
