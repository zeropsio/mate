/**
 * What every group's environments are running, for the projects screen.
 *
 * Three reads, in the one order they can happen in (`groupDeploys.ts`): the
 * group repo's `environments.yaml` says which environments there are, Zerops
 * says which commit each service of them is running, and Gitea says how that
 * deploy went. The middle one produces the commit the last one needs, so they
 * cannot be issued together.
 *
 * ## What a missing answer does: nothing
 *
 * Each group is read on its own and published the moment it completes
 * (`flow/groupAnswers.ts`). A group repo that does not answer fails the
 * group's read, and the group keeps the rows it already had; a version read
 * that does not answer keeps the version that service was last read with.
 * Whether anything runs at all is the platform's pushed answer
 * (`flow/deployment.ts`), not this read's. A row's height never depends on
 * which of the three landed (`environmentRow`), so the page does not move
 * under somebody arriving.
 *
 * The platform read is the caller's to perform: the one-shot resource lease
 * lives on the screen that owns the account scope, and handing it in keeps
 * this module out of the page's import cycle.
 */

import {
  buildGroupEnvironmentRowInputs,
  deployStatusKey,
  environmentTierForRole,
  missingEnvironmentRows,
  planDeployStatusReads,
  planDeployedVersionReads,
  planMainHeadReads,
  readGroupEnvironments,
  planReleaseReads,
  releaseDeploys,
  RECIPE_TIER_PATHS,
  type GiteaClient,
  type GiteaCommit,
  type GiteaCommitStatus,
  type GiteaPullRequest,
  type GroupEnvironment,
  type GroupEnvironmentRowInput,
  type GroupEnvironmentService,
  importReadyTier,
  type GroupEnvironmentTier,
  type MissingEnvironmentRow,
  type ZeropsEnvironmentRole,
} from "@t3tools/client-runtime/zerops";
import type { GroupUpdate } from "@t3tools/client-runtime/zerops/flow";
import { useCallback } from "react";

import type { ZeropsDeployedVersionReader } from "./useZeropsDeployedVersion";
import { useGroupAnswers } from "./useZeropsGroupForge";

/** Where `environments.yaml` lives, and what the group repo is called. */
const GROUP_REPOSITORY = "group";
const ENVIRONMENTS_PATH = "environments.yaml";
/**
 * How often the group repo is read again while the screen is open. The
 * recipe lands on `main` minutes after the Mate is up, by the broker's hand
 * and not the account's, so nothing in the inventory says it did; the rows
 * that ask for a stage and a production follow it on this clock.
 */
export const GROUP_DEPLOYS_REFRESH_MS = 60_000;

/** One group, as this hook needs to see it. */
export interface ZeropsDeployGroup {
  readonly groupId: string;
  /** Its Gitea org, from the registry. */
  readonly slug: string;
  /** Every Zerops project of the group the account can see. */
  readonly projects: ReadonlyArray<{
    readonly projectId: string;
    readonly name: string;
    /** Its role tag, which says which tier it fills before any declaration does. */
    readonly role?: ZeropsEnvironmentRole | undefined;
    /** Its runtime services — the ones that hold code the broker deploys. */
    readonly services: ReadonlyArray<{ readonly serviceId: string; readonly hostname: string }>;
  }>;
}

/** What the group repo answers about one group. */
export interface ZeropsGroupDeployState {
  /** `environments.yaml` as read — what each environment follows. */
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  readonly environments: ReadonlyArray<GroupEnvironmentRowInput>;
  /** The recipe changes waiting on somebody — the group repo's open pulls. */
  readonly pullRequests: ReadonlyArray<GiteaPullRequest>;
  /** The tiers the recipe offers and the group has not added — the rows that ask. */
  readonly missing: ReadonlyArray<MissingEnvironmentRow>;
  /**
   * `{service hostname: full sha}` each repository's `main` holds — read only
   * for a group with no stage, which releases what is merged (D28). Empty
   * otherwise, where the stage's own deploys are the release's candidate.
   */
  readonly mainHeads: ReadonlyMap<string, string>;
  /**
   * What a release would carry: per production service, the commits `main` has
   * that the service is not running. With squash merges each one is a task
   * delivered, under the words the person asked for (the owner, 2026-09-18:
   * "it would be great if you could show like what is it going to release").
   */
  readonly releaseContents: ReadonlyArray<ReleaseContent>;
}

/** One service's share of what a release would carry. */
export interface ReleaseContent {
  readonly service: string;
  readonly commits: ReadonlyArray<GiteaCommit>;
}

