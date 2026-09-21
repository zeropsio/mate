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
 * Not signed in to Gitea in this tab, or the broker has not made the group's
 * repositories yet, and the group simply keeps the rows it already had — the
 * environments are still read from the account, they just carry no commit and
 * no deploy word. A row's height never depends on which of the three landed
 * (`environmentRow`), so the page does not move under somebody arriving.
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
import { useEffect, useRef, useState } from "react";

import { giteaClientFor } from "./giteaSession";

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

const EMPTY: ZeropsGroupDeploys = new Map();

/**
 * Serialises what the reads depend on, so an unchanged account is read once.
 *
 * `generation` is bumped once by every verb the person runs. Without it the
 * deploy state moved on the 60s clock alone, so a merge emptied the
 * pull-request row at once — the forge hook is told — while the line beside
 * it went on saying what was waiting to go live before the merge, for up to a
 * minute. A verb is a discrete bump, not a moving input, so this stays one
 * read per change rather than the 700 a minute that keying on the groups cost.
 */
export function readGroupDeploysKey(
  groups: ReadonlyArray<ZeropsDeployGroup>,
  giteaOrigin: string | undefined,
  generation: number,
): string {
  return JSON.stringify([
    giteaOrigin ?? "",
    generation,
    groups.map((group) => [
      group.slug,
      group.projects.map((project) => [
        project.projectId,
        project.role ?? "",
        project.services.map((service) => service.serviceId).toSorted(),
      ]),
    ]),
  ]);
}

