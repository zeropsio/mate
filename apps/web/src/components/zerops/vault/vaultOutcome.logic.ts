/**
 * How a vault write or a restart ended, as the panel says it: taken, or refused with the platform's
 * code and the account's own sentence. `null` while it is still on its way.
 */
import type { OperationEnd, OperationProgress } from "@t3tools/client-runtime/data";

import type { VaultWriteOutcome } from "./VaultPanel";

export function vaultOutcome(
  end: OperationProgress | NonNullable<OperationEnd>,
): VaultWriteOutcome | null {
  const refused = (message: string, code: string | null = null): VaultWriteOutcome => ({
    ok: false,
    code,
    message,
  });
  switch (end.stage) {
    case "unknown":
    case "submitting":
    case "accepted":
    case "reflected":
      return null;
    case "uncertain":
      return end.next === "asking-owner"
        ? null
        : refused("Zerops did not answer whether it took it. Look again before trying again.");
    case "refused":
      return refused(end.reason, end.code ?? null);
    case "unsent":
      return refused(end.reason ?? "Zerops did not take it. Try again.");
    case "done":
      return end.outcome === "succeeded"
        ? { ok: true }
        : refused(end.reason ?? "Zerops did not finish it.");
    case "unresolved":
      return refused(end.reason ?? "Zerops did not say how it ended.");
    case "unobserved":
      return { ok: true };
  }
}
