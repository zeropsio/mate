/**
 * The writes each organization's official HQ executes, as the account's operations reach them:
 * held for as long as the organization's HQ is observed (`ZeropsHqNavigation`), so a write goes to
 * the HQ the account reads, and to none once that HQ is no longer named.
 */
import type { HqWrites } from "@t3tools/client-runtime/data";

const held = new Map<string, HqWrites>();

/** Holds an organization's HQ writes; answers their release. */
export function holdHqWrites(orgId: string, writes: HqWrites): () => void {
  held.set(orgId, writes);
  return () => {
    if (held.get(orgId) === writes) held.delete(orgId);
  };
}

/** The organization's HQ writes, while its HQ is observed; `null` otherwise. */
export function hqWritesOf(orgId: string): HqWrites | null {
  return held.get(orgId) ?? null;
}
