/**
 * Whether a Mate's empty conversation is its sign-in: while no coding agent is signed in, the Mate
 * sign-in every empty conversation offers (`ZeropsMateEmptyState`) stands in place of its question
 * and the composer — nothing typed there could be acted on. A Mate nobody has signed in yet has no
 * conversation, so opening it lands on a draft: the draft is its sign-in too. A conversation under
 * way keeps its own notice.
 */
export function mateShowsSignIn(input: {
  /** A Mate lives where the conversation is. */
  readonly mate: boolean;
  /** It is automated: the organization's key runs it, and nobody ever signs it in. */
  readonly automated?: boolean | undefined;
  /** No agent is signed in (`zeropsAgentSignInRequired`). */
  readonly signInRequired: boolean;
  /** Something is said in it already. */
  readonly said: boolean;
}): boolean {
  return input.mate && input.automated !== true && input.signInRequired && !input.said;
}
