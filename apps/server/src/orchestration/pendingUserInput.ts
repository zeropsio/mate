/**
 * The user-input requests a thread still waits on, folded from its user-input
 * lifecycle activities: the one fold behind the shell's `hasPendingUserInput`
 * (how many stay open) and its `pendingQuestion` (what the oldest open one
 * asks), so the two can never say different things.
 *
 * @module pendingUserInput
 */
import { messagePreviewText } from "@t3tools/shared/messagePreview";

export interface UserInputLifecycleActivity {
  readonly activityId: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

/** What a failed reply says when the provider no longer knows the request: it is closed. */
const STALE_REQUEST_FAILURES = [
  "stale pending user-input request",
  "unknown pending user-input request",
  "unknown pending user input request",
  "unknown pending codex user input request",
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The requests still open, as the activities that asked them, oldest first. */
export function openUserInputRequests<Activity extends UserInputLifecycleActivity>(
  activities: ReadonlyArray<Activity>,
): ReadonlyArray<Activity> {
  const open = new Map<string, Activity>();
  // Request ids are unique: a terminal receipt stays final at equal timestamps or out-of-order replay.
  const closed = new Set<string>();
  const ordered = [...activities].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.activityId.localeCompare(right.activityId),
  );
  for (const activity of ordered) {
    const payload = asRecord(activity.payload);
    const requestId = payload?.requestId;
    if (typeof requestId !== "string") continue;
    if (activity.kind === "user-input.requested") {
      if (!closed.has(requestId)) open.set(requestId, activity);
    } else if (activity.kind === "user-input.resolved") {
      closed.add(requestId);
      open.delete(requestId);
    } else if (activity.kind === "provider.user-input.respond.failed") {
      const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : "";
      if (STALE_REQUEST_FAILURES.some((failure) => detail.includes(failure))) {
        closed.add(requestId);
        open.delete(requestId);
      }
    }
  }
  return [...open.values()];
}

/**
 * What the thread waits on the person to answer: the oldest open request's
 * first question that has words, quoted the way a preview quotes a message
 * (one line, markdown's marks dropped, credentials masked, cut at a word).
 * Null when nothing is asked.
 */
export function pendingUserInputQuestion(
  activities: ReadonlyArray<UserInputLifecycleActivity>,
): string | null {
  for (const request of openUserInputRequests(activities)) {
    const questions = asRecord(request.payload)?.questions;
    if (!Array.isArray(questions)) continue;
    for (const question of questions) {
      const text = asRecord(question)?.question;
      const quoted = typeof text === "string" ? messagePreviewText(text) : null;
      if (quoted !== null) return quoted;
    }
  }
  return null;
}
