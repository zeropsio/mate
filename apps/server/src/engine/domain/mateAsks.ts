/**
 * The messages a conversation sent other Mates of the person's that no answer met yet: read off
 * its own record as `evolve` folds it, so its row says whom it waits on with no read of its items.
 * A `zerops_message_mate` call that closed with a sent result adds one; the answer to it (a person
 * item whose `mateMessage.inReplyTo` names it) takes it away. Pure.
 *
 * @module engine/domain/mateAsks
 */
import { type ItemBody, mateMessageNamesOf } from "@t3tools/contracts";

/** The tool a Mate messages another of its person's Mates with (zcp's). */
const MATE_MESSAGE_TOOL = "zerops_message_mate";
/** How many unanswered messages a conversation keeps: the newest. */
const KEPT_AWAITS = 8;

/** A message the conversation sent another Mate, by HQ's id, and the Mate it waits on. */
export interface AwaitedAnswer {
  readonly id: string;
  readonly projectId: string;
  /** The Mate's own name, HQ's cut at its project's (`mateMessageNamesOf`). */
  readonly mateName: string;
}

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

/** The message a closed `zerops_message_mate` call sent; none for any other call or a refusal. */
export const sentMessageOf = (body: ItemBody): AwaitedAnswer | undefined => {
  if (body.kind !== "call" || body.state !== "done" || body.result === undefined) return undefined;
  const { toolName, resultText } = body.result;
  if (toolName.replace(/^mcp__[^_]+(?:_[^_]+)*?__/u, "") !== MATE_MESSAGE_TOOL) return undefined;
  if (resultText === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return undefined;
  }
  const message = (
    parsed as { readonly message?: { readonly id?: unknown; readonly to?: unknown } }
  )?.message;
  const to = message?.to as
    | { readonly projectId?: unknown; readonly projectName?: unknown; readonly mateName?: unknown }
    | undefined;
  const id = textOf(message?.id);
  if (id === "" || to === undefined) return undefined;
  const names = mateMessageNamesOf({
    mateName: textOf(to.mateName),
    projectName: textOf(to.projectName),
  });
  return {
    id,
    projectId: textOf(to.projectId),
    mateName: names.mate || names.project || "another Mate",
  };
};

/** The awaited answers once `body` was said: a sent message added, an answer's ask taken away. */
export const awaitsAfter = (
  awaits: ReadonlyArray<AwaitedAnswer>,
  body: ItemBody,
): ReadonlyArray<AwaitedAnswer> => {
  if (body.kind === "person") {
    const reply = body.mateMessage?.kind === "answer" ? body.mateMessage.inReplyTo : undefined;
    return reply === undefined || !awaits.some((awaited) => awaited.id === reply)
      ? awaits
      : awaits.filter((awaited) => awaited.id !== reply);
  }
  const sent = sentMessageOf(body);
  if (sent === undefined) return awaits;
  return [...awaits.filter((awaited) => awaited.id !== sent.id), sent].slice(-KEPT_AWAITS);
};
