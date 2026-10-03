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
 * With no Gitea token in this tab no group is read, and a read that meets a
 * Gitea 401 no token recovered is not an answer: every group keeps its rows,
 * and the token coming back reads them again.
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
  firstDeployHeadKey,
  firstDeployHeadLadder,
  firstDeployHeadSettled,
  environmentTierForRole,
  GROUP_REPOSITORY,
  missingEnvironmentRows,
  planDeployStatusReads,
  planDeployedVersionReads,
  planFirstDeployHeadReads,
  planMainHeadReads,
  readGroupEnvironments,
  planReleaseReads,
  releaseDeploys,
  RECIPE_TIER_PATHS,
  recipeTierRepositories,
  type GiteaClient,
  type GiteaCommit,
  type GiteaCommitStatus,
  type GiteaPullRequest,
  type FirstDeployHeadRead,
  type GroupEnvironment,
  type GroupEnvironmentRowInput,
  type GroupEnvironmentService,
  type GroupEnvironmentTier,
  type MainHeadStatuses,
  type MissingEnvironmentRow,
  type ZeropsEnvironmentRole,
} from "@t3tools/client-runtime/zerops";
import type { DeployScope, GroupUpdate } from "@t3tools/client-runtime/zerops/flow";
import {
  createForgeReads,
  giteaNotFound,
  giteaUnauthorized,
  type ForgePart,
  type ForgeReadRef,
  type ForgeReads,
  type StatusReadOptions,
} from "@t3tools/client-runtime/zerops/forge";

import type { ZeropsDeployedVersionReader } from "./useZeropsDeployedVersion";
import { pullsKey, useGroupAnswers } from "./useZeropsGroupForge";

/** Where `environments.yaml` lives in the group repo. */
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
    /** When it was made: a stage's first deploy is asked for from then (`firstDeployHeadLadder`). */
    readonly createdAt?: string | undefined;
    /** Its runtime services — the ones that hold code the broker deploys. */
    readonly services: ReadonlyArray<{
      readonly serviceId: string;
      readonly hostname: string;
      /**
       * The active deploy the platform pushed — when it was activated and its
       * name — so a new deploy reads the version again at once rather than
       * showing the previous one until the clock does (DESIGN §4.7).
       */
      readonly activeDeploy?: string | undefined;
      /** The id of that active deploy's version: a version read naming another is stale. */
      readonly activeVersionId?: string | undefined;
    }>;
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
   * The repository whose `main` each production service releases from, by
   * hostname — what a merge in one repository re-reads, and nothing else.
   */
  readonly mainHeadRepositories: ReadonlyMap<string, string>;
  /**
   * `{service hostname: full sha}` each repository's `main` holds — read only
   * for a group with no stage, which releases what is merged (D28). Empty
   * otherwise, where the stage's own deploys are the release's candidate.
   */
  readonly mainHeads: ReadonlyMap<string, string>;
  /** The group repo's `main` head, read with the rest — what a release tag points at. */
  readonly groupHead: string | undefined;
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
  /** Why each group's latest deploy read failed, while it keeps failing. */
  readonly failures: ReadonlyMap<string, string>;
  /** Re-reads one part of one group at once: what a verb changed. */
  readonly invalidate: (groupId: string, scope: DeployScope | "group") => void;
}

/**
 * Serialises what one group's reads depend on, so an unchanged group is read
 * once per tick and a group whose projects moved, or whose services the
 * platform says run something new, is read again on its own.
 */
export function deployGroupKey(group: ZeropsDeployGroup): string {
  return JSON.stringify([
    group.slug,
    group.projects.map((project) => [
      project.projectId,
      project.name,
      project.role ?? "",
      project.services
        .map((service) => [service.serviceId, service.activeDeploy ?? ""])
        .toSorted(([left = ""], [right = ""]) => left.localeCompare(right)),
    ]),
  ]);
}

/** A running commit still takes contexts once its checks pass: production's deploy, say. */
const RUNNING: StatusReadOptions = { live: true };

const STATUSES: ReadonlySet<ForgePart> = new Set(["statuses"]);
const PULLS_AND_CODE: ReadonlySet<ForgePart> = new Set(["pulls", "code"]);
const CODE: ReadonlySet<ForgePart> = new Set(["code"]);

