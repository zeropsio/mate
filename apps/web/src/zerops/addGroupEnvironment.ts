/**
 * The four writes that turn a new Zerops project into a group environment
 * (guide 5.2), performed in an order that never leaves a half-made one.
 *
 * 1. **The registry** — `mate:gm:{groupId}:{projectId}:stage|production`, as
 *    the person, an org owner or admin: a patch through `updateProjectTags`,
 *    applied to the Gitea project's tags as they are. Without it nothing else
 *    knows the project belongs to the group, so it goes first, and the group's
 *    Gitea org is read off the registry it met.
 * 2. **The broker's grants** — `BASIC_USER` on the new project, added to what
 *    the broker already holds (`brokerGrant.ts`, the same write a Mate's
 *    registration makes). Its token's value is never read or written; only
 *    its grant list and its own org role are round-tripped.
 * 3. **The deploy token** — the environment's own key, `BASIC_USER` on the new
 *    project and nothing else, minted as the person and kept on the broker's
 *    service (`deployToken.ts`, D27). A job deploys with `zcli push` on it, so
 *    it is there before the declaration that starts the first deploy.
 * 4. **`environments.yaml`** — always as a pull request from
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
  parseZeropsRegistry,
  planEnvironmentWrite,
  readGroupEnvironments,
  withGroupEnvironment,
  ZeropsApiError,
  type GiteaClient,
  type GroupEnvironment,
  type GroupEnvironmentTier,
  type ZeropsApiClient,
} from "@t3tools/client-runtime/zerops";
import type { ProjectTagPatch, ProjectTagWrite } from "@t3tools/client-runtime/zerops/data";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

import { grantBrokerProject, type ProjectTagsWrite } from "./brokerGrant";
import { ensureDeployToken } from "./deployToken";

/** The group repo of a group, by its slug (`{slug}/group`). */
export const GROUP_REPOSITORY = "group";

