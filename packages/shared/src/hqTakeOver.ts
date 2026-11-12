/**
 * A member's take-over: what HQ answers an Owner or Admin before a member is removed (mate-hq
 * `spec/protocol.md`, _Take-over_), shared by HQ and the clients. Zerops refuses a member's removal
 * while an integration token they minted exists; HQ replaces each one it holds with one the caller
 * mints and deletes the old.
 *
 * - `GET /api/members/:userId/take-over` (`HqTakeOverList`): the tokens the member minted that HQ
 *   holds, or that sit on a Mate's or an environment's project, and the count of the rest.
 * - `POST /api/members/:userId/take-over/:tokenId` `{ accessToken, ownerUserId? }`
 *   (`HqTakeOverReplaced`): replaces one, with the caller's access token for that one call.
 */
import { Schema } from "effect";

export const HqTakeOverItem = Schema.Struct({
  tokenId: Schema.String,
  /** A Mate's key, or an environment's deploy token. */
  kind: Schema.Literals(["mate-key", "deploy-token"]),
  projectId: Schema.String,
  /** The Mate's or the environment's name. */
  label: Schema.String,
  /** HQ holds it: a replace mints its successor; otherwise a replace only deletes it. */
  inUse: Schema.Boolean,
  /** A Mate's owner, whom its key goes to unless the caller picks another. */
  ownerUserId: Schema.optionalKey(Schema.String),
});
export type HqTakeOverItem = typeof HqTakeOverItem.Type;

export const HqTakeOverList = Schema.Struct({
  items: Schema.Array(HqTakeOverItem),
  /** The member's other integration tokens: each keeps Zerops refusing the removal. */
  otherTokens: Schema.Number,
});
export type HqTakeOverList = typeof HqTakeOverList.Type;

export const HqTakeOverReplaced = Schema.Struct({
  replaced: Schema.Boolean,
  oldDeleted: Schema.Boolean,
  /** Zerops' code where it refused the old token's delete. */
  reason: Schema.optionalKey(Schema.String),
});
export type HqTakeOverReplaced = typeof HqTakeOverReplaced.Type;
