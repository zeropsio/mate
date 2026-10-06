import * as Arr from "effect/Array";
import type { OrchestrationShellSnapshot, OrchestrationShellStreamEvent } from "@t3tools/contracts";
import { shareEqual } from "@t3tools/shared/structuralSharing";

/**
 * `items` with `next` upserted by id. An upsert equal to what the list holds
 * keeps the list itself, and a changed one keeps its unchanged parts
 * (`shareEqual`): a streaming thread's server re-sends its whole shell up to
 * every 50 ms, mostly to move `updatedAt`, and every reader compares by
 * reference — the open conversation's turn and session, the menu's rows.
 */
function upsertShared<T extends { readonly id: string }>(
  items: ReadonlyArray<T>,
  next: T,
): ReadonlyArray<T> {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return Arr.append(items, next);
  const previous = items[index]!;
  const shared = shareEqual(previous, next);
  if (shared === previous) return items;
  const out = items.slice();
  out[index] = shared;
  return out;
}

/**
 * Reduce a single shell stream event into an existing snapshot, returning a new
 * snapshot with the event's changes applied. This is a pure reducer that both
 * web and mobile can use to keep their local shell snapshot in sync.
 *
 * Returns the original snapshot reference unchanged if the event is not
 * recognized (forward-compatible).
 */
export function applyShellStreamEvent(
  snapshot: OrchestrationShellSnapshot,
  event: OrchestrationShellStreamEvent,
): OrchestrationShellSnapshot {
  if (event.sequence <= snapshot.snapshotSequence) return snapshot;

  switch (event.kind) {
    case "project-upserted": {
      const projects = upsertShared(snapshot.projects, event.project);
      return { ...snapshot, projects, snapshotSequence: event.sequence };
    }
    case "project-removed":
      return {
        ...snapshot,
        projects: Arr.filter(snapshot.projects, (p) => p.id !== event.projectId),
        snapshotSequence: event.sequence,
      };
    case "thread-upserted": {
      const threads = upsertShared(snapshot.threads, event.thread);
      return { ...snapshot, threads, snapshotSequence: event.sequence };
    }
    case "thread-removed":
      return {
        ...snapshot,
        threads: Arr.filter(snapshot.threads, (t) => t.id !== event.threadId),
        snapshotSequence: event.sequence,
      };
    default:
      return snapshot;
  }
}
