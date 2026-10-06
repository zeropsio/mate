/**
 * What an application's environments run, and how each deploy of theirs went (guide 4.4, 5.3).
 *
 * The projects screen shows each stage and the production with the branch it follows and the
 * commit it actually runs. Three parties hold those facts, and none of them can be asked for
 * another's:
 *
 * - **HQ** records which projects are the application's environments, in the order they were
 *   declared, what feeds each, and per service its newest deploy and the newest that went live
 *   (`HqEnvironment`, SPEC §3.2b) — down the organization's stream, as the person.
 * - **Zerops** says what is deployed, as the commit the service's `appVersionName` spells
 *   (`versionName.ts`), as the account's store states it.
 * - **The recipe on `main`** says which tiers a person can add, and which repository each runtime
 *   builds from (`appRecipeOf`), read through HQ as the person.
 *
 * ## A missing answer is a quieter row, never a different one
 *
 * Every environment HQ records gets a row whatever else came back. No deploy recorded: no dot with
 * a word beside it. Nothing deployed yet: the branch alone. The row's shape does not depend on
 * which reads landed, which is what keeps the screen from moving under the person as they arrive
 * (`environmentRow`).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupDeploys
 */

import type { EnvironmentBirth } from "@t3tools/shared/hqDeploys";
import type { ReleaseRollout } from "@t3tools/shared/hqRelease";

import { type GroupEnvironment, type GroupEnvironmentTier } from "./groupEnvironments.ts";
import { deployedCommit, type EnvironmentServiceState, type GroupRowTone } from "./groupRows.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";
import type { ZeropsServiceDeployedVersion } from "../data/projections/serviceRuns.ts";
import { type HqEnvironment, jobFailed, jobsByService } from "./hq/environments.ts";
import type { Shown } from "./knowledge/known.ts";
import { recipeTierRepositories, recipeTierServices } from "./recipeTier.ts";

/** One runtime service of one Zerops project, as an environment's row needs it. */
export interface GroupEnvironmentService {
  readonly projectId: string;
  readonly serviceId: string;
  /** Its hostname in the environment — `app` for a pair's promoted runtime. */
  readonly hostname: string;
}

/** What one environment's row is built from, before the row itself. */
export interface GroupEnvironmentRowInput {
  readonly projectId: string;
  readonly name: string;
  readonly tier: GroupEnvironment["tier"];
  readonly sources: GroupEnvironment["sources"];
  readonly services: ReadonlyArray<EnvironmentServiceState>;
  /** HQ's name for it, which a deploy asked again names. */
  readonly environment: string;
  /** Whether HQ holds the deploy key it deploys it with. */
  readonly keyHeld: boolean;
  /** Whether the deploy key HQ holds for it no longer answers, or reaches more than its project. */
  readonly keyInvalid: boolean;
  /**
   * The services its tier declares on the recipe's `main`, by hostname; none while the recipe is
   * not read (audit D2: a service the project lacks is a person's to add).
   */
  readonly recipeServices?: ReadonlyArray<string> | undefined;
  /** A production's newest release as HQ's rollout of it stands there (`HqEnvironment.release`). */
  readonly release?: ReleaseRollout | null | undefined;
  /** Failed release jobs HQ still lists, including those a newer service job replaced. */
  readonly releaseFailures?: ReadonlyArray<ReleaseDeployFailure>;
  /** HQ bringing it up (`HqEnvironment.birth`). */
  readonly birth?: EnvironmentBirth | null | undefined;
}

/**
 * The version name each service runs, by service id, as the account's store states it
 * (`serviceRuns`). A service it states no name for — not read yet, or running what
 * nobody named — is left out: its row says less until the store says more.
 */
export function statedVersionNames(
  stated: ReadonlyMap<string, Shown<ZeropsServiceDeployedVersion>>,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const [serviceId, version] of stated) {
    if (version.state !== "known" || version.value.name === null) continue;
    names.set(serviceId, version.value.name);
  }
  return names;
}

