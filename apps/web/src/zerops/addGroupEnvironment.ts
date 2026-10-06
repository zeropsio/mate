/**
 * The two writes that turn a new Zerops project into an environment of its application (guide
 * 5.2, SPEC §3.2b, main D14), in an order that never leaves a half-made one.
 *
 * 1. **The registry** — the project attached to its application in the organization's HQ as its
 *    stage or production, as the person (`POST /api/apps/{id}/projects`). HQ records the
 *    environment with it: its name — taken over from a production Zerops deleted, else derived from
 *    the project's name — its sources and its place in the order. HQ keeps one production per
 *    application, and lets a production deleted in Zerops go.
 * 2. **The deploy key** — the environment's own token, `BASIC_USER` on the new project and nothing
 *    else, minted by the person's client and handed to HQ (the `keep-deploy-key` operation), which
 *    deploys with it. Minted only where HQ's navigation records none that works, so asking again
 *    mints nothing twice. The environment's name is read there too, never from HQ's whole
 *    structure read again.
 *
 * There is no pull request and no broker: HQ holds the environment, and deploys it.
 *
 * Each step reports what happened rather than throwing: an environment whose key did not go
 * through is an environment HQ cannot deploy **yet** — no reason to unmake a project that exists
 * and runs. The caller shows what is outstanding, and the next attempt picks it up.
 */

import type { GroupEnvironmentTier } from "@t3tools/client-runtime/zerops";
import type { HqEndpoint } from "@t3tools/client-runtime/zerops/hq";

import { HQ_UNFOLLOWED, type AccountOperations } from "./accountOperations";

export type AddGroupEnvironmentStep = "registry" | "deploy-token";

export interface AddGroupEnvironmentOutcome {
  /** The steps that went through, in order. */
  readonly done: ReadonlyArray<AddGroupEnvironmentStep>;
  /** The first thing that did not, and what it said. */
  readonly failed: { readonly step: AddGroupEnvironmentStep; readonly reason: string } | undefined;
}

export async function addGroupEnvironment(input: {
  /** The account's operations, and HQ's navigation as the account observes it. */
  readonly operations: Pick<AccountOperations, "run" | "untilEnvironment">;
  readonly orgId: string;
  /** The organization's HQ, where the registry and the key live. */
  readonly hq: HqEndpoint;
  readonly groupId: string;
  readonly environment: {
    readonly tier: GroupEnvironmentTier;
    /** The Zerops project just created. */
    readonly project: string;
  };
}): Promise<AddGroupEnvironmentOutcome> {
  const { operations, orgId, hq, groupId } = input;
  const projectId = input.environment.project;
  const done: Array<AddGroupEnvironmentStep> = [];
  const stop = (step: AddGroupEnvironmentStep, reason: string): AddGroupEnvironmentOutcome => ({
    done,
    failed: { step, reason },
  });
  const unobserved = { orgId, unobserved: HQ_UNFOLLOWED };

  try {
    // Created for HQ to deploy: HQ turns its services' subdomains on at their first deploy.
    await operations.run(
      {
        kind: "attach-project",
        orgId,
        hq,
        appId: groupId,
        attach: { projectId, kind: input.environment.tier, created: true },
      },
      unobserved,
    );
    done.push("registry");
  } catch (cause) {
    return stop("registry", messageOf(cause));
  }

  try {
    // The environment as HQ's navigation records it with the attach: its name is HQ's to give.
    const recorded = await operations.untilEnvironment(orgId, groupId, projectId);
    if (!recorded.keyed)
      await operations.run(
        {
          kind: "keep-deploy-key",
          orgId,
          hq,
          appId: groupId,
          projectId,
          environmentName: recorded.name,
        },
        unobserved,
      );
  } catch (cause) {
    return stop("deploy-token", messageOf(cause));
  }
  done.push("deploy-token");
  return { done, failed: undefined };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}
