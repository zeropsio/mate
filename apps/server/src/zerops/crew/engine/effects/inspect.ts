/**
 * `crew.inspect` (replay-safe, lane `host/<host>`): at boot, a host's facts read exactly, never
 * written: your tree's head, each copy's presence and figures (`CrewReads.laneStats`), and whether
 * each landing that was under way went through (`CrewIntegration.landingEvidence`). It writes no
 * git, so a re-run reads the same facts again.
 *
 * @module zerops/crew/engine/effects/inspect
 */
import * as Effect from "effect/Effect";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import { CrewIntegration } from "../../CrewIntegration.ts";
import { CrewReads, type Integration, type LaneStats } from "../../CrewReads.ts";
import { CrewShell } from "../../CrewShell.ts";
import { CREW_EFFECT_KINDS, done, payloadOf, readLane, settled } from "./shared.ts";

export interface InspectPayload {
  readonly host: string;
  /** The writers whose copies live on the host. */
  readonly handles: ReadonlyArray<string>;
  /** Tasks whose landing was under way: whether each is in your tree. */
  readonly landings: ReadonlyArray<string>;
}

export interface InspectValue {
  readonly integration: Integration;
  readonly lanes: ReadonlyArray<{
    readonly handle: string;
    readonly present: boolean;
    /** Its figures against your tree; none when the copy is missing. */
    readonly stats: LaneStats | null;
  }>;
  readonly landings: ReadonlyArray<{ readonly assignment: string; readonly commit: string | null }>;
}

export const makeInspect = Effect.gen(function* () {
  const reads = yield* CrewReads;
  const integration = yield* CrewIntegration;
  const shell = yield* CrewShell;

  return {
    kind: CREW_EFFECT_KINDS.inspect,
    run: (row) =>
      settled(
        Effect.gen(function* () {
          const payload = payloadOf<InspectPayload>(row);
          const head = yield* reads.integration(payload.host);
          const lanes = yield* Effect.forEach(payload.handles, (handle) =>
            Effect.gen(function* () {
              const present = (yield* readLane(shell, payload.host, handle)).present;
              const stats = present ? yield* reads.laneStats(payload.host, handle) : null;
              return { handle, present, stats };
            }),
          );
          const landings = yield* Effect.forEach(payload.landings, (assignment) =>
            Effect.map(integration.landingEvidence(payload.host, assignment), (commit) => ({
              assignment,
              commit,
            })),
          );
          return done({ integration: head, lanes, landings } satisfies InspectValue);
        }),
      ),
  } satisfies EffectHandler;
});