/**
 * The id of the version each service runs, by service id, where the platform said; `null` for one
 * it says runs none. What a service runs against what HQ last made it run (`driftOf`).
 */
export function statedActiveVersions(
  stated: ReadonlyMap<string, Shown<ZeropsServiceDeployedVersion>>,
): ReadonlyMap<string, string | null> {
  const ids = new Map<string, string | null>();
  for (const [serviceId, version] of stated) {
    if (version.state === "known") ids.set(serviceId, version.value.activeId);
  }
  return ids;
}

/** What an application's recipe on `main` offers: the tiers a person can add, and where code lives. */
export interface AppRecipe {
  readonly tiers: ReadonlyArray<GroupEnvironmentTier>;
  /**
   * The repository each runtime builds from, by hostname, from the tiers' `buildFromGit` — never
   * the hostname: `appdev` builds `app`. A later tier names a hostname's repository over an earlier.
   */
  readonly repositories: ReadonlyMap<string, string>;
  /** The production tier's alone: what a release lists, each at its repository's `main` (C01). */
  readonly productionRepositories: ReadonlyMap<string, string>;
  /** The services each tier on `main` declares, by hostname, in its order. */
  readonly declared: ReadonlyMap<GroupEnvironmentTier, ReadonlyArray<string>>;
}

/** `appdev` from `https://hq…/git/app-1/appdev.git`. */
function repositoryName(cloneUrl: string): string | undefined {
  const last = cloneUrl.replace(/\/+$/u, "").split("/").at(-1);
  if (last === undefined || last.length === 0) return undefined;
  return last.endsWith(".git") ? last.slice(0, -".git".length) : last;
}

/** The recipe's stage and production tiers as `main` holds them; `null` where it holds none. */
export function appRecipeOf(files: {
  readonly stage: string | null;
  readonly production: string | null;
}): AppRecipe {
  const tiers: Array<GroupEnvironmentTier> = [];
  const repositories = new Map<string, string>();
  const productionRepositories = new Map<string, string>();
  const declared = new Map<GroupEnvironmentTier, ReadonlyArray<string>>();
  for (const tier of ["stage", "production"] as const) {
    const file = files[tier];
    if (file === null) continue;
    tiers.push(tier);
    declared.set(
      tier,
      (recipeTierServices(file) ?? []).map((service) => service.hostname),
    );
    for (const [hostname, cloneUrl] of recipeTierRepositories(file)) {
      const name = repositoryName(cloneUrl);
      if (name === undefined) continue;
      repositories.set(hostname, name);
      if (tier === "production") productionRepositories.set(hostname, name);
    }
  }
  return { tiers, repositories, productionRepositories, declared };
}

/**
 * Every environment HQ records for an application, in the order they were declared, in the shape
 * `environmentRow` takes: each service the account lists in its project, with what it runs and the
 * deploys HQ records for it by its hostname, then each service HQ records a deploy of that the
 * account does not list.
 *
 * Named by the Zerops project when the account can see it, and by HQ's name for it when it cannot:
 * an environment in a project this person may not read is still one the application has.
 */
