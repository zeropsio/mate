/**
 * A message the Mate sent another Mate of its person (`zerops_message_mate`), as its call's result
 * says it: one text block holding `{ message: { id, chainId, hop, to, delivery }, note }`, the way
 * the proposal tools hand theirs. A refusal is an error result in plain words and reads as none:
 * its call is an ordinary failed call.
 *
 * @module zerops/model/mateMessage
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The tool a Mate messages another of its person's Mates with. */
export const MATE_MESSAGE_TOOL = "zerops_message_mate";

const SentDocument = Schema.Struct({
  message: Schema.Struct({
    id: Schema.String.check(Schema.isMinLength(1)),
    to: Schema.Struct({
      projectId: Schema.String,
      projectName: Schema.String,
      mateName: Schema.String,
    }),
    delivery: Schema.String,
  }),
});

const decodeSent = Schema.decodeUnknownOption(SentDocument);

/** A message the Mate sent: HQ's id for it and the Mate it went to, as HQ named them. */
export interface MateMessageSent {
  readonly id: string;
  readonly to: {
    readonly projectId: string;
    readonly projectName: string;
    readonly mateName: string;
  };
  /** When the asked Mate gets it: `now`, `on-wake`, `on-sign-in`, `on-update`. */
  readonly delivery: string;
}

/** The message a `zerops_message_mate` result says was sent; none for any other result. */
export function readMateMessageSent(
  toolName: string | undefined,
  resultText: string | undefined,
): MateMessageSent | undefined {
  if (toolName?.replace(/^mcp__[^_]+__/u, "") !== MATE_MESSAGE_TOOL || resultText === undefined)
    return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(Option.map(decodeSent(parsed), (document) => document.message));
}

/** The Mate a message went to, by its name: its project's where HQ holds none. */
export const sentToName = (sent: MateMessageSent): string =>
  sent.to.mateName.trim() || sent.to.projectName.trim() || "another Mate";

/** The call's line: "Asked Fen (Acme Docs)". */
export function mateMessageAskedLine(sent: MateMessageSent): string {
  const name = sentToName(sent);
  const project = sent.to.projectName.trim();
  return project === "" || project === name ? `Asked ${name}` : `Asked ${name} (${project})`;
}

/** The line at a conversation's end while an answer is awaited: "Waiting for Fen's answer". */
export function mateAnswerWaitLine(names: ReadonlyArray<string>): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return `Waiting for ${unique[0] ?? "another Mate"}'s answer`;
  return `Waiting for answers from ${unique.slice(0, -1).join(", ")} and ${unique.at(-1)!}`;
}
