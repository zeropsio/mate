/**
 * `lease.release` (replay-safe, lane `workspace`, run by the Mate-wide fibers): an archived
 * conversation's branch given back to its pool through zcp (`LeaseRelease`), as the lease it was
 * bound to names it. zcp checks for unsaved work itself and never forces, so a release asked again
 * after a restart loses nothing; one that finds the branch holds no lease any more is released.
 *
 * A conversation unarchived before its release started withdraws it: zcp is never asked. zcp
 * releases every lease of the branch, so each other conversation bound to a lease it released is
 * unbound here; the archived one is unbound by its own receipt.
 *
 * It always settles `ok` with the bound lease and zcp's answer, a release not made included: the
 * decider records the receipt and unbinds only on a release.
 *
 * @module engine/effects/leaseRelease
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import { CommandId, type LeaseReleaseResult } from "@t3tools/contracts";

import { Conversations } from "../Conversations.ts";
import type { LeaseReleasePayload } from "../domain/decide.ts";
import type { EffectRow } from "../outbox/EffectOutbox.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { LeaseRelease } from "../ports.ts";
import { readConversationLeases } from "../read/conversationView.ts";
import { ok } from "./shared.ts";

const NO_POOL: LeaseReleaseResult = {
  outcome: "failed",
  reason: "this server has no zcp to release the branch through",
};

const ENGINE = { kind: "engine" } as const;

export const makeLeaseRelease = Effect.gen(function* () {
  const port = yield* Effect.serviceOption(LeaseRelease);
  const conversations = yield* Conversations;
  const sql = yield* SqlClient.SqlClient;

  /** Every other conversation bound to a lease the release took: its lease ended. */
  const unbindOthers = (row: EffectRow, released: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const { leases } = yield* readConversationLeases;
      for (const { conversationId, lease } of leases) {
        if (conversationId === row.conversationId || !released.includes(lease.alias)) continue;
        yield* conversations.tell({
          commandId: CommandId.make(`${row.effectId}/unbind/${conversationId}`),
          conversationId,
          principal: ENGINE,
          command: { _tag: "UnbindLease", ended: lease.alias },
        });
      }
    }).pipe(
      Effect.provideService(Conversations, conversations),
      Effect.provideService(SqlClient.SqlClient, sql),
      // zcp's next read of its leases unbinds whoever this missed.
      Effect.catchCause((cause) =>
        Effect.logWarning("Mate engine: a released lease's other conversations kept it", cause),
      ),
    );

  return {
    kind: "lease.release",
    run: (row) =>
      Effect.gen(function* () {
        const { alias, branch, repo } = row.payload as LeaseReleasePayload;
        const state = yield* conversations.state(row.conversationId).pipe(Effect.option);
        // Its record unread: tried again, as a replay-safe effect is.
        if (Option.isNone(state)) {
          return { _tag: "Retry", reason: "the conversation's record could not be read" } as const;
        }
        if (!state.value.archived) return ok({ alias, branch, result: { outcome: "withdrawn" } });
        if (Option.isNone(port)) return ok({ alias, branch, result: NO_POOL });
        const result = yield* Effect.interruptible(
          port.value.release(repo === undefined ? { branch } : { branch, repo }),
        );
        const went =
          result.outcome === "released"
            ? result.leases
            : result.outcome === "failed"
              ? (result.released ?? [])
              : [];
        if (went.length > 0) {
          yield* unbindOthers(
            row,
            went.map((lease) => lease.lease),
          );
        }
        return ok({ alias, branch, result });
      }),
  } satisfies EffectHandler;
});
