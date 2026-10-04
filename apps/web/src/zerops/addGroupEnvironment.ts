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
 *    else, minted by the person's client and handed to HQ (`deployToken.ts`), which deploys with
 *    it. Minted only where HQ holds none that works, so asking again mints nothing twice.
 *
 * There is no pull request and no broker: HQ holds the environment, and deploys it.
 *
 * Each step reports what happened rather than throwing: an environment whose key did not go
 * through is an environment HQ cannot deploy **yet** — no reason to unmake a project that exists
 * and runs. The caller shows what is outstanding, and the next attempt picks it up.
 */

import { environmentKeyed, type GroupEnvironmentTier } from "@t3tools/client-runtime/zerops";
import { attachToApp, environmentsOf, type HqApi } from "@t3tools/client-runtime/zerops/hq";

import { keepDeployToken, type DeployTokenClient } from "./deployToken";

export type AddGroupEnvironmentStep = "registry" | "deploy-token";

export interface AddGroupEnvironmentOutcome {
  /** The steps that went through, in order. */
  readonly done: ReadonlyArray<AddGroupEnvironmentStep>;
  /** The first thing that did not, and what it said. */
  readonly failed: { readonly step: AddGroupEnvironmentStep; readonly reason: string } | undefined;
}

/** What the deploy key step says where HQ holds the attached project as no environment. */
const NOT_RECORDED = "HQ holds this project as no environment yet.";

export async function addGroupEnvironment(input: {
  readonly client: DeployTokenClient;
  /** The organization's HQ, where the registry and the key live. */
  readonly hq: Pick<HqApi, "attachProject" | "structure" | "keepDeployToken">;
  readonly clientId: string;
  readonly groupId: string;
  readonly environment: {
    readonly tier: GroupEnvironmentTier;
    /** The Zerops project just created. */
    readonly project: string;
  };
  readonly signal?: AbortSignal | undefined;
}): Promise<AddGroupEnvironmentOutcome> {
  const done: Array<AddGroupEnvironmentStep> = [];
  const stop = (step: AddGroupEnvironmentStep, reason: string): AddGroupEnvironmentOutcome => ({
    done,
    failed: { step, reason },
  });

  try {
    // Created for HQ to deploy: HQ turns its services' subdomains on at their first deploy.
    await attachToApp(input.hq, input.groupId, {
      projectId: input.environment.project,
      kind: input.environment.tier,
      created: true,
    });
    done.push("registry");
  } catch (cause) {
    return stop("registry", messageOf(cause));
  }

  // The environment as HQ recorded it with the attach: its name is HQ's to give.
  let recorded;
  try {
    const { apps } = await input.hq.structure(input.signal);
    recorded = environmentsOf(apps.find((app) => app.id === input.groupId)?.environments)?.find(
      (environment) => environment.projectId === input.environment.project,
    );
  } catch (cause) {
    return stop("deploy-token", messageOf(cause));
  }
  if (recorded === undefined) return stop("deploy-token", NOT_RECORDED);
  if (!environmentKeyed(recorded)) {
    const key = await keepDeployToken({
      client: input.client,
      hq: input.hq,
      clientId: input.clientId,
      appId: input.groupId,
      environment: { projectId: recorded.projectId, name: recorded.name },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (key.kind !== "held") return stop("deploy-token", key.reason);
  }
  done.push("deploy-token");
  return { done, failed: undefined };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}