export function useZeropsGroupDeploys(input: {
  readonly groups: ReadonlyArray<ZeropsDeployGroup>;
  readonly giteaOrigin: string | undefined;
  readonly readVersion: ZeropsDeployedVersionReader;
  readonly enabled: boolean;
  /** A Gitea request can go out now (`GiteaSessionView.readable`); a read runs only then. */
  readonly readable: boolean;
  /** What both group passes read through, shared (`useForgeReads`). */
  readonly reads: ForgeReads;
}): ZeropsGroupDeployAnswers {
  const { reads } = input;
  const { answers, failures, invalidate } = useGroupAnswers<
    ZeropsDeployGroup,
    DeployScope,
    ZeropsGroupDeployState
  >({
    pass: "deploys",
    giteaOrigin: input.giteaOrigin,
    enabled: input.enabled,
    readable: input.readable,
    groups: input.groups,
    refreshMs: GROUP_DEPLOYS_REFRESH_MS,
    keyOf: deployGroupKey,
    unauthorizedReads: reads.unauthorized,
    tick: reads.tick,
    read: (client, group, scope, signal, held) =>
      readGroupDeploys({
        client,
        group,
        scope,
        readVersion: input.readVersion,
        held,
        signal,
        reads,
      }),
    // A group read again whole — its deploys moved, or a merge into the group repo — forgets what
    // its deploys were told and what the group repo holds; a merge elsewhere, that repository's
    // `main`.
    forget: (group, scope) => {
      if (scope === "group") {
        reads.forget(group.slug, undefined, STATUSES);
        reads.forget(group.slug, GROUP_REPOSITORY, PULLS_AND_CODE);
      } else reads.forget(group.slug, scope.repository, CODE);
    },
  });
  return { deploys: answers, failures, invalidate };
}

/**
 * One scope of a group's deploy half. A whole read needs the group repo's
 * declarations, open pulls and tiers to answer or it fails; a version read
 * that does not answer keeps the version `held` has for that service. A
 * merge's read takes the one repository's `main` head and what a release
 * would carry from it, and keeps the rest of what is held.
 */
