/**
 * Saying something on a change, as the account's `change-comment` operation: sent only once HQ's
 * conversation has been read — what the change already holds is then known, so a lost answer adopts
 * only words that came after the press — and said as soon as HQ took it. What HQ did not take is
 * told under the box in the words today's HQ answers use.
 */
import type {
  ChangeDiscussionRead,
  OperationProgress,
  Operations,
} from "@t3tools/client-runtime/data";
import { HQ_WRITE_UNCERTAIN } from "@t3tools/client-runtime/zerops/hq";

export type CommentIntent = Extract<
  Parameters<Operations["submit"]>[0],
  { readonly kind: "change-comment" }
>;

/** What the person is told of a comment HQ did not take; `null` once HQ took it. */
export function commentRefusal(progress: OperationProgress): string | null {
  switch (progress.stage) {
    case "refused":
      return progress.reason;
    case "unsent":
      return progress.reason ?? "HQ could not be reached.";
    case "uncertain":
      return HQ_WRITE_UNCERTAIN;
    default:
      return null;
  }
}

export interface SayPorts {
  /** The conversation once its read has settled: read, or why it cannot be. */
  readonly untilRead: () => Promise<ChangeDiscussionRead>;
  readonly submit: (
    intent: CommentIntent,
  ) => Promise<{ readonly requestId: string; readonly progress: OperationProgress }>;
}

export type Said =
  | { readonly kind: "accepted"; readonly requestId: string }
  | { readonly kind: "refused"; readonly reason: string };

export async function sayOnChange(ports: SayPorts, intent: CommentIntent): Promise<Said> {
  const read = await ports.untilRead();
  if (read.kind === "failed") return { kind: "refused", reason: read.reason };
  const { requestId, progress } = await ports.submit(intent);
  const refusal = commentRefusal(progress);
  return refusal === null ? { kind: "accepted", requestId } : { kind: "refused", reason: refusal };
}
