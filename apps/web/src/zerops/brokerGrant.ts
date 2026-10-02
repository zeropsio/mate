/**
 * Giving the broker's Zerops token one more project, in an organization that still has one.
 *
 * The broker's own Zerops token (`docs/vocabulary.md`, "the broker's token"):
 * org `BASIC_USER`, which reaches every project of the org, so a new stage,
 * production or Mate needs no write here. Only an older broker token, org
 * `READ_ONLY`, still gets `BASIC_USER` on each such project as the app makes
 * it. It reads and decides with it; since D27 a job deploys, on the
 * environment's own deploy token (`deployToken.ts`).
 * A Mate needs it because the broker's rights loop, not the app, delivers a
 * Mate's Gitea access — it finds the Mate's `zcp` service with that token and
 * writes the three variables on it (D20, `broker-api.md`, "A Mate's Gitea
 * access"). A Mate the token does not reach is one the loop reports and
 * retries every pass, so the grant is the app's half of the bargain.
 *
 * The decision is `client-runtime/zerops/groupEnvironments.ts`
 * (`planBrokerProjectGrant`); this reads the token list and performs the one
 * write, and answers what happened rather than throwing. The token's value is
 * never read or written; only its grant list and its own org role go round.
 */

import {
  planBrokerProjectGrant,
  writeTokenProjectsFresh,
  type TokenWriteHold,
  type ZeropsApiClient,
} from "@t3tools/client-runtime/zerops";
import { ZeropsOrganizationId, type OrganizationRef } from "@t3tools/client-runtime/zerops/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { tokenWrites } from "./tokenWriteLock";
import { integrationTokensFromGrantMetadata } from "./useZeropsGroupReach";
import { runZeropsCommand, type ZeropsDataContextValue } from "./zeropsDataContext";

export type BrokerGrantOutcome =
  /** The broker reaches the project — written now, or held already. */
  | { readonly kind: "granted" }
  /** An account minted before it had a Gitea has no broker to give it to. */
  | { readonly kind: "no-broker"; readonly reason: string }
  /** The read or the write did not go through; the next attempt asks again. */
  | { readonly kind: "failed"; readonly reason: string };

export type BrokerGrantClient = Pick<
  ZeropsApiClient,
  "listIntegrationTokens" | "setIntegrationTokenProjects"
> & {
  /** Holds one token's read-then-write at a time, across this browser's tabs. */
  readonly hold?: TokenWriteHold;
};

/**
 * The broker grant's token list and its one write, through the account's runtime. The write
 * replaces the broker token's whole project list, so the list it is planned from is read live,
 * right before it — never the shared `tokens:{org}` cell, which serves display and decisions
 * and may be older than a Mate registered meanwhile. The write makes every reader of that cell
 * read it again.
 */
export function brokerGrantTokens(
  runtime: ZeropsDataContextValue["runtime"],
  /** This page's token locks; a test gives each of its tabs its own. */
  hold: TokenWriteHold = tokenWrites,
): BrokerGrantClient {
  const organization = (clientId: string): OrganizationRef => ({
    kind: "organization",
    account: runtime.scope.account,
    organizationId: ZeropsOrganizationId.make(clientId),
  });
  return {
    listIntegrationTokens: async (clientId, signal) =>
      integrationTokensFromGrantMetadata(
        await runZeropsCommand(
          runtime.commands.listIntegrationTokenGrants(organization(clientId)),
          signal,
        ),
      ),
    setIntegrationTokenProjects: async ({ clientId, ...input }, signal) => {
      await runZeropsCommand(
        runtime.commands.setIntegrationTokenProjects({
          organization: organization(clientId),
          ...input,
        }),
        signal,
      );
    },
    hold,
  };
}

/**
 * The broker reaching one project: nothing to write for an org `BASIC_USER`
 * token; `BASIC_USER` on the project, added to what an older org `READ_ONLY`
 * token already holds.
 */
export async function grantBrokerProject(input: {
  readonly client: BrokerGrantClient;
  readonly clientId: string;
  readonly projectId: string;
  readonly signal?: AbortSignal | undefined;
}): Promise<BrokerGrantOutcome> {
  try {
    input.signal?.throwIfAborted();
    let outcome: BrokerGrantOutcome = { kind: "granted" };
    // The write replaces the broker's whole project list: it is planned from the list read under
    // the broker token's lock, so a grant made meanwhile, here or in another tab, is kept. The
    // last plan is the one made under the lock; what it says is what is reported.
    let owed = false;
    const written = await writeTokenProjectsFresh({
      read: () => input.client.listIntegrationTokens(input.clientId, input.signal),
      plan: (tokens) => {
        const plan = planBrokerProjectGrant(tokens, input.projectId);
        owed = plan.kind === "write";
        switch (plan.kind) {
          case "no-broker":
            outcome = { kind: "no-broker", reason: plan.reason };
            return [];
          case "refused":
            outcome = { kind: "failed", reason: plan.reason };
            return [];
          case "held":
            outcome = { kind: "granted" };
            return [];
          case "write":
            outcome = { kind: "granted" };
            return [
              {
                tokenId: plan.broker.id,
                name: plan.broker.name,
                projects: plan.projects,
                // The broker's own org role, as read under the lock: the write keeps it.
                ...(plan.broker.roleCode === undefined ? {} : { roleCode: plan.broker.roleCode }),
              },
            ];
        }
      },
      write: (write) =>
        input.client.setIntegrationTokenProjects(
          { clientId: input.clientId, ...write },
          input.signal,
        ),
      ...(input.client.hold === undefined ? {} : { hold: input.client.hold }),
    });
    // Still owed and nothing written: the broker's token changed between the reads.
    if (owed && written === 0)
      return {
        kind: "failed",
        reason: "The broker's token changed while it was being granted. Try again.",
      };
    return outcome;
  } catch (cause) {
    return { kind: "failed", reason: zeropsErrorMessage(cause) };
  }
}
