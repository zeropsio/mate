/**
 * The three writes that turn a new Zerops project into a group environment
 * (guide 5.2), performed in an order that never leaves a half-made one.
 *
 * 1. **The registry** — `mate:gm:{groupId}:{projectId}:stage|production`, as
 *    the person, an org owner or admin. Without it nothing else knows the
 *    project belongs to the group, so it goes first.
 * 2. **The broker's grants** — `BASIC_USER` on the new project, added to what
 *    the broker already holds (`brokerGrant.ts`, the same write a Mate's
 *    registration makes). Its token's value is never read or written; only
 *    its grant list and its own org role are round-tripped.
 * 3. **`environments.yaml`** — always as a pull request from
 *    `mate-app/env-{name}`, because `main` takes no direct push from anybody;
 *    merged in the same breath only when Gitea says this person may merge it.
 *
 * Each step reports what happened rather than throwing: an environment whose
 * grant write failed is an environment the broker cannot deploy **yet**, and an
 * environment whose pull request is open is waiting for a person — neither is a
 * reason to unmake a project that exists and runs. The caller shows what is
 * outstanding, and the next attempt picks it up.
 *
 * The decisions are `client-runtime/zerops/groupEnvironments.ts`; this performs
 * them.
 */

import {
  DEFAULT_STAGE_SOURCES,
  deriveEnvironmentName,
  ENVIRONMENTS_DOCUMENT_PATH,
  environmentCommitMessage,
  planEnvironmentWrite,
  planGroupMembership,
  readGroupEnvironments,
  withGroupEnvironment,
  type GiteaClient,
  type GroupEnvironment,
  type GroupEnvironmentTier,
  type ZeropsApiClient,
  type ZeropsRegistry,
} from "@t3tools/client-runtime/zerops";

import { grantBrokerProject } from "./brokerGrant";

/** The group repo of a group, by its slug (`{slug}/group`). */
export const GROUP_REPOSITORY = "group";

export type AddGroupEnvironmentStep = "registry" | "broker-grant" | "environments-document";

export interface AddGroupEnvironmentOutcome {
  /** The steps that went through, in order. */
  readonly done: ReadonlyArray<AddGroupEnvironmentStep>;
  /** The first thing that did not, and what it said. */
  readonly failed: { readonly step: AddGroupEnvironmentStep; readonly reason: string } | undefined;
  /**
   * The pull request the environments document went in as, when one was
   * opened, and whether the app merged it. An unmerged one is waiting for
   * somebody in the group's `release` team.
   */
  readonly pullRequest: { readonly number: number; readonly merged: boolean } | undefined;
}

export async function addGroupEnvironment(input: {
  readonly client: ZeropsApiClient;
  readonly gitea: GiteaClient | null;
  readonly clientId: string;
  /** The account's Gitea project — where the registry lives. */
  readonly giteaProjectId: string | undefined;
  readonly registry: ZeropsRegistry;
  readonly groupId: string;
  /** The group's Gitea org. */
  readonly slug: string | undefined;
  readonly environment: {
    /** What the person called the project; the document name is derived. */
    readonly displayName: string;
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
    pullRequest: undefined,
  });

  if (input.giteaProjectId === undefined) {
    return stop("registry", "Your account's Gitea is still being set up.");
  }

  const membership = planGroupMembership({
    registry: input.registry,
    groupId: input.groupId,
    projectId: input.environment.project,
    kind: input.environment.tier,
  });
  if (!membership.ok) return stop("registry", membership.reason);
  try {
    await input.client.writeGroupRegistry(
      { giteaProjectId: input.giteaProjectId, tagList: membership.tagList },
      input.signal,
    );
    done.push("registry");
  } catch (cause) {
    return stop("registry", messageOf(cause));
  }

  // A stage the broker cannot reach is a stage it cannot deploy, so an
  // account with no broker stops here — unlike a Mate, which is registered
  // either way (`brokerGrant.ts`).
  const grant = await grantBrokerProject({
    client: input.client,
    clientId: input.clientId,
    projectId: input.environment.project,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (grant.kind !== "granted") return stop("broker-grant", grant.reason);
  done.push("broker-grant");

  const gitea = input.gitea;
  const slug = input.slug;
  if (gitea === null || slug === undefined) {
    return stop(
      "environments-document",
      "Sign in to Gitea to declare this environment on the project's repository.",
    );
  }

  try {
    const current = await gitea.readFile(
      slug,
      GROUP_REPOSITORY,
      ENVIRONMENTS_DOCUMENT_PATH,
      "main",
    );
    const document = current?.content ?? "";
    const declared = readGroupEnvironments(document);
    // The same write run twice — a retried creation, or the projects page
    // finishing one a reload cut short (2026-09-17) — declares nothing twice.
    if (declared.some((entry) => entry.project === input.environment.project)) {
      done.push("environments-document");
      return { done, failed: undefined, pullRequest: undefined };
    }
    // Derived against what the document already declares, so a second stage is
    // `acme-crm-stage-2` rather than a refusal the person cannot act on.
    const environment: GroupEnvironment = {
      name: deriveEnvironmentName(
        input.environment.displayName,
        input.environment.tier,
        declared.map((entry) => entry.name),
      ),
      tier: input.environment.tier,
      project: input.environment.project,
      sources: DEFAULT_STAGE_SOURCES,
      deploy: undefined,
    };
    const write = withGroupEnvironment(document, environment);
    if (!write.ok) return stop("environments-document", write.reason);

    // An earlier attempt may have got as far as the branch, or the request
    // (a tab closed between the two, 2026-09-17): what is there is reused,
    // never written again — Gitea refuses a branch that exists.
    const left = await gitea.getBranch(slug, GROUP_REPOSITORY, write.branch).catch(() => undefined);
    if (left?.name !== write.branch) {
      await gitea.changeFiles(slug, GROUP_REPOSITORY, {
        message: environmentCommitMessage(environment),
        branch: "main",
        newBranch: write.branch,
        files: [
          current === undefined
            ? { operation: "create", path: ENVIRONMENTS_DOCUMENT_PATH, content: write.yaml }
            : {
                operation: "update",
                path: ENVIRONMENTS_DOCUMENT_PATH,
                content: write.yaml,
                sha: current.sha,
              },
        ],
      });
    }

    const main = await gitea.getBranch(slug, GROUP_REPOSITORY, "main");
    const plan = planEnvironmentWrite({
      name: environment.name,
      userCanMerge: main?.user_can_merge,
    });
    const open = await gitea.listPullRequests(slug, GROUP_REPOSITORY, { state: "open" }).catch(
      (): ReadonlyArray<{
        readonly number: number;
        readonly head?: { readonly ref?: string } | undefined;
      }> => [],
    );
    const pull =
      open.find((entry) => entry.head?.ref === plan.branch) ??
      (await gitea.createPullRequest(slug, GROUP_REPOSITORY, {
        head: plan.branch,
        base: "main",
        title: environmentCommitMessage(environment),
      }));
    let merged = false;
    if (plan.merge) {
      await gitea.mergePullRequest(slug, GROUP_REPOSITORY, pull.number);
      merged = true;
    }
    done.push("environments-document");
    return { done, failed: undefined, pullRequest: { number: pull.number, merged } };
  } catch (cause) {
    return stop("environments-document", messageOf(cause));
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}