export type AddGroupEnvironmentStep =
  | "registry"
  | "broker-grant"
  | "deploy-token"
  | "environments-document";

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
  readonly writeTags: ProjectTagsWrite;
  readonly gitea: GiteaClient | null;
  readonly clientId: string;
  /** The account's Gitea project — where the registry lives. */
  readonly giteaProjectId: string | undefined;
  readonly groupId: string;
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

  let slug: string | undefined;
  try {
    const written = await writeRegistryMember({
      client: input.client,
      writeTags: input.writeTags,
      giteaProjectId: input.giteaProjectId,
      groupId: input.groupId,
      projectId: input.environment.project,
      member: input.environment.tier,
      signal: input.signal,
    });
    if (written.kind === "refused") return stop("registry", written.refusal.reason);
    slug = parseZeropsRegistry(written.project.tagList).groups.find(
      (group) => group.groupId === input.groupId,
    )?.slug;
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

  // Before the declaration: merging it is what starts the environment's first
  // deploy, and the job that runs it asks the broker for this key (D27).
  const key = await ensureDeployToken({
    client: input.client,
    clientId: input.clientId,
    giteaProjectId: input.giteaProjectId,
    environment: { projectId: input.environment.project, name: input.environment.displayName },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (key.kind !== "held") return stop("deploy-token", key.reason);
  done.push("deploy-token");

  const gitea = input.gitea;
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
    // A production still declared for a project the platform has deleted gives
    // its entry to this one, under its name — `beviro-production` stays
    // `beviro-production` — rather than refusing a second production (Beviro,
    // 2026-09-24).
    const gone =
      input.environment.tier === "production"
        ? await deletedProjects(
            input.client,
            declared.filter((entry) => entry.tier === "production").map((entry) => entry.project),
            input.signal,
          )
        : [];
    const replaced = declared.find(
      (entry) => entry.tier === input.environment.tier && gone.includes(entry.project),
    );
    // Otherwise derived against what the document already declares, so a second
    // stage is `acme-crm-stage-2` rather than a refusal the person cannot act on.
    const environment: GroupEnvironment = {
      name:
        replaced?.name ??
        deriveEnvironmentName(
          input.environment.displayName,
          input.environment.tier,
          declared.map((entry) => entry.name),
        ),
      tier: input.environment.tier,
      project: input.environment.project,
      sources: DEFAULT_STAGE_SOURCES,
      deploy: undefined,
    };
    const write = withGroupEnvironment(document, environment, { gone });
    if (!write.ok) return stop("environments-document", write.reason);

    // An earlier attempt may have got as far as the branch, or the request
    // (a tab closed between the two, 2026-09-17): what is there is reused,
    // never written again — Gitea refuses a branch that exists. Only a branch
    // that already declares this project is that attempt's: Beviro's re-added
    // production met the branch its deleted predecessor's merged declaration
    // left, and reused it would have declared the deleted project again
    // (2026-09-24). Any other is deleted and written afresh.
    const left = await gitea.getBranch(slug, GROUP_REPOSITORY, write.branch).catch(() => undefined);
    const leftover = left?.name === write.branch;
    const reusable =
      leftover &&
      readGroupEnvironments(
        (await gitea.readFile(slug, GROUP_REPOSITORY, ENVIRONMENTS_DOCUMENT_PATH, write.branch))
          ?.content ?? "",
      ).some((entry) => entry.project === input.environment.project);
    if (!reusable) {
      if (leftover) await gitea.deleteBranch(slug, GROUP_REPOSITORY, write.branch);
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
      // The branch this wrote, at the commit it holds now: nobody else writes to it.
      const head = (await gitea.getBranch(slug, GROUP_REPOSITORY, write.branch))?.commit?.id;
      if (head === undefined) throw new Error("Gitea did not say which commit the change holds.");
      await gitea.mergePullRequest(slug, GROUP_REPOSITORY, pull.number, head);
      merged = true;
    }
    done.push("environments-document");
    return { done, failed: undefined, pullRequest: { number: pull.number, merged } };
  } catch (cause) {
    return stop("environments-document", messageOf(cause));
  }
}

/**
 * The registry entry of one project in a group (step 1), as a patch through
 * `writeTags` — the same write a creation's own registry step makes
 * (`zeropsBirths.ts`).
 *
 * A production deleted outside the app keeps its entry, and the one-production
 * rule then refused every production after it: Beviro's, deleted in the Zerops
 * GUI and added again from the app, got no registry entry, no broker grant, no
 * deploy token and no declaration, and the broker refused its deploys
 * `424 no_deploy_token` (2026-09-24). So a refusal that names the production in
 * the way asks the platform about that project, and writes again with it
 * `gone` only when the platform says it is deleted.
 */
export async function writeRegistryMember(input: {
  readonly client: Pick<ZeropsApiClient, "fetchProject">;
  readonly writeTags: ProjectTagsWrite;
  /** The account's Gitea project — where the registry lives. */
  readonly giteaProjectId: string;
  readonly groupId: string;
  readonly projectId: string;
  readonly member: RoleProjectKind;
  readonly signal?: AbortSignal | undefined;
}): Promise<ProjectTagWrite> {
  const patch: ProjectTagPatch = {
    kind: "registry-member",
    groupId: input.groupId,
    projectId: input.projectId,
    member: input.member,
  };
  const written = await input.writeTags(input.giteaProjectId, patch);
  if (written.kind !== "refused" || written.refusal.code !== "production-held") return written;
  const gone = await deletedProjects(input.client, [written.refusal.projectId], input.signal);
  return gone.length === 0 ? written : input.writeTags(input.giteaProjectId, { ...patch, gone });
}

/** How `GET /project/{id}` answers for a project that has been deleted. */
const PROJECT_NOT_FOUND = "projectNotFound";

/**
 * The projects among `projectIds` the platform says are deleted: its answer
 * for one is `400 projectNotFound` (verified 2026-09-20). Only that answer
 * counts — a 403, a 5xx or a request that never landed says nothing about
 * whether the project still runs, and an environment that may still run is
 * never replaced.
 */
async function deletedProjects(
  client: Pick<ZeropsApiClient, "fetchProject">,
  projectIds: ReadonlyArray<string>,
  signal: AbortSignal | undefined,
): Promise<ReadonlyArray<string>> {
  const deleted = await Promise.all(
    projectIds.map((projectId) =>
      client.fetchProject(projectId, signal).then(
        () => false,
        (cause: unknown) => cause instanceof ZeropsApiError && cause.code === PROJECT_NOT_FOUND,
      ),
    ),
  );
  return projectIds.filter((_, index) => deleted[index] === true);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}
