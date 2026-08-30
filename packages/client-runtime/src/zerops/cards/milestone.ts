import type { ZeropsActivityResult } from "../activityResult.ts";
import { readZeropsCardSource } from "./decode.ts";
import { decodeZeropsCard, type ZeropsCardPayload } from "./payloads.ts";

export const MILESTONE_KINDS: ReadonlySet<ZeropsCardPayload["kind"]> = new Set([
  "plan",
  "import",
  "deploy",
  "verify",
  "error",
]);

export interface ZeropsMilestoneEntry {
  readonly zeropsResult?: ZeropsActivityResult;
  readonly toolLifecycleStatus?: string;
}

const milestoneByEntry = new WeakMap<ZeropsMilestoneEntry, boolean>();

/** Whether this entry carries a card whose kind stays visible in the timeline. */
export function isZeropsMilestone(entry: ZeropsMilestoneEntry | null | undefined): boolean {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  const cached = milestoneByEntry.get(entry);
  if (cached !== undefined) {
    return cached;
  }

  const card = decodeZeropsCard(
    readZeropsCardSource(entry.zeropsResult, {
      failed: entry.toolLifecycleStatus === "failed",
    }),
  );
  const milestone = card !== undefined && MILESTONE_KINDS.has(card.kind);
  milestoneByEntry.set(entry, milestone);
  return milestone;
}
