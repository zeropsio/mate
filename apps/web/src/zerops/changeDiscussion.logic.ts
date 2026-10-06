/**
 * Saying something on a change, as the account's `change-comment` operation: sent only once HQ's
 * conversation has been read — what the change already holds is then known, so a lost answer adopts
 * only words that came after the press — and said as soon as HQ took it. What HQ did not take is
 * told under the box in the words today's HQ answers use.
 */
import type { DiscussionGate, OperationProgress, Operations } from "@t3tools/client-runtime/data";
import { HQ_WRITE_UNCERTAIN } from "@t3tools/client-runtime/zerops/hq";

const NOT_ANSWERING = "HQ is not answering right now.";

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
  /** The conversation's gate once settled: read, or why no send will go — also once let go. */
  readonly untilRead: (signal: AbortSignal) => Promise<DiscussionGate>;
  readonly submit: (
    intent: CommentIntent,
  ) => Promise<{ readonly requestId: string; readonly progress: OperationProgress }>;
}

export type Said =
  | { readonly kind: "accepted"; readonly requestId: string }
  /** Its answer lost: HQ's conversation may still show it, which then ends it (`landedAfterLoss`). */
  | { readonly kind: "uncertain"; readonly requestId: string; readonly reason: string }
  | { readonly kind: "refused"; readonly reason: string };

export async function sayOnChange(
  ports: SayPorts,
  intent: CommentIntent,
  signal: AbortSignal,
): Promise<Said> {
  const read = await ports.untilRead(signal);
  if (read.kind === "failed") return { kind: "refused", reason: read.reason };
  if (signal.aborted) return { kind: "refused", reason: NOT_ANSWERING };
  const { requestId, progress } = await ports.submit(intent);
  const refusal = commentRefusal(progress);
  if (refusal === null) return { kind: "accepted", requestId };
  return progress.stage === "uncertain"
    ? { kind: "uncertain", requestId, reason: refusal }
    : { kind: "refused", reason: refusal };
}

/** Whether a comment whose answer was lost turned out to be HQ's: its conversation shows it. */
export function landedAfterLoss(progress: OperationProgress): boolean {
  return progress.stage === "done" || progress.stage === "reflected";
}

/**
 * The sends of this tab: one per change, person and words, so a second press of the same words —
 * also in a review closed and opened again — joins the first. A send still waiting for its
 * conversation is let go with its review, organization or account (`cancel` by scope).
 */
export function makeCommentSends() {
  const sends = new Map<
    string,
    { readonly said: Promise<Said>; readonly scope: string; readonly abort: AbortController }
  >();
  return {
    say: (key: string, scope: string, run: (signal: AbortSignal) => Promise<Said>) => {
      const held = sends.get(key);
      if (held !== undefined) return held.said;
      const abort = new AbortController();
      const said = run(abort.signal).finally(() => {
        sends.delete(key);
      });
      sends.set(key, { said, scope, abort });
      return said;
    },
    /** Lets go of every send of a scope still waiting; one already sent stands. */
    cancel: (scope: string) => {
      for (const send of sends.values()) if (send.scope === scope) send.abort.abort();
    },
  };
}
