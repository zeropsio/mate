/**
 * "Load earlier" from a view to whoever reads its conversation: the engine conversation a view
 * holds registers how its next older page is read, and the view asks by thread.
 *
 * @module data/olderTurns
 */
import type {
  EnvironmentId as EnvironmentIdType,
  ThreadId as ThreadIdType,
} from "@t3tools/contracts";

import { threadKey } from "../state/entities.ts";

const handlers = new Map<string, () => void>();

/**
 * Asks whoever reads `threadId` to fetch its next older page. Returns false when nobody does;
 * callers render from `EnvironmentThreadState.page` and can treat false as "nothing to do".
 */
export function requestOlderThreadTurns(
  environmentId: EnvironmentIdType,
  threadId: ThreadIdType,
): boolean {
  const handler = handlers.get(threadKey({ environmentId, threadId }));
  if (handler === undefined) return false;
  handler();
  return true;
}

/**
 * Registers who fetches a thread's next older page when asked; a later registration for the same
 * thread replaces it. Returns the deregistration.
 */
export function registerOlderThreadTurns(
  environmentId: EnvironmentIdType,
  threadId: ThreadIdType,
  handler: () => void,
): () => void {
  const key = threadKey({ environmentId, threadId });
  handlers.set(key, handler);
  return () => {
    if (handlers.get(key) === handler) handlers.delete(key);
  };
}
