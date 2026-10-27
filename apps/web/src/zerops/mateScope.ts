/**
 * Whose Mates the left menu lists — *Mine* or *Everyone* — as this browser
 * remembers it, under the signed-in account's key, beside the project order
 * in the account menu. A per-viewer convenience: nothing is hidden from
 * anybody but the viewer who chose it.
 */
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../hooks/useLocalStorage";

export const MATE_SCOPE_STORAGE_KEY = "mate:zerops:mate-scope";
export const MateScopeSchema = Schema.Literals(["everyone", "mine"]);
export type MateScope = typeof MateScopeSchema.Type;

/** The two scopes, in the words the account menu offers them. */
export const MATE_SCOPE_CHOICES: ReadonlyArray<{
  readonly value: MateScope;
  readonly label: string;
}> = [
  { value: "mine", label: "Mine" },
  { value: "everyone", label: "Everyone" },
];

export function useMateScope(): readonly [MateScope, (next: MateScope) => void] {
  return useLocalStorage(MATE_SCOPE_STORAGE_KEY, "everyone", MateScopeSchema);
}

/**
 * Whether the menu lists a Mate: *Everyone* lists them all; *Mine* those HQ says are the
 * viewer's (`mine`, HQ's person facts), and any HQ says nothing of — and never hides the one whose
 * conversation is open.
 */
export function shownInScope(
  scope: MateScope,
  mine: boolean | undefined,
  active: boolean,
): boolean {
  if (scope === "everyone" || active) return true;
  return mine !== false;
}
