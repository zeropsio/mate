/**
 * `lease.release` (replay-safe, lane `side`): an archived conversation's branch given back to its
 * pool through zcp (`LeaseRelease`), as the lease it was bound to names it. zcp checks for unsaved
 * work itself and never forces, so a release asked again after a restart loses nothing.
 *
 * It always settles `ok` with the bound lease and zcp's answer, a release not made included: the
 * decider records the receipt and unbinds only on a release.
 *
 * @module engine/effects/leaseRelease
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { LeaseReleaseResult } from "@t3tools/contracts";

import type { LeaseReleasePayload } from "../domain/decide.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { LeaseRelease } from "../ports.ts";
import { ok } from "./shared.ts";

const NO_POOL: LeaseReleaseResult = {
  outcome: "failed",
  reason: "this server has no zcp to release the branch through",
};

export const makeLeaseRelease = Effect.gen(function* () {
  const port = yield* Effect.serviceOption(LeaseRelease);
  return {
    kind: "lease.release",
    run: (row) =>
      Effect.gen(function* () {
        const { alias, branch, repo } = row.payload as LeaseReleasePayload;
        const result = Option.isNone(port)
          ? NO_POOL
          : yield* Effect.interruptible(
              port.value.release(repo === undefined ? { branch } : { branch, repo }),
            );
        return ok({ alias, branch, result });
      }),
  } satisfies EffectHandler;
});
