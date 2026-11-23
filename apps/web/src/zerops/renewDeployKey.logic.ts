/**
 * The renewal of an environment's deploy key, as the surfaces that offer it say where it stands:
 * the release sheet's stopped step and the place page's key banner. HQ runs it as the
 * application's `deploy_key` operation; this reads that operation as its navigation shows it, to
 * every device. Pure.
 */
import { operationFailureWords, type HqOperationStanding } from "@t3tools/client-runtime/data";
import type { HqOperationFailure } from "@t3tools/shared/hqOperationFailure";

/** The renewal a surface shows, as HQ's operation says it stands. */
export type KeyRenewal =
  | { readonly kind: "none" | "working" | "renewed" }
  | { readonly kind: "failed"; readonly words: string };

export const NOT_RENEWING: KeyRenewal = { kind: "none" };

/**
 * The new key is kept, but Zerops keeps the deleting of a token an Owner made to an Owner: HQ ends
 * the operation at its retire step with Zerops' `ownerRoleRequired`.
 */
const OLD_KEY_LEFT = "The previous deploy token still works: the organisation's Owner deletes it.";

/** What the person is told of a renewal HQ stopped. */
export function keyRenewFailureWords(failure: HqOperationFailure): string {
  return failure.step === "retire" && failure.code === "ownerRoleRequired"
    ? OLD_KEY_LEFT
    : operationFailureWords(failure);
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
          ? "Your Zerops sign-in ran out before it finished. Renew to continue it."
          : "It waits for the person who started it to continue it.",
      };
    case "failed":
      return { kind: "failed", words: keyRenewFailureWords(standing.failure) };
    case "none":
      return asked === "ended" ? { kind: "renewed" } : NOT_RENEWING;
  }
}