export function environmentRowInputsOf(input: {
  readonly environments: ReadonlyArray<HqEnvironment>;
  /** What each Zerops project is called, by id. */
  readonly projectNames: ReadonlyMap<string, string>;
  readonly services: ReadonlyArray<GroupEnvironmentService>;
  /** The version name each service runs, by service id. */
  readonly versions: ReadonlyMap<string, string>;
  /** The id of the version each service runs, by service id (`statedActiveVersions`). */
  readonly activeVersions?: ReadonlyMap<string, string | null> | undefined;
  /** The repository each service is built from, by hostname (the tier's `buildFromGit`). */
  readonly repositories?: ReadonlyMap<string, string> | undefined;
  /** The services each tier declares (`AppRecipe.declared`); none while the recipe is unread. */
  readonly declared?: AppRecipe["declared"] | undefined;
}): ReadonlyArray<GroupEnvironmentRowInput> {
  return [...input.environments]
    .sort((left, right) => left.order - right.order)
    .map((environment) => {
      const deploys = jobsByService(environment);
      const listed = input.services.filter(
        (service) => service.projectId === environment.projectId,
      );
      const state = (hostname: string, serviceId?: string): EnvironmentServiceState => {
        const repository = input.repositories?.get(hostname);
        const appVersionName = serviceId === undefined ? undefined : input.versions.get(serviceId);
        const activeVersionId =
          serviceId === undefined ? undefined : input.activeVersions?.get(serviceId);
        const deploy = deploys.get(hostname);
        return {
          hostname,
          ...(repository === undefined ? {} : { repository }),
          ...(appVersionName === undefined ? {} : { appVersionName }),
          ...(serviceId === undefined ? {} : { serviceId }),
          ...(activeVersionId === undefined ? {} : { activeVersionId }),
          ...(deploy === undefined ? {} : { deploy }),
        };
      };
      // A service HQ deploys stands in the row before the account lists it: how its deploy went
      // is HQ's to say, whatever the account has read.
      const unlisted = [...deploys.keys()].filter(
        (hostname) => !listed.some((service) => service.hostname === hostname),
      );
      const recipeServices = input.declared?.get(environment.tier);
      const releaseFailures =
        environment.tier !== "production"
          ? []
          : environment.jobs.flatMap((job) =>
              job.kind === "deploy" &&
              job.cause === "release" &&
              job.ref !== null &&
              job.service !== null &&
              job.sha !== null &&
              jobFailed(job)
                ? [{ tag: job.ref, service: job.service, sha: job.sha }]
                : [],
            );
      return {
        projectId: environment.projectId,
        name: input.projectNames.get(environment.projectId) ?? environment.name,
        tier: environment.tier,
        sources: environment.tier === "production" ? "release" : environment.sources,
        environment: environment.name,
        keyHeld: environment.keyHeld,
        keyInvalid: environment.keyInvalid,
        services: [
          ...listed.map((service) => state(service.hostname, service.serviceId)),
          ...unlisted.map((hostname) => state(hostname)),
        ],
        ...(recipeServices === undefined ? {} : { recipeServices }),
        ...(environment.release === undefined ? {} : { release: environment.release }),
        ...(releaseFailures.length === 0 ? {} : { releaseFailures }),
        birth: environment.birth,
      };
    });
}

/** A Zerops project of an application, as its stops need it: the account's half. */
export interface GroupStopProject {
  readonly projectId: string;
  readonly name: string;
  /** Its role tag, which says which tier it fills before HQ records it as one. */
  readonly role?: ZeropsEnvironmentRole | undefined;
  /** Its runtime services — the ones that hold code HQ deploys. */
  readonly services: ReadonlyArray<{ readonly serviceId: string; readonly hostname: string }>;
}

/** An application's stops: the environments HQ records, their rows' inputs. */
export interface GroupStops {
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  readonly environments: ReadonlyArray<GroupEnvironmentRowInput>;
}

/**
 * An application's stops from HQ's environments and what the account holds: each environment HQ
 * records, and a row that asks for each tier the recipe on `main` offers and no environment and no
 * project's role fills — none while the recipe is not read.
 */
