/**
 * Whose agent identity is signed into this environment.
 *
 * ## Why this exists
 *
 * An agent CLI's credential is a personal one. Anthropic's consumer terms let
 * you use your subscription on your own machines and nobody else's — two of
 * your own containers is like two of your own computers; a colleague using
 * your login, or a service that other people can reach standing on it, is not.
 *
 * A Zerops project, though, has members. Anyone who can reach the container
 * can take a turn, and the turn spends whoever's identity happens to be signed
 * in. Nothing in the product said whose that was, so this does: an environment
 * you did not authorize tells you so before you spend someone else's
 * subscription on it.
 *
 * ## Absent is not an accusation
 *
 * The recorded authorizer only exists for logins that went through mate's own
 * server-driven flow. A credential can predate the field, be copied in by
 * hand, or come from a container image. So a missing record is `"unrecorded"`
 * — never "someone else's". The distinction matters: one of those is a fact,
 * the other is a guess about a colleague.
 *
 * The environment stays usable in every case. This is a disclosure, not a
 * gate: mate has no standing to decide whose subscription may run where, and
 * blocking a turn would break the legitimate two-containers-one-person case
 * that the terms explicitly allow.
 *
 * @module agentOwnership
 */

/**
 * The recorded authorizer, as it arrives on `ZeropsAgentAuth.authorizedBy`.
 * Structural so this module needs no contracts import.
 */
export interface ZeropsAgentAuthorizer {
  /** The Zerops user id the door put on the session that drove the login. */
  readonly subject: string;
  readonly at: string | Date;
}

export type ZeropsAgentOwnership =
  /** No credential — there is no identity to own. */
  | "none"
  /** The signed-in user authorized this agent here. */
  | "mine"
  /** Someone else did, and we know it. */
  | "someone-else"
  /** A credential exists but no authorizer was recorded. */
  | "unrecorded";

export interface ZeropsAgentOwnershipInput {
  /** Whether a credential artifact exists at all (`ZeropsAgentAuth.credPresent`). */
  readonly credPresent: boolean;
  readonly authorizedBy?: ZeropsAgentAuthorizer | undefined;
  /** The signed-in Zerops user's id, or `undefined` when nobody is signed in. */
  readonly viewerSubject: string | undefined;
}

export function resolveAgentOwnership(input: ZeropsAgentOwnershipInput): ZeropsAgentOwnership {
  if (!input.credPresent) return "none";

  const recorded = input.authorizedBy?.subject;
  if (recorded === undefined || recorded.length === 0) return "unrecorded";

  // A viewer we cannot identify is not evidence that the agent belongs to
  // someone else — say nothing rather than the wrong thing.
  if (input.viewerSubject === undefined || input.viewerSubject.length === 0) return "unrecorded";

  return recorded === input.viewerSubject ? "mine" : "someone-else";
}

/**
 * The one line the UI shows, or `undefined` when there is nothing worth
 * saying. `"mine"` is deliberately silent: telling someone their own agent is
 * theirs is noise on every screen, forever.
 */
export function agentOwnershipNotice(ownership: ZeropsAgentOwnership): string | undefined {
  switch (ownership) {
    case "someone-else":
      return "This agent was signed in by another project member. Turns you take here spend their subscription.";
    case "unrecorded":
      return "This agent's sign-in was not recorded by Zerops Mate, so it may not be yours.";
    case "mine":
    case "none":
      return undefined;
  }
}

/** Whether the notice deserves attention rather than a quiet aside. */
export function agentOwnershipNeedsAttention(ownership: ZeropsAgentOwnership): boolean {
  return ownership === "someone-else";
}
