/**
 * Giving the broker's Zerops token one more project, and registering a Mate.
 *
 * The broker's own Zerops token (`docs/vocabulary.md`, "the broker's token"):
 * org `READ_ONLY`, `BASIC_USER` on the Gitea project, and `BASIC_USER` on
 * every stage, production and Mate as the app makes them. It reads and decides
 * with it; since D27 a job deploys, on the environment's own deploy token
 * (`deployToken.ts`).
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
  type ZeropsApiClient,
  type ZeropsIntegrationToken,
} from "@t3tools/client-runtime/zerops";
import type { ProjectTagPatch, ProjectTagWrite } from "@t3tools/client-runtime/zerops/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { runZeropsCommand, type ZeropsDataContextValue } from "./zeropsDataContext";

/**
 * `updateProjectTags` on one organization's projects (DESIGN §2.B B2): the registry writes here
 * are patches the TagWriter applies to the Gitea project's tags as they are, never a list
 * computed from a registry read earlier.
 */
export type ProjectTagsWrite = (
  projectId: string,
  patch: ProjectTagPatch,
) => Promise<ProjectTagWrite>;

export function projectTagsWrite(
  data: Pick<ZeropsDataContextValue, "runtime" | "projectRef">,
  organizationId: string,
): ProjectTagsWrite {
  return (projectId, patch) =>
    runZeropsCommand(
      data.runtime.commands.updateProjectTags(data.projectRef(organizationId, projectId), patch),
    );
}

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
>;

/** `BASIC_USER` on one project, added to what the broker already holds. */
export async function grantBrokerProject(input: {
  readonly client: BrokerGrantClient;
  readonly clientId: string;
  readonly projectId: string;
  readonly signal?: AbortSignal | undefined;
}): Promise<BrokerGrantOutcome> {
  try {
    const tokens: ReadonlyArray<ZeropsIntegrationToken> = await input.client.listIntegrationTokens(
      input.clientId,
      input.signal,
    );
    const plan = planBrokerProjectGrant(tokens, input.projectId);
    switch (plan.kind) {
      case "no-broker":
        return { kind: "no-broker", reason: plan.reason };
      case "refused":
        return { kind: "failed", reason: plan.reason };
      case "held":
        return { kind: "granted" };
      case "write":
        await input.client.setIntegrationTokenProjects(
          {
            clientId: input.clientId,
            tokenId: plan.broker.id,
            name: plan.broker.name,
            projects: plan.projects,
            ...(plan.broker.roleCode === undefined ? {} : { roleCode: plan.broker.roleCode }),
          },
          input.signal,
        );
        return { kind: "granted" };
    }
  } catch (cause) {
    return { kind: "failed", reason: zeropsErrorMessage(cause) };
  }
}

export type MateRegistrationOutcome =
  /** The registry entry could not be written; the Mate still waits for an owner. */
  | { readonly kind: "registry-failed"; readonly reason: string }
  /** The Mate is registered; what came of the broker's grant is beside it. */
  | { readonly kind: "registered"; readonly grant: BrokerGrantOutcome };

/**
 * Registers a Mate: its `mate:gm:{group}:{project}:mate` entry, then the
 * broker's grant on its project (guide 4.2, D20).
 *
 * The registry goes first because it is what the broker's rights loop reads;
 * a grant on a project the loop never looks at would be a grant to nothing.
 * A grant that fails is not a failed registration: the entry is there, the
 * loop reports the Mate it cannot reach, and the next registration attempt
 * gives the broker the project again.
 */
export async function registerMateProject(input: {
  readonly client: BrokerGrantClient;
  readonly writeTags: ProjectTagsWrite;
  readonly clientId: string;
  /** The account's Gitea project, where the registry lives. */
  readonly giteaProjectId: string;
  readonly groupId: string;
  /** The Mate's project. */
  readonly projectId: string;
  readonly signal?: AbortSignal | undefined;
}): Promise<MateRegistrationOutcome> {
  try {
    const written = await input.writeTags(input.giteaProjectId, {
      kind: "registry-member",
      groupId: input.groupId,
      projectId: input.projectId,
      member: "mate",
    });
    if (written.kind === "refused") {
      return { kind: "registry-failed", reason: written.refusal.reason };
    }
  } catch (cause) {
    return { kind: "registry-failed", reason: zeropsErrorMessage(cause) };
  }
  return {
    kind: "registered",
    grant: await grantBrokerProject({
      client: input.client,
      clientId: input.clientId,
      projectId: input.projectId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  };
}

/**
 * Registers a Mate in its group and says what is outstanding, if anything: the
 * card's *Register in {group}* for a member's Mate (guide 4.2). A Mate's birth
 * makes the same two writes as its `tags` and `registry` steps
 * (`zeropsBirths.ts`).
 *
 * `null` once the entry is written and the broker reaches the project, or when
 * the account has no broker to reach it with; the words to show otherwise. A
 * grant that failed leaves the Mate registered, and registering again retries
 * the grant.
 */
export async function registerMateInGroup(input: {
  readonly client: BrokerGrantClient;
  readonly writeTags: ProjectTagsWrite;
  readonly clientId: string;
  /** The account's Gitea project, where the registry lives. */
  readonly giteaProjectId: string;
  readonly groupId: string;
  /** The Mate's project. */
  readonly projectId: string;
}): Promise<string | null> {
  const outcome = await registerMateProject({
    client: input.client,
    writeTags: input.writeTags,
    clientId: input.clientId,
    giteaProjectId: input.giteaProjectId,
    groupId: input.groupId,
    projectId: input.projectId,
  });
  if (outcome.kind === "registry-failed") return outcome.reason;
  return outcome.grant.kind === "failed" ? outcome.grant.reason : null;
}
