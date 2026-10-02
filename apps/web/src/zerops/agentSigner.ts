/**
 * Who signed an agent in, as the conversation tells it (D6).
 *
 * The record is the Mate server's own: the person whose door session started the sign-in it saw
 * succeed — `authorizedBy` on an agent row, `signedInBy` on a login row. The server keeps it
 * before anything else hears of the success, so the feed names that person in the same publish
 * that says the sign-in succeeded. Nothing in the client writes one.
 *
 * @module agentSigner
 */
import type { ZeropsAgentLoginPhase } from "@t3tools/contracts";

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
