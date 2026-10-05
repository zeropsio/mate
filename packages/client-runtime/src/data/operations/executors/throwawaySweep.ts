/**
 * A throwaway sweep's deletes, at Zerops: exactly the throwaways the account's debt owes — by the
 * id their mint answered, or, that answer lost, by their name in the token list — and, asked by
 * the person, their own throwaways older than the door's window.
 *
 * @module data/operations/executors/throwawaySweep
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import {
  type AccountTokenRow,
  planExpiredThrowaways,
  planThrowawaySweep,
  THROWAWAY_SWEEP_AGE_MS,
  throwawayCleanupFailureState,
  type ThrowawayCleanupFailure,
  type ThrowawayDebt,
} from "../../../zerops/doorThrowaway.ts";
import { ZeropsApiError } from "../../../zerops/api.ts";
import type { OperationReceipt } from "../../model.ts";
import type { IntentOf } from "../kind.ts";

/** The two platform calls a sweep makes. */
export interface ThrowawaySweepPlatform {
  readonly listIntegrationTokens: (clientId: string) => Promise<ReadonlyArray<AccountTokenRow>>;
  readonly deleteIntegrationToken: (input: {
    readonly clientId: string;
    readonly tokenId: string;
  }) => Promise<void>;
}

/** A token already gone is deleted. */
const deleted = (cause: unknown) => cause instanceof ZeropsApiError && cause.kind === "not-found";

/** What a failed sweep says when nothing more particular is held. */
export const SWEEP_FAILED_REASON = "Sign-in cleanup failed. Delete again.";

const reasonOf = (cause: unknown) =>
  cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : "Zerops did not confirm cleanup.";

/**
 * Runs one sweep and answers with its receipt. It never fails: a delete that did not go through
 * is a failed outcome, its reason and whether it may have applied kept in the debt.
 */
export function throwawaySweepExecutor(ports: {
  readonly platform: ThrowawaySweepPlatform;
  readonly debtOf: (clientId: string) => ThrowawayDebt;
  readonly nowMs: () => number;
}) {
  return (
    requestId: string,
    intent: IntentOf<"throwaway-sweep">,
  ): Effect.Effect<OperationReceipt> =>
    Effect.map(sweep(ports, intent), (outcome) => ({
      requestId,
      operationId: requestId,
      executor: "zerops",
      affected: [],
      handles: [],
      acceptance: { kind: "accepted" },
      outcome,
    }));
}

/** The token list could not be read; `cause` is what the platform answered. */
class TokenListFailed extends Data.TaggedError("TokenListFailed")<{ readonly cause: unknown }> {}

/** At most this many reads of a throttled token list, each after the Retry-After it was given. */
const THROTTLED_LIST_TRIES = 3;
/** The wait where a throttled answer names none. */
const THROTTLE_WAIT_MS = 1_000;

const throttleWait = (cause: unknown): number | null =>
  cause instanceof ZeropsApiError && cause.status === 429
    ? (cause.retryAfterMs ?? THROTTLE_WAIT_MS)
    : null;

/** The token list, read again after a throttle's Retry-After, as the account's reads always were. */
function listTokens(
  platform: ThrowawaySweepPlatform,
  clientId: string,
  tries = THROTTLED_LIST_TRIES,
): Effect.Effect<ReadonlyArray<AccountTokenRow>, TokenListFailed> {
  return Effect.catch(
    Effect.tryPromise({
      try: () => platform.listIntegrationTokens(clientId),
      catch: (cause) => new TokenListFailed({ cause }),
    }),
    (cause) => {
      const wait = throttleWait(cause.cause);
      return wait === null || tries <= 1
        ? Effect.fail(cause)
        : Effect.andThen(Effect.sleep(wait), listTokens(platform, clientId, tries - 1));
    },
  );
}

function sweep(
  ports: Parameters<typeof throwawaySweepExecutor>[0],
  intent: IntentOf<"throwaway-sweep">,
): Effect.Effect<OperationReceipt["outcome"]> {
  const { platform } = ports;
  const { clientId, explicit } = intent;
  const debt = ports.debtOf(clientId);
  const now = ports.nowMs();
  const targets = explicit ? debt.cleanupFailures(clientId) : [];
  // Asked again over recorded failures whose ids are known: exactly those, by id.
  if (targets.length > 0 && targets.every((target) => target.tokenId !== undefined))
    return Effect.promise(() => deleteTargets(platform, debt, clientId, now, targets));
  // Captured before the list is read: a mint arriving meanwhile stays owed.
  const upToMs = Math.min(debt.failedAt(clientId) ?? now, now - THROWAWAY_SWEEP_AGE_MS - 1);
  const owed = debt.owed(clientId, upToMs);
  const failed = (cause: unknown): OperationReceipt["outcome"] => {
    debt.failSweep(clientId, upToMs);
    return { kind: "failed", evidence: reasonOf(cause) };
  };
  const listed =
    explicit || owed.some((entry) => entry.tokenId === undefined)
      ? listTokens(platform, clientId)
      : Effect.succeed<ReadonlyArray<AccountTokenRow>>([]);
  return Effect.matchEffect(listed, {
    onFailure: (failure) => Effect.succeed(failed(failure.cause)),
    onSuccess: (tokens) =>
      Effect.promise(async (): Promise<OperationReceipt["outcome"]> => {
        try {
          const stale = new Set([
            ...planThrowawaySweep({ tokens, owed }),
            ...(explicit && intent.userId !== null
              ? planExpiredThrowaways({ tokens, userId: intent.userId, nowEpochMs: now })
              : []),
          ]);
          // A cleanup that failed meanwhile is the person's to ask again: an automatic sweep stops.
          const failedMeanwhile = (): OperationReceipt["outcome"] | null =>
            !explicit && debt.sweepFailed(clientId)
              ? {
                  kind: "failed",
                  evidence: debt.cleanupFailures(clientId)[0]?.reason ?? SWEEP_FAILED_REASON,
                }
              : null;
          for (const tokenId of stale) {
            const stopped = failedMeanwhile();
            if (stopped !== null) return stopped;
            try {
              await platform.deleteIntegrationToken({ clientId, tokenId });
            } catch (cause) {
              if (!deleted(cause)) throw cause;
            }
          }
          const stopped = failedMeanwhile();
          if (stopped !== null) return stopped;
          debt.settle(clientId, upToMs);
          return { kind: "succeeded", evidence: `${stale.size} deleted` };
        } catch (cause) {
          return failed(cause);
        }
      }),
  });
}

async function deleteTargets(
  platform: ThrowawaySweepPlatform,
  debt: ThrowawayDebt,
  clientId: string,
  now: number,
  targets: ReadonlyArray<ThrowawayCleanupFailure>,
): Promise<OperationReceipt["outcome"]> {
  for (const target of targets) {
    try {
      await platform.deleteIntegrationToken({ clientId, tokenId: target.tokenId! });
    } catch (cause) {
      if (!deleted(cause)) {
        const reason = reasonOf(cause);
        debt.failCleanup(clientId, now, {
          ...target,
          state: throwawayCleanupFailureState(cause),
          reason,
        });
        return { kind: "failed", evidence: reason };
      }
    }
    debt.finish(clientId, target.attempt);
  }
  const outstanding = debt.cleanupFailures(clientId)[0];
  return outstanding === undefined
    ? { kind: "succeeded", evidence: `${targets.length} deleted` }
    : { kind: "failed", evidence: outstanding.reason };
}
