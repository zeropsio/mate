/**
 * An empty crewmate chat opens on its own empty state (the owner, 2026-09-29):
 * a save's seam — "Its job changed — from its next message", the goal's or
 * a login's — dated before the crewmate's first message told of a
 * conversation that had not begun yet, so it is not drawn; one after the
 * first message is the conversation's history, and stays. The other seams —
 * why the conversation began and the one before it, a landing — are the
 * crewmate's own and always stand.
 *
 * Only while the conversation is read from its start: with older turns still
 * to load, its first message is not known, and every seam stays.
 *
 * Pure: no clock, no I/O.
 */
import type { TimelineEntry } from "../../../session-logic";

export function crewChatEntries(entries: TimelineEntry[], fromStart: boolean): TimelineEntry[] {
  if (!fromStart) return entries;
  const firstMessageAt = Math.min(
    ...entries.flatMap((entry) => (entry.kind === "message" ? [Date.parse(entry.createdAt)] : [])),
  );
  const early = (entry: TimelineEntry) =>
    entry.kind === "work" &&
    entry.entry.crewSeam?.seam === "saved" &&
    !(Date.parse(entry.createdAt) >= firstMessageAt);
  return entries.some(early) ? entries.filter((entry) => !early(entry)) : entries;
}