export async function readGroupDeploys(input: {
  readonly client: GiteaClient;
  readonly group: ZeropsDeployGroup;
  readonly scope: DeployScope | "group";
  readonly readVersion: ZeropsDeployedVersionReader;
  readonly held: ZeropsGroupDeployState | undefined;
  readonly signal: AbortSignal;
  /** What was read of the group's repositories, kept while its org's listing stands (`forgeReads.ts`). */
  readonly reads?: ForgeReads | undefined;
}): Promise<GroupUpdate<ZeropsGroupDeployState>> {
  const { group, held, scope, signal } = input;
  const reads = input.reads ?? createForgeReads();
  const kept = keptClient(input.client, reads);
  if (scope !== "group") {
    if (held === undefined) return () => undefined;
    const moved = new Map(
      [...held.mainHeadRepositories].filter(([, repository]) => repository === scope.repository),
    );
    const heads = await readMainHeads(kept, group.slug, moved, signal);
    const running = releaseDeploys(held.environments).production;
    const contents = await readReleaseContents(
      kept,
      group.slug,
      moved,
      planReleaseReads(heads, running),
      signal,
    );
    // A stage waiting for its first deploy from that repository: its new head starts it again.
    const firstHeads = await readFirstDeployHeads(
      kept,
      reads.statuses,
      group,
      heldFirstDeployReads(held, scope.repository),
      held,
      signal,
    );
    return (current) =>
      current === undefined
        ? undefined
        : withFirstDeployHeads(withMainHeads(current, moved, heads, contents), firstHeads);
  }
  // The org's listing first: what it says moved is read again below, and the rest is kept. One
  // that does not answer is no reason for this half to fail, which never needed it: it reads the
  // group repo itself, this once. A 401 is the session's, and ends the read.
  // Read before the listing is asked: its own 404 is recorded as "not made" (`ForgeReads`).
  const made = reads.organizations().get(group.slug) === true;
  const listed = await reads.repositories(group.slug, input.client).then(
    () => "listed" as const,
    (cause: unknown) => {
      if (giteaUnauthorized(cause)) throw cause;
      // The broker has not made the group's org yet: no group repo to read, and nothing failed
      // (`readForge`).
      if (giteaNotFound(cause) && !made) return "not-made" as const;
      return "unlisted" as const;
    },
  );
  if (listed === "not-made") return () => NOTHING_DECLARED;
  const client = listed === "listed" ? kept : input.client;
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
    return () => NOTHING_DECLARED;
  const groupHead = (await client.getBranch(group.slug, GROUP_REPOSITORY, "main"))?.commit?.id;

  const services: ReadonlyArray<GroupEnvironmentService> = group.projects.flatMap((project) =>
    project.services.map((service) => ({
      projectId: project.projectId,
      serviceId: service.serviceId,
      hostname: service.hostname,
      activeVersionId: service.activeVersionId,
    })),
  );
  // What the services run is the account's store's: the organization's versions and variables
  // are streamed, so asking reads nothing (`readDeployedVersion`).
  signal.throwIfAborted();
  const versions = new Map<string, string>();
  const answered = await Promise.all(
    planDeployedVersionReads({ declarations, services }).map(async (read) => ({
      read,
      name: await input
        .readVersion(read.projectId, read.serviceId, signal)
        .catch(() => heldVersion(held, read)),
    })),
  );
  for (const { read, name } of answered) if (name !== undefined) versions.set(read.serviceId, name);

  const memo = reads.statuses;
  const statuses = new Map<string, ReadonlyArray<GiteaCommitStatus>>();
  const statusReads = planDeployStatusReads({
    owner: group.slug,
    versions: services.map((service) => ({
      hostname: service.hostname,
      appVersionName: versions.get(service.serviceId),
      repository: onMain.repositories.get(service.hostname),
    })),
  });
  for (const read of statusReads) {
    signal.throwIfAborted();
    // A refusal is not an answer: the row says nothing about a deploy
    // it could not be told about, rather than calling it neutral.
    const answered = await memo
      .read(read, () => client.listCommitStatuses(read.owner, read.repo, read.sha), RUNNING)
      .catch(() => null);
    if (answered !== null) statuses.set(deployStatusKey(read), answered);
  }

  // A declared stage that runs nothing: the job deploying `main` there may fail before it asks the
  // broker for its grant, and say so only on `main`'s head (run 5).
  const heads = await readFirstDeployHeads(
    client,
    memo,
    group,
    planFirstDeployHeadReads({
      declarations,
      services,
      versions,
      repositories: onMain.repositories,
    }),
    held,
    signal,
  );

  const rowInputs = buildGroupEnvironmentRowInputs({
    owner: group.slug,
    declarations,
    projectNames: new Map(group.projects.map((project) => [project.projectId, project.name])),
    services,
    versions,
    statuses,
    heads,
    // Which repository each service is built from, so a row's version can
    // address the commit it was built from.
    repositories: onMain.repositories,
  });

  // What a release would put live: the head of each production service's
  // repository, whether or not the group has a stage (D28).
  const mainHeadRepositories = new Map(
    planMainHeadReads({ declarations, services, repositories: onMain.repositories }).map(
      (read) => [read.hostname, read.repo] as const,
    ),
  );
  const mainHeads = await readMainHeads(client, group.slug, mainHeadRepositories, signal);
  const running = releaseDeploys(rowInputs).production;
  const releaseContents = await readReleaseContents(
    client,
    group.slug,
    mainHeadRepositories,
    planReleaseReads(mainHeads, running),
    signal,
  );

  const state: ZeropsGroupDeployState = {
    declarations,
    pullRequests,
    missing,
    mainHeadRepositories,
    mainHeads,
    groupHead,
    releaseContents,
    environments: rowInputs,
  };
  return () => state;
}

/**
 * The client this half reads the group's repositories through: what it asks of them is answered
 * from what the reads keep while the org's listing says nothing moved, and asked of Gitea
 * otherwise. Only the asks this half makes are kept; every other one goes to Gitea.
 */