export function groupStopsOf(input: {
  readonly environments: ReadonlyArray<HqEnvironment>;
  readonly projects: ReadonlyArray<GroupStopProject>;
  /** The version name each service runs, by service id. */
  readonly versions: ReadonlyMap<string, string>;
  /** The id of the version each service runs, by service id (`statedActiveVersions`). */
  readonly activeVersions?: ReadonlyMap<string, string | null> | undefined;
  readonly recipe: AppRecipe | undefined;
}): GroupStops {
  const { recipe } = input;
  const declarations = input.environments.map((environment): GroupEnvironment => ({
    name: environment.name,
    tier: environment.tier,
    project: environment.projectId,
    sources: environment.tier === "production" ? "release" : environment.sources,
  }));
  return {
    declarations,
    environments: environmentRowInputsOf({
      environments: input.environments,
      projectNames: new Map(input.projects.map((project) => [project.projectId, project.name])),
      services: input.projects.flatMap((project) =>
        project.services.map((service) => ({ projectId: project.projectId, ...service })),
      ),
      versions: input.versions,
      activeVersions: input.activeVersions,
      repositories: recipe?.repositories,
      declared: recipe?.declared,
    }),
  };
}

/**
 * A production deploy that failed — the build's own failure, or HQ's refusal — as a release's: the
 * job its rollout asked for (`cause: "release"`, `ref` its tag), or the job of the commit under way
 * it left the service out for (`ReleaseRollout.leftOut`).
 */
export interface ReleaseDeployFailure {
  /** The release whose rollout asked for it, or waited on it. */
  readonly tag: string;
  readonly service: string;
  readonly sha: string;
}

/** What production runs and where its deploys failed, as a release reads them. */
export interface ReleaseDeploys {
  /**
   * `{service hostname: sha}` production runs, never read from a release tag: whole or short as
   * the version's name spells it.
   */
  readonly production: ReadonlyMap<string, string>;
  /** Failed jobs HQ lists for production, each with the release that asked for it. */
  readonly failed: ReadonlyArray<ReleaseDeployFailure>;
  /** Each production's newest release rollout, as HQ told it (`releaseInFlight`). */
  readonly rollouts: ReadonlyArray<ReleaseRollout | null | undefined>;
}

/**
 * What *Release* compares production against, from the same snapshot the rows are built from.
 *
 * What production runs is the sha in a deployed version's name (`deployedCommit`)
 * and nothing else — not a branch head, which is what *should* be there, and not
 * the newest release tag, which is what HQ was asked to deploy rather than what
 * is running. A service whose name is not a commit has none: it was deployed by
 * hand, and a release listing a guess is a release HQ deploys.
 */
export function releaseDeploys(
  environments: ReadonlyArray<GroupEnvironmentRowInput>,
): ReleaseDeploys {
  const production = new Map<string, string>();
  const failed: Array<ReleaseDeployFailure> = [];
  const rollouts: Array<ReleaseRollout | null | undefined> = [];
  for (const environment of environments) {
    if (environment.tier !== "production") continue;
    rollouts.push(environment.release);
    failed.push(...(environment.releaseFailures ?? []));
    for (const service of environment.services) {
      const latest = service.deploy?.latest;
      if (latest !== undefined && latest.sha !== null && jobFailed(latest)) {
        const tag =
          latest.cause === "release"
            ? latest.ref
            : environment.release?.leftOut.some((left) => left.job === latest.id) === true
              ? environment.release.tag
              : null;
        if (
          tag !== null &&
          !failed.some(
            (job) => job.tag === tag && job.service === service.hostname && job.sha === latest.sha,
          )
        )
          failed.push({ tag, service: service.hostname, sha: latest.sha });
      }
      const sha = deployedCommit(service.appVersionName);
      if (sha === undefined || production.has(service.hostname)) continue;
      production.set(service.hostname, sha);
    }
  }
  return { production, failed, rollouts };
}

/**
 * The one word beside a deploy's dot — never a sentence, never "configured"
 * (design system R5).
 *
 * `undefined` for a neutral environment: nothing has been deployed there, or
 * HQ records no deploy of it to tell how it went, and a word invented for
 * either would be the screen guessing.
 */
export function deployWord(tone: GroupRowTone): string | undefined {
  switch (tone) {
    case "good":
      return "Deployed";
    case "pending":
      return "Deploying…";
    case "bad":
      return "Failed";
    case "neutral":
      return undefined;
  }
}
