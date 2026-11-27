/**
 * A member's take-over: what HQ answers an Owner or Admin before a member is removed (mate-hq
 * `spec/protocol.md`, _Take-over_), shared by HQ and the clients. Zerops refuses a member's removal
 * while an integration token they minted exists; HQ deletes one it no longer uses, and replaces one
 * in use by starting the operation that owns its replacement, on the caller's token.
 *
 * - `POST /api/members/:userId/take-over` (`HqTakeOverList`): the tokens the member minted that HQ
 *   holds, or that sit on a Mate's or an environment's project, and the count of the rest.
 * - `POST /api/members/:userId/take-over/:tokenId` `{ accessToken, id, expiresAt, ownerUserId? }`:
 *   `204` once a token not in use is deleted, `202` (`HqTakeOverStarted`) for one in use.
 */
import { Schema } from "effect";

export const HqTakeOverItem = Schema.Struct({
  tokenId: Schema.String,
  /** A Mate's key, or an environment's deploy token. */
  kind: Schema.Literals(["mate-key", "deploy-token"]),
  projectId: Schema.String,
  /** The Mate's or the environment's name. */
  label: Schema.String,
  /** HQ holds it: a replace starts the operation that replaces it; otherwise a replace only deletes it. */
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

/**
 * The operation a replace of a token in use started, as the request's `id`: the Mate's hand-over
 * for its key, the environment's deploy key for a deploy token. It runs on without the request and
 * shows on its Mate's project or its application in navigation.
 */
export const HqTakeOverStarted = Schema.Struct({
  operationId: Schema.String,
  kind: Schema.Literals(["mate_handover", "deploy_key"]),
});
export type HqTakeOverStarted = typeof HqTakeOverStarted.Type;