function keptClient(client: GiteaClient, reads: ForgeReads): GiteaClient {
  const kept = <T>(ref: ForgeReadRef, load: () => Promise<T>) =>
    reads.read(ref, load).then((read) => read.value);
  return {
    ...client,
    listDirectory: (owner, repo, path, ref) =>
      kept({ owner, repo, part: "code", key: `contents/${path}?ref=${ref ?? ""}` }, () =>
        client.listDirectory(owner, repo, path, ref),
      ),
    readFile: (owner, repo, path, ref) =>
      kept({ owner, repo, part: "code", key: `raw/${path}?ref=${ref ?? ""}` }, () =>
        client.readFile(owner, repo, path, ref),
      ),
    listPullRequests: (owner, repo, options) =>
      kept({ owner, repo, part: "pulls", key: pullsKey(options) }, () =>
        client.listPullRequests(owner, repo, options),
      ),
    getBranch: (owner, repo, branch) =>
      kept({ owner, repo, part: "code", key: `branches/${branch}` }, () =>
        client.getBranch(owner, repo, branch),
      ),
    commitDetail: (owner, repo, sha) =>
      kept({ owner, repo, part: "code", key: `git/commits/${sha}` }, () =>
        client.commitDetail(owner, repo, sha),
      ),
    compareCommits: (owner, repo, base, head) =>
      kept({ owner, repo, part: "code", key: `compare/${base}...${head}` }, () =>
        client.compareCommits(owner, repo, base, head),
      ),
  };
}

/** A group whose repo declares nothing, has nothing open and offers no tier. */
const NOTHING_DECLARED: ZeropsGroupDeployState = {
  declarations: [],
  pullRequests: [],
  missing: [],
  mainHeadRepositories: new Map(),
  mainHeads: new Map(),
  groupHead: undefined,
  releaseContents: [],
  environments: [],
};

/** Each named service's `main` head, by hostname; one that does not answer is left out. */
async function readMainHeads(
  client: GiteaClient,
  slug: string,
  repositories: ReadonlyMap<string, string>,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  const heads = new Map<string, string>();
  for (const [hostname, repository] of repositories) {
    signal.throwIfAborted();
    const branch = await client.getBranch(slug, repository, "main").catch(() => null);
    const sha = branch?.commit?.id;
    if (sha !== undefined && sha !== "") heads.set(hostname, sha);
  }
  return heads;
}

/**
 * What each production service is not running yet. Read against the deployed
 * commit, not against the newest tag: a release that was never deployed is
 * still ahead of the service, and the person is being told what pressing the
 * verb would put there.
 */
async function readReleaseContents(
  client: GiteaClient,
  slug: string,
  repositories: ReadonlyMap<string, string>,
  reads: ReturnType<typeof planReleaseReads>,
  signal: AbortSignal,
): Promise<ReadonlyArray<ReleaseContent>> {
  const contents: Array<ReleaseContent> = [];
  for (const read of reads) {
    signal.throwIfAborted();
    const repo = repositories.get(read.service) ?? read.service;
    // No base is a first release: the head is the whole of what would go
    // live, so it is named rather than skipped.
    const commits =
      read.from === undefined
        ? await client
            .commitDetail(slug, repo, read.head)
            .then((detail): ReadonlyArray<GiteaCommit> =>
              detail === undefined ? [] : [{ sha: detail.sha, subject: detail.subject }],
            )
            .catch((): ReadonlyArray<GiteaCommit> => [])
        : await client
            .compareCommits(slug, repo, read.from, read.head)
            .catch((): ReadonlyArray<GiteaCommit> => []);
    if (commits.length > 0) contents.push({ service: read.service, commits });
  }
  return contents;
}

/**
 * The held answer with the moved services' `main` heads and release contents
 * replaced; a head that did not answer keeps what it had.
 */
function withMainHeads(
  held: ZeropsGroupDeployState,
  moved: ReadonlyMap<string, string>,
  heads: ReadonlyMap<string, string>,
  contents: ReadonlyArray<ReleaseContent>,
): ZeropsGroupDeployState {
  const mainHeads = new Map(held.mainHeads);
  for (const [hostname, sha] of heads) mainHeads.set(hostname, sha);
  const fresh = (hostname: string) => moved.has(hostname) && heads.has(hostname);
  const releaseContents = [...mainHeads.keys()].flatMap((hostname) =>
    (fresh(hostname) ? contents : held.releaseContents).filter(
      (content) => content.service === hostname,
    ),
  );
  return { ...held, mainHeads, releaseContents };
}

/**
 * Each first-deploy head read (`planFirstDeployHeadReads`): the repository's `main` head — kept
 * while the org's listing says nothing was pushed — and its statuses, read again until they settle
 * (`firstDeployHeadSettled`) on `firstDeployHeadLadder`: a read a minute within the coming-up
 * window of the stage's making, the head first seen, or a job moving there, one every five minutes
 * until the broker's patience runs out, then none until a push makes a new head. A stage that runs a
 * deploy, or a group with none declared, costs nothing. A read that does not answer keeps the
 * head the group last read.
 */