export function useZeropsGroupDeploys(input: {
  readonly groups: ReadonlyArray<ZeropsDeployGroup>;
  readonly giteaOrigin: string | undefined;
  /** Reads one service's deployed version name, through the account's runtime. */
  readonly readVersion: (
    projectId: string,
    serviceId: string,
    signal: AbortSignal,
  ) => Promise<string | undefined>;
  readonly enabled: boolean;
  /** Bumped once per verb the person ran, so the flow is re-read when it settles. */
  readonly generation?: number | undefined;
}): ZeropsGroupDeploys {
  const { enabled, giteaOrigin, groups, readVersion } = input;
  const generation = input.generation ?? 0;
  const key =
    enabled && giteaOrigin !== undefined
      ? readGroupDeploysKey(groups, giteaOrigin, generation)
      : "";
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly deploys: ZeropsGroupDeploys;
  } | null>(null);
  const [tick, setTick] = useState(0);
  // The reads run off `key` and the clock, never off the inputs' identity: on
  // the Git tab the groups are rebuilt from an inventory that moves with every
  // read this hook makes, and keying the effect on them read the group repo
  // about 700 times a minute for as long as the tab was open (the owner's org,
  // 2026-09-17, 19:35Z on). The latest inputs are read from here when a pass
  // starts.
  const latest = useRef({ groups, readVersion });
  useEffect(() => {
    latest.current = { groups, readVersion };
  }, [groups, readVersion]);

  useEffect(() => {
    if (key === "") return;
    const timer = window.setInterval(() => {
      setTick((count) => count + 1);
    }, GROUP_DEPLOYS_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [key]);

  useEffect(() => {
    if (key === "" || giteaOrigin === undefined) return;
    const client = giteaClientFor(giteaOrigin);
    const controller = new AbortController();

    void (async () => {
      const { groups, readVersion } = latest.current;
      const deploys = new Map<string, ZeropsGroupDeployState>();
      for (const group of groups) {
        if (controller.signal.aborted) return;
        // Signed in to Gitea or not, the group's declarations are the group
        // repo's: with no session there is nothing to declare from and the
        // group keeps whatever the account alone can say, which is nothing.
        const declarations =
          client === null
            ? []
            : await readDeclarations(client, group.slug).catch(
                (): ReadonlyArray<GroupEnvironment> => [],
              );
        const pullRequests =
          client === null
            ? []
            : await client
                .listPullRequests(group.slug, GROUP_REPOSITORY, { state: "open" })
                .catch((): ReadonlyArray<GiteaPullRequest> => []);
        const onMain =
          client === null
            ? NO_TIERS
            : await readTiersOnMain(client, group.slug).catch((): TiersOnMain => NO_TIERS);
        const tiersOnMain = onMain.tiers;
        if (controller.signal.aborted) return;
        // A tier the account already holds a project for is not missing, even
        // while its declaration is still on its way to the group repo.
        const filledTiers = group.projects.flatMap((project) => {
          const tier = environmentTierForRole(project.role);
          return tier === undefined ? [] : [tier];
        });
        const missing = missingEnvironmentRows({ tiersOnMain, declarations, filledTiers });
        if (declarations.length === 0 && pullRequests.length === 0 && missing.length === 0)
          continue;

        const services: ReadonlyArray<GroupEnvironmentService> = group.projects.flatMap((project) =>
          project.services.map((service) => ({
            projectId: project.projectId,
            serviceId: service.serviceId,
            hostname: service.hostname,
          })),
        );
        const versions = new Map<string, string>();
        for (const read of planDeployedVersionReads({ declarations, services })) {
          const name = await readVersion(read.projectId, read.serviceId, controller.signal);
          if (controller.signal.aborted) return;
          if (name !== undefined) versions.set(read.serviceId, name);
        }

        const statuses = new Map<string, ReadonlyArray<GiteaCommitStatus>>();
        if (client !== null) {
          const reads = planDeployStatusReads({
            owner: group.slug,
            versions: services.map((service) => ({
              hostname: service.hostname,
              appVersionName: versions.get(service.serviceId),
              repository: onMain.repositories.get(service.hostname),
            })),
          });
          for (const read of reads) {
            // A refusal is not an answer: the row says nothing about a deploy
            // it could not be told about, rather than calling it neutral.
            const answered = await client
              .listCommitStatuses(read.owner, read.repo, read.sha)
              .catch(() => null);
            if (controller.signal.aborted) return;
            if (answered !== null) statuses.set(deployStatusKey(read), answered);
          }
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
        // repository, whether or not the group has a stage (D28). The comment
        // here used to say a group with a stage never issued these reads,
        // which `planMainHeadReads` has not done since D28 landed.
        const mainHeads = new Map<string, string>();
        if (client !== null) {
          for (const read of planMainHeadReads({
            declarations,
            services,
            repositories: onMain.repositories,
          })) {
            const branch = await client.getBranch(group.slug, read.repo, "main").catch(() => null);
            if (controller.signal.aborted) return;
            const sha = branch?.commit?.id;
            if (sha !== undefined && sha !== "") mainHeads.set(read.hostname, sha);
          }
        }

        // What each production service is not running yet. Read against the
        // deployed commit, not against the newest tag: a release that was
        // never deployed is still ahead of the service, and the person is
        // being told what pressing the verb would put there.
        const running = releaseDeploys(rowInputs).production;
        const releaseContents: Array<ReleaseContent> = [];
        if (client !== null) {
          for (const read of planReleaseReads(mainHeads, running)) {
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
            if (controller.signal.aborted) return;
            if (commits.length > 0) releaseContents.push({ service: read.service, commits });
          }
        }

        deploys.set(group.groupId, {
          declarations,
          pullRequests,
          missing,
          mainHeads,
          releaseContents,
          environments: rowInputs,
        });
      }
      if (!controller.signal.aborted) setAnswer({ key, deploys });
    })();

    return () => {
      controller.abort();
    };
    // `key` is the serialisation of `groups`, which is what the reads depend
    // on; keying on the array's identity would read the whole account again
    // on every render. `tick` is the clock: the same reads again, with what
    // was read last staying up until they land.
  }, [giteaOrigin, key, tick]);

  return answer?.key === key ? answer.deploys : EMPTY;
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

const NO_TIERS: TiersOnMain = { tiers: [], repositories: new Map() };

async function readTiersOnMain(
  client: NonNullable<ReturnType<typeof giteaClientFor>>,
  slug: string,
): Promise<TiersOnMain> {
  const tiers: ReadonlyArray<GroupEnvironmentTier> = ["stage", "production"];
  const repositories = new Map<string, string>();
  const present = await Promise.all(
    tiers.map(async (tier) => {
      const file = await client
        .readFile(slug, GROUP_REPOSITORY, RECIPE_TIER_PATHS[tier], "main")
        .catch(() => undefined);
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
  client: NonNullable<ReturnType<typeof giteaClientFor>>,
  slug: string,
): Promise<ReadonlyArray<GroupEnvironment>> {
  const file = await client.readFile(slug, GROUP_REPOSITORY, ENVIRONMENTS_PATH, "main");
  return file === undefined ? [] : readGroupEnvironments(file.content);
}
