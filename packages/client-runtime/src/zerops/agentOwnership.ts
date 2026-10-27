import type { ZeropsAgentLoginPhase } from "@t3tools/contracts";
/**
 * Whose agent identity is signed into this environment — and, since D6,
 * who may run it.
 *
 * ## Why this exists
 *
 * An agent CLI's credential is a personal one. The vendors' consumer terms let
 * you use your subscription on your own machines and nobody else's — two of
 * your own containers is like two of your own computers; a colleague using
 * your login, or a service that other people can reach standing on it, is not.
 *
 * A Zerops project, though, has members. Anyone who can open the Mate can take
 * a turn, and the turn spends whoever's identity happens to be signed in.
 *
 * ## It is a gate now, not a disclosure
 *
 * This module used to say so and let the turn through, on the grounds that
 * mate had no standing to decide whose subscription may run where. D6 closed
 * that on 2026-09-09: **only the person who signed an agent in operates it**,
 * and the server enforces it — `orchestration.dispatchCommand` refuses a
 * turn-starting command on an OAuth-authorized agent whose recorded signer is
 * not the session's subject. The record is the Mate server's own: the person
 * whose session started the sign-in it saw succeed, carried on the feed as
 * `authorizedBy`.
 *
 * What this module decides is what the person is *told*; the server decides
 * what runs, and the two read the same field.
 *
 * ## Absent is not an accusation, and is still refused
 *
 * A credential can predate the record, be copied in by hand, or come from a
 * container image. So a missing record is `"unrecorded"` — never "someone
 * else's": one of those is a fact, the other is a guess about a colleague.
 * The wording keeps that distinction; the gate does not, because D6 keeps no
 * backward compatibility — an unrecorded login runs for nobody until somebody
 * signs in through Mate.
 *
 * A **token**-authorized agent is untouched by all of this: an API key
 * belongs to the project, not to a person.
 *
 * @module agentOwnership
 */
import {
  agentIdForDriverKind,
  agentIdForProviderInstance,
  type ZeropsAgentId,
} from "@t3tools/contracts";

/** The recorded authorizer, as it arrives on `ZeropsAgentAuth.authorizedBy`. */
export interface ZeropsAgentAuthorizer {
  /** The Zerops user id the door put on the session that drove the login. */
  readonly subject: string;
  /** When, if anything recorded it: the fact the product needs is whose login it is. */
  readonly at?: string | Date | undefined;
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

/**
 * The agent a provider instance spends, among the two Mate signs people in
 * to — by the instance's driver, so a second instance of a driver is the same
 * agent. The server's gate resolves it the same way; an id no configured
 * instance carries resolves by its own spelling.
 */
export function resolveOwnedAgentId(
  instanceId: string | undefined,
  providers: ReadonlyArray<{ readonly instanceId: string; readonly driver: string }>,
): ZeropsAgentId | undefined {
  if (instanceId === undefined) return undefined;
  const driver = providers.find((provider) => provider.instanceId === instanceId)?.driver;
  return agentIdForDriverKind(driver) ?? agentIdForProviderInstance(instanceId);
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
 * saying. `"mine"` states it quietly rather than staying silent — a row that
 * carries account actions (switch, sign out) needs to say whose login those
 * actions would touch. `"none"` has no credential to talk about at all.
 */
export function agentOwnershipNotice(ownership: ZeropsAgentOwnership): string | undefined {
  switch (ownership) {
    case "someone-else":
      return "Signed in by another project member — only they can run this agent.";
    case "unrecorded":
      return "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it.";
    case "mine":
      return "Signed in by you.";
    case "none":
      return undefined;
  }
}

/** Whether the notice deserves attention rather than a quiet aside. */
export function agentOwnershipNeedsAttention(ownership: ZeropsAgentOwnership): boolean {
  return ownership === "someone-else";
}

/**
 * Whether this viewer may start a turn on this agent (D6) — the same answer
 * the server reaches, so a composer that is open never meets a refusal and one
 * that is closed never hides a turn that would have worked.
 */
export function agentOwnershipAllowsTurns(ownership: ZeropsAgentOwnership): boolean {
  return ownership === "mine" || ownership === "none";
}

/**
 * The line that replaces the composer for everyone but the signer, and the
 * one thing they can do about it.
 *
 * Names the signer when the account can be read for a name. Without one it
 * says the same thing without pretending to know who — a wrong name would be
 * worse than none.
 */
export function agentOwnershipComposerNotice(
  ownership: ZeropsAgentOwnership,
  signerName?: string | undefined,
): string | undefined {
  const name = signerName?.trim() ?? "";
  switch (ownership) {
    case "someone-else":
      return name.length === 0
        ? "Signed in by another project member — only they can run this agent."
        : `Signed in by ${name} — only they can run this agent.`;
    case "unrecorded":
      return "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it.";
    case "mine":
    case "none":
      return undefined;
  }
}

/** The login a signer comes from, as a snapshot row carries it. */
export interface AgentSignerFacts {
  readonly authorizedBy?: { readonly subject: string } | undefined;
  readonly login?:
    | {
        readonly phase: ZeropsAgentLoginPhase;
        readonly startedBy?: string | undefined;
      }
    | undefined;
}

/**
 * A login that has ended vouches for nobody by itself: a failed or cancelled one has no
 * credential, and a succeeded one is the server's record to name.
 */
const LOGIN_ENDED: ReadonlySet<ZeropsAgentLoginPhase> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

/**
 * Who signed this agent in, for ownership: the server's record, else the viewer's own login
 * while it is still under way — the viewer is the one person who knows what the record will say,
 * so the moments before it lands never read as a sign-in nobody recorded — else nobody.
 */
export function resolveAgentAuthorizer(
  agent: AgentSignerFacts,
  viewer: string | undefined,
): { readonly subject: string } | undefined {
  if (agent.authorizedBy !== undefined) return { subject: agent.authorizedBy.subject };
  const login = agent.login;
  if (
    viewer !== undefined &&
    viewer.length > 0 &&
    login !== undefined &&
    login.startedBy === viewer &&
    !LOGIN_ENDED.has(login.phase)
  ) {
    return { subject: viewer };
  }
  return undefined;
}
