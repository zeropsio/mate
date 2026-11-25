/**
 * The renewal of an environment's deploy key, as the surfaces that offer it say where it stands:
 * the release sheet's stopped step and the place page's key banner. HQ runs it as the
 * application's `deploy_key` operation; this reads that operation as its navigation shows it, to
 * every device. Pure.
 */
import {
  operationFailureWords,
  type HqOperationStanding,
  type WaitingPress,
} from "@t3tools/client-runtime/data";
import type { HqOperationFailure } from "@t3tools/shared/hqOperationFailure";

/** The renewal a surface shows, as HQ's operation says it stands. */
export type KeyRenewal =
  | { readonly kind: "none" | "working" | "renewed" }
  | { readonly kind: "failed"; readonly words: string; readonly press?: WaitingPress };

export const NOT_RENEWING: KeyRenewal = { kind: "none" };

/** The press HQ's keep decision and the renewal's standing offer this person. */
export function keyRenewOffer(
  standing: HqOperationStanding,
  mayKeep: boolean | undefined,
): "continue" | "start" | "none" {
  if (standing.kind === "waiting") return standing.yours ? "continue" : "none";
  return mayKeep === false ? "none" : "start";
}

/** The renewal's button: the word of the wait it would continue, else a new renewal's. */
export const keyRenewPress = (renewal: KeyRenewal | undefined): string =>
  (renewal?.kind === "failed" ? renewal.press : undefined) ?? "Renew the key";

/** What the person is told of a renewal HQ stopped. */
export function keyRenewFailureWords(failure: HqOperationFailure): string {
  if (failure.step !== "retire") return operationFailureWords(failure);
  const who =
    failure.code === "ownerRoleRequired"
      ? "the organisation's Owner"
      : "an owner or admin of the organization";
  return `The new deploy key is kept. The previous deploy token stays in Zerops; ${who} deletes it.`;
}

/**
 * Where a renewal stands: HQ's `deploy_key` operation on the application (`standing`), and the
 * start this surface made (`asked`): refused, under way until HQ's navigation showed it, or ended
 * done once it showed it and no longer does.
 */
export function keyRenewalOf(
  standing: HqOperationStanding,
  asked: { readonly refused: string } | "pending" | "ended" | undefined,
): KeyRenewal {
  if (typeof asked === "object") return { kind: "failed", words: asked.refused };
  if (asked === "pending") return { kind: "working" };
  switch (standing.kind) {
    case "going":
      return { kind: "working" };
    case "waiting":
      return {
        kind: "failed",
        words: standing.yours
          ? standing.line
          : "It waits for the person who started it to continue it.",
        ...(standing.yours ? { press: standing.press } : {}),
      };
    case "failed":
      return { kind: "failed", words: keyRenewFailureWords(standing.failure) };
    case "none":
      return asked === "ended" ? { kind: "renewed" } : NOT_RENEWING;
    // A renewal ends at no decision of the person's.
    case "needs":
      return NOT_RENEWING;
  }
}
