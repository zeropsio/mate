/**
 * The renewal of an environment's deploy key, as the surfaces that offer it say where it stands:
 * the release sheet's stopped step and the place page's key banner. Pure.
 */
import type { OperationEnd } from "@t3tools/client-runtime/data";

/** The renewal a surface runs, as its operation says it stands. */
export type KeyRenewal =
  | { readonly kind: "none" | "working" | "renewed" }
  | { readonly kind: "failed"; readonly words: string };

export const NOT_RENEWING: KeyRenewal = { kind: "none" };

/**
 * What the person is told of a renewal that did not end with HQ keeping the new key; `null` once
 * it does. Where its end is not known — Zerops refused or dropped the mint without the operation
 * learning which — it says what is known and where to look, never that it "could not be followed".
 */
export function keyRenewTrouble(end: NonNullable<OperationEnd>, place: string): string | null {
  switch (end.stage) {
    case "done":
      return end.outcome === "succeeded" ? null : (end.reason ?? "HQ did not keep the new key.");
    case "refused":
      return end.reason;
    case "unsent":
      return end.reason ?? "Zerops did not make the key. Try again.";
    default:
      return `Zerops did not confirm the new key; check ${place}'s access tokens in Zerops, then renew again.`;
  }
}
