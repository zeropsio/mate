/**
 * A person's chat account link (mate-hq `spec/protocol.md`, S21a and S21b), shared by HQ and the
 * clients. HQ says a one-time link `<Mate web>/chat-link#<code>` to a Slack or Discord account
 * (`@Mate link`, `/mate link`, or an unlinked account's first ask); the person who opens it, signed in
 * to the organisation the account's connection belongs to, takes it. Only an account linked so may ask.
 *
 * - `POST /api/chat-links` `{ code }` (`HqChatLink`): links the account the code was said to, to the
 *   person. A code taken, expired, never said or of another organisation is `404 link_not_found`.
 */
import { Schema } from "effect";

export const HqChatLink = Schema.Struct({
  provider: Schema.Literals(["slack", "discord"]),
  linkedAt: Schema.String,
});
export type HqChatLink = typeof HqChatLink.Type;

/** HQ's reason for a code it holds no open link of in the organisation. */
export const CHAT_LINK_NOT_FOUND = "link_not_found";