export type ZeropsGroupDeploys = ReadonlyMap<string, ZeropsGroupDeployState>;

export interface ZeropsGroupDeployAnswers {
  readonly deploys: ZeropsGroupDeploys;
  /** Re-reads one group at once: what a verb changed. */
  readonly invalidate: (groupId: string) => void;
}

/**
 * Serialises what one group's reads depend on, so an unchanged group is read
 * once per tick and a group whose projects moved is read again on its own.
 */
export function deployGroupKey(group: ZeropsDeployGroup): string {
  return JSON.stringify([
    group.slug,
    group.projects.map((project) => [
      project.projectId,
      project.name,
      project.role ?? "",
      project.services.map((service) => service.serviceId).toSorted(),
    ]),
  ]);
}

export function useZeropsGroupDeploys(input: {
  readonly groups: ReadonlyArray<ZeropsDeployGroup>;
  readonly giteaOrigin: string | undefined;
  readonly readVersion: ZeropsDeployedVersionReader;
  readonly enabled: boolean;
}): ZeropsGroupDeployAnswers {
  const { answers, invalidate } = useGroupAnswers<ZeropsDeployGroup, never, ZeropsGroupDeployState>(
    {
      pass: "deploys",
      giteaOrigin: input.giteaOrigin,
      enabled: input.enabled,
      groups: input.groups,
      refreshMs: GROUP_DEPLOYS_REFRESH_MS,
      keyOf: deployGroupKey,
      read: (client, group, _scope, signal, held) =>
        readGroupDeploys({ client, group, readVersion: input.readVersion, held, signal }),
    },
  );
  const invalidateGroup = useCallback(
    (groupId: string) => {
      invalidate(groupId, "group");
    },
    [invalidate],
  );
  return { deploys: answers, invalidate: invalidateGroup };
}

/**
 * One group's deploy half. The group repo's declarations, open pulls and
 * tiers must answer or the read fails; a version read that does not answer
 * keeps the version `held` has for that service.
 */
export async function readGroupDeploys(input: {
  readonly client: GiteaClient;
  readonly group: ZeropsDeployGroup;
  readonly readVersion: ZeropsDeployedVersionReader;
  readonly held: ZeropsGroupDeployState | undefined;
  readonly signal: AbortSignal;
}): Promise<GroupUpdate<ZeropsGroupDeployState>> {
  const { client, group, held, signal } = input;
  const declarations = await readDeclarations(client, group.slug);
  const pullRequests = await client.listPullRequests(group.slug, GROUP_REPOSITORY, {
    state: "open",
  });
  const onMain = await readTiersOnMain(client, group.slug);
  const tiersOnMain = onMain.tiers;
  // A tier the account already holds a project for is not missing, even
  // while its declaration is still on its way to the group repo.
  const filledTiers = group.projects.flatMap((project) => {
    const tier = environmentTierForRole(project.role);
    return tier === undefined ? [] : [tier];
  });
  const missing = missingEnvironmentRows({ tiersOnMain, declarations, filledTiers });
  if (declarations.length === 0 && pullRequests.length === 0 && missing.length === 0)
    return (previous) => (previous === undefined ? undefined : NOTHING_DECLARED);

  const services: ReadonlyArray<GroupEnvironmentService> = group.projects.flatMap((project) =>
    project.services.map((service) => ({
      projectId: project.projectId,
      serviceId: service.serviceId,
      hostname: service.hostname,
    })),
  );
  const versions = new Map<string, string>();
  for (const read of planDeployedVersionReads({ declarations, services })) {
    signal.throwIfAborted();
    const name = await input
      .readVersion(read.projectId, read.serviceId, signal)
      .catch(() => heldVersion(held, read));
    if (name !== undefined) versions.set(read.serviceId, name);
  }

  const statuses = new Map<string, ReadonlyArray<GiteaCommitStatus>>();
  const reads = planDeployStatusReads({
    owner: group.slug,
    versions: services.map((service) => ({
      hostname: service.hostname,
      appVersionName: versions.get(service.serviceId),
      repository: onMain.repositories.get(service.hostname),
    })),
  });
  for (const read of reads) {
    signal.throwIfAborted();
    // A refusal is not an answer: the row says nothing about a deploy
    // it could not be told about, rather than calling it neutral.
    const answered = await client
      .listCommitStatuses(read.owner, read.repo, read.sha)
      .catch(() => null);
    if (answered !== null) statuses.set(deployStatusKey(read), answered);
  }

  const rowInputs = buildGroupEnvironmentRowInputs({
    owner: group.slug,
    declarations,
    projectNames: new Map(group.projects.map((project) => [project.projectId, project.name])),
    services,
    versions,
    statuses,
    // Which repository each service is built from, so a row's version can
    // address the commit it was built from.
    repositories: onMain.repositories,
  });

  // What a release would put live: the head of each production service's
  // repository, whether or not the group has a stage (D28).
  const mainHeads = new Map<string, string>();
  for (const read of planMainHeadReads({
    declarations,
    services,
    repositories: onMain.repositories,
  })) {
    signal.throwIfAborted();
    const branch = await client.getBranch(group.slug, read.repo, "main").catch(() => null);
    const sha = branch?.commit?.id;
    if (sha !== undefined && sha !== "") mainHeads.set(read.hostname, sha);
  }

  // What each production service is not running yet. Read against the
  // deployed commit, not against the newest tag: a release that was
  // never deployed is still ahead of the service, and the person is
  // being told what pressing the verb would put there.
  const running = releaseDeploys(rowInputs).production;
  const releaseContents: Array<ReleaseContent> = [];
  for (const read of planReleaseReads(mainHeads, running)) {
    signal.throwIfAborted();
    const repo = onMain.repositories.get(read.service) ?? read.service;
    // No base is a first release: the head is the whole of what would
    // go live, so it is named rather than skipped.
    const commits =
      read.from === undefined
        ? await client
            .commitDetail(group.slug, repo, read.head)
            .then((detail): ReadonlyArray<GiteaCommit> =>
              detail === undefined ? [] : [{ sha: detail.sha, subject: detail.subject }],
            )
            .catch((): ReadonlyArray<GiteaCommit> => [])
        : await client
            .compareCommits(group.slug, repo, read.from, read.head)
            .catch((): ReadonlyArray<GiteaCommit> => []);
    if (commits.length > 0) releaseContents.push({ service: read.service, commits });
  }

  const state: ZeropsGroupDeployState = {
    declarations,
    pullRequests,
    missing,
    mainHeads,
    releaseContents,
    environments: rowInputs,
  };
  return () => state;
}