async function readFirstDeployHeads(
  client: GiteaClient,
  memo: ForgeReads["statuses"],
  group: ZeropsDeployGroup,
  planned: ReadonlyArray<FirstDeployHeadRead>,
  held: ZeropsGroupDeployState | undefined,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, MainHeadStatuses>> {
  const heads = new Map<string, MainHeadStatuses>();
  for (const read of planned) {
    signal.throwIfAborted();
    const askedAt = group.projects.find(
      (project) => project.projectId === read.projectId,
    )?.createdAt;
    const head = await readFirstDeployHead(
      client,
      memo,
      group.slug,
      read,
      heldHead(held, read),
      askedAt,
    );
    if (head !== undefined) heads.set(firstDeployHeadKey(read), head);
  }
  return heads;
}

/** One head and its statuses; a read that does not answer keeps the head held before. */
async function readFirstDeployHead(
  client: GiteaClient,
  memo: ForgeReads["statuses"],
  slug: string,
  read: FirstDeployHeadRead,
  held: MainHeadStatuses | undefined,
  askedAt: string | undefined,
): Promise<MainHeadStatuses | undefined> {
  try {
    const sha = (await client.getBranch(slug, read.repo, "main"))?.commit?.id;
    if (sha === undefined || sha === "") return held;
    const nowMs = Date.now();
    const waiting = firstDeployHeadLadder(held, read, sha, askedAt, nowMs);
    // Past the broker's patience on the same head: what was read stands until a push.
    if (waiting === undefined) return held;
    const statuses = await memo.read(
      { owner: slug, repo: read.repo, sha },
      () => client.listCommitStatuses(slug, read.repo, sha),
      { settled: (answered) => firstDeployHeadSettled(read, answered), waiting },
    );
    // When main was first seen at this commit: a head nobody posted to yet still waits.
    const firstSeenAtMs = held?.sha === sha ? (held.firstSeenAtMs ?? nowMs) : nowMs;
    return { sha, statuses, firstSeenAtMs };
  } catch {
    return held;
  }
}

/** The first-deploy head reads a group held from one repository: what a merge into it re-reads. */
function heldFirstDeployReads(
  held: ZeropsGroupDeployState,
  repository: string,
): ReadonlyArray<FirstDeployHeadRead> {
  return held.environments.flatMap((environment) =>
    environment.services.flatMap((service) =>
      service.head === undefined || service.repository !== repository
        ? []
        : [
            {
              projectId: environment.projectId,
              environment: environment.environment,
              hostname: service.hostname,
              repo: repository,
            },
          ],
    ),
  );
}

/** The held answer with the re-read first-deploy heads in place. */
function withFirstDeployHeads(
  held: ZeropsGroupDeployState,
  heads: ReadonlyMap<string, MainHeadStatuses>,
): ZeropsGroupDeployState {
  if (heads.size === 0) return held;
  return {
    ...held,
    environments: held.environments.map((environment) => ({
      ...environment,
      services: environment.services.map((service) => {
        const head = heads.get(
          firstDeployHeadKey({ projectId: environment.projectId, hostname: service.hostname }),
        );
        return head === undefined ? service : { ...service, head };
      }),
    })),
  };
}

/** The head a stage's service was last read with. */
function heldHead(
  held: ZeropsGroupDeployState | undefined,
  read: FirstDeployHeadRead,
): MainHeadStatuses | undefined {
  return held?.environments
    .find((environment) => environment.projectId === read.projectId)
    ?.services.find((service) => service.hostname === read.hostname)?.head;
}

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
      for (const [hostname, repository] of recipeTierRepositories(file.content)) {
        const name = repositoryName(repository);
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
  // The root's listing first: a group with no `environments.yaml` — most of them — answers it
  // without the 404 a read of the missing file printed in red on every load.
  const root = await client.listDirectory(slug, GROUP_REPOSITORY, "", "main");
  if (root?.includes(ENVIRONMENTS_PATH) !== true) return [];
  const file = await client.readFile(slug, GROUP_REPOSITORY, ENVIRONMENTS_PATH, "main");
  return file === undefined ? [] : readGroupEnvironments(file.content);
}
