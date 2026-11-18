import type { Phase } from "../streamMachine.ts";

/**
 * Whether a detail is read, as `readDetail` answers it: `true` once it is live and no read asked
 * afresh is still owed to it, `null` while a read the live link will make is awaited, `false` for
 * anything else — a link down or refused is no answer, also while a read is owed.
 */
export const detailReadAnswer = (detail: Phase, link: Phase, owed: boolean): boolean | null => {
  if (detail === "live") return owed ? null : true;
  if (detail === "connecting" || detail === "baselining") return null;
  return detail === "stale" && link === "live" ? null : false;
};