/** A group whose repo declares nothing, has nothing open and offers no tier. */
const NOTHING_DECLARED: ZeropsGroupDeployState = {
  declarations: [],
  pullRequests: [],
  missing: [],
  mainHeads: new Map(),
  releaseContents: [],
  environments: [],
};

/** The version a service was last read with, by its project and hostname. */
function heldVersion(
  held: ZeropsGroupDeployState | undefined,
  read: GroupEnvironmentService,
): string | undefined {
  return held?.environments
    .find((environment) => environment.projectId === read.projectId)
    ?.services.find((service) => service.hostname === read.hostname)?.appVersionName;
}

/** What the group repo's `main` says: the tiers on it, and each hostname's repository. */
interface TiersOnMain {
  /** The tiers whose import is on `main` — what a person can add. */
  readonly tiers: ReadonlyArray<GroupEnvironmentTier>;
  /**
   * The repository each runtime builds from, by hostname, from the tiers'
   * `buildFromGit` — where a deploy's commit statuses are (`groupDeploys.ts`).
   */
  readonly repositories: ReadonlyMap<string, string>;
}

async function readTiersOnMain(client: GiteaClient, slug: string): Promise<TiersOnMain> {
  const tiers: ReadonlyArray<GroupEnvironmentTier> = ["stage", "production"];
  const repositories = new Map<string, string>();
  const present = await Promise.all(
    tiers.map(async (tier) => {
      const file = await client.readFile(slug, GROUP_REPOSITORY, RECIPE_TIER_PATHS[tier], "main");
      if (file === undefined) return [];
      for (const [hostname, source] of Object.entries(
        importReadyTier(file.content)?.sources ?? {},
      )) {
        const name = repositoryName(source.repository);
        if (name !== undefined) repositories.set(hostname, name);
      }
      return [tier];
    }),
  );
  return { tiers: present.flat(), repositories };
}

/** `appdev` from `https://web-…/todo/appdev` or `…/appdev.git`. */
function repositoryName(cloneUrl: string): string | undefined {
  const last = cloneUrl.replace(/\/+$/u, "").split("/").at(-1);
  if (last === undefined || last.length === 0) return undefined;
  return last.endsWith(".git") ? last.slice(0, -".git".length) : last;
}

async function readDeclarations(
  client: GiteaClient,
  slug: string,
): Promise<ReadonlyArray<GroupEnvironment>> {
  const file = await client.readFile(slug, GROUP_REPOSITORY, ENVIRONMENTS_PATH, "main");
  return file === undefined ? [] : readGroupEnvironments(file.content);
}
