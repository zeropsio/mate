/** The source's state in the account foot line; no grant, interest latch or expiry clock. */
import type { PlatformInventory } from "@t3tools/client-runtime/data";
export interface InventoryTroubleVoice {
  readonly sentence: string;
  readonly tryNow: true;
  readonly retrying: boolean;
}
const UNANSWERED: InventoryTroubleVoice = {
  sentence: "Zerops isn't answering. Trying again…",
  tryNow: true,
  retrying: true,
};
const REFUSED: InventoryTroubleVoice = {
  sentence: "Zerops isn't answering. Try now to ask again.",
  tryNow: true,
  retrying: false,
};
export function inventoryTroubleVoice(
  trouble: PlatformInventory["trouble"],
): InventoryTroubleVoice | null {
  return trouble === null ? null : trouble === "retrying" ? UNANSWERED : REFUSED;
}
export type AccountFootAction = "try-now" | "trying";
export interface AccountFootLine {
  readonly sentence: string;
  readonly actions: ReadonlyArray<AccountFootAction>;
}
export type TryNowAttempt = "idle" | "trying" | "still";
/** Presentation feedback after the person's press; it does not change source or operation state. */
export const TRY_NOW_SETTLE_MS = 8_000;
export function accountFootLine(input: {
  readonly trouble: InventoryTroubleVoice | null;
  readonly attempt: TryNowAttempt;
}): AccountFootLine | null {
  if (input.trouble === null) return null;
  return {
    sentence:
      input.attempt === "still"
        ? input.trouble.retrying
          ? "Still not answering. Trying again…"
          : "Still not answering. Try now to ask again."
        : input.trouble.sentence,
    actions: [input.attempt === "trying" ? "trying" : "try-now"],
  };
}
