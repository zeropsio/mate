import type { Phase } from "../streamMachine.ts";

/**
 * Whether a detail is read, as `readDetail` answers it: `true` once it is live and no read asked
 * afresh is still owed to it, `null` while a read the live link will make is awaited — one owed to
 * a failing detail included — and `false` for anything else: a failure no read was asked after,
 * or a link down or refused, which is no answer also while a read is owed.
 */
export const detailReadAnswer = (detail: Phase, link: Phase, owed: boolean): boolean | null => {
  if (detail === "live") return owed ? null : true;
  if (detail === "recovering") return owed && link === "live" ? null : false;
  if (detail === "connecting" || detail === "baselining") return null;
  return detail === "stale" && link === "live" ? null : false;
};
