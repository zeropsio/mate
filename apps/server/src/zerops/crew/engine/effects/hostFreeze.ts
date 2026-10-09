/**
 * `crew.host.freeze` (replay-safe, lane `host/<host>`): a self-deploy started on a host, so no
 * copy there is written, set up or reset until `crew.recover` thaws it (`CrewWorkspace.freeze`,
 * unchanged). It queues on the host's lane, so the recovery that thaws it always comes after.
 *
 * A freeze's evidence is the copies' freeze time. Run again after a crash, the handler finds every
 * copy on the host already frozen and answers with them, keeping the time the deploy began.
 *
 * @module zerops/crew/engine/effects/hostFreeze
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { EffectOutcome } from "@t3tools/contracts";

import type { EffectHandler } from "../../../../engine/outbox/EffectWorker.ts";
import type { EffectRow } from "../../../../engine/outbox/EffectOutbox.ts";
import { CrewStore } from "../../CrewStore.ts";
import { CrewWorkspace } from "../../CrewWorkspace.ts";
import { CREW_EFFECT_KINDS, done, payloadOf, settled } from "./shared.ts";

export interface HostFreezePayload {
  readonly host: string;
}

export interface HostFreezeValue {
  /** The crewmates whose copies on the host are frozen. */
  readonly lanes: ReadonlyArray<string>;
}

export const makeHostFreeze = Effect.gen(function* () {
  const workspace = yield* CrewWorkspace;
  const store = yield* CrewStore;

  const adopt = (row: EffectRow) =>
    Effect.gen(function* () {
      const lanes = yield* store.lanesOnHost(payloadOf<HostFreezePayload>(row).host);
      if (lanes.length === 0 || lanes.some((lane) => lane.frozenSince === null)) {
        return Option.none<EffectOutcome>();
      }
      const value: HostFreezeValue = { lanes: lanes.map((lane) => lane.lane) };
      return Option.some<EffectOutcome>({ kind: "ok", value });
    }).pipe(Effect.orElseSucceed(() => Option.none<EffectOutcome>()));

  return {
    kind: CREW_EFFECT_KINDS.hostFreeze,
    adopt,
    run: (row) =>
      settled(
        Effect.map(workspace.freeze(payloadOf<HostFreezePayload>(row).host), (keys) =>
          done({ lanes: keys.map((key) => key.handle) } satisfies HostFreezeValue),
        ),
      ),
  } satisfies EffectHandler;
});
