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

import {
  environmentTierForRole,
  missingEnvironmentRows,
  type GroupEnvironment,
  type GroupEnvironmentTier,
  type MissingEnvironmentRow,
} from "./groupEnvironments.ts";
import { deployedCommit, type EnvironmentServiceState, type GroupRowTone } from "./groupRows.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";
import type { HqEnvironment } from "./hq/environments.ts";
import { recipeTierRepositories } from "./recipeTier.ts";

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
  /** Whether the deploy key HQ holds for it no longer answers, or reaches more than its project. */
  readonly keyInvalid: boolean;
}

/** What an application's recipe on `main` offers: the tiers a person can add, and where code lives. */
export interface AppRecipe {
  readonly tiers: ReadonlyArray<GroupEnvironmentTier>;
  /**
   * The repository each runtime builds from, by hostname, from the tiers' `buildFromGit` — never
   * the hostname: `appdev` builds `app`. A later tier names a hostname's repository over an earlier.
   */
  readonly repositories: ReadonlyMap<string, string>;
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
  for (const tier of ["stage", "production"] as const) {
    const file = files[tier];
    if (file === null) continue;
    tiers.push(tier);
    for (const [hostname, cloneUrl] of recipeTierRepositories(file)) {
      const name = repositoryName(cloneUrl);
      if (name !== undefined) repositories.set(hostname, name);
    }
  }
  return { tiers, repositories };
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
  /** The repository each service is built from, by hostname (the tier's `buildFromGit`). */
  readonly repositories?: ReadonlyMap<string, string> | undefined;
}): ReadonlyArray<GroupEnvironmentRowInput> {
  return [...input.environments]
    .sort((left, right) => left.order - right.order)
    .map((environment) => {
      const deploys = new Map(
        environment.deploys.map(({ service, latest, live }) => [service, { latest, live }]),
      );
      const listed = input.services.filter(
        (service) => service.projectId === environment.projectId,
      );
      const state = (hostname: string, serviceId?: string): EnvironmentServiceState => {
        const repository = input.repositories?.get(hostname);
        const appVersionName = serviceId === undefined ? undefined : input.versions.get(serviceId);
        const deploy = deploys.get(hostname);
        return {
          hostname,
          ...(repository === undefined ? {} : { repository }),
          ...(appVersionName === undefined ? {} : { appVersionName }),
          ...(deploy === undefined ? {} : { deploy }),
        };
      };
      // A service HQ deploys stands in the row before the account lists it: how its deploy went
      // is HQ's to say, whatever the account has read.
      const unlisted = [...deploys.keys()].filter(
        (hostname) => !listed.some((service) => service.hostname === hostname),
      );
      return {
        projectId: environment.projectId,
        name: input.projectNames.get(environment.projectId) ?? environment.name,
        tier: environment.tier,
        sources: environment.tier === "production" ? "release" : environment.sources,
        environment: environment.name,
        keyInvalid: environment.keyInvalid,
        services: [
          ...listed.map((service) => state(service.hostname, service.serviceId)),
          ...unlisted.map((hostname) => state(hostname)),
        ],
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

/** An application's stops: the environments HQ records, their rows' inputs, the tiers that ask. */
export interface GroupStops {
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  readonly environments: ReadonlyArray<GroupEnvironmentRowInput>;
  readonly missing: ReadonlyArray<MissingEnvironmentRow>;
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
      repositories: recipe?.repositories,
    }),
    missing:
      recipe === undefined
        ? []
        : missingEnvironmentRows({
            tiersOnMain: recipe.tiers,
            declarations,
            filledTiers: input.projects.flatMap((project) => {
              const tier = environmentTierForRole(project.role);
              return tier === undefined ? [] : [tier];
            }),
          }),
  };
}

/** `{service hostname: sha}` per side of a release, whole or short as the name spells it. */
export interface ReleaseDeploys {
  /** What the stage runs. Several stages: the first HQ records (D16). */
  readonly stage: ReadonlyMap<string, string>;
  /** What production runs, read the same way and never from a release tag. */
  readonly production: ReadonlyMap<string, string>;
  /** `{service}@{sha}` → when it failed, for each production service whose newest deploy failed. */
  readonly failed: ReadonlyMap<string, string>;
}

/**
 * What *Release* compares, from the same snapshot the rows are built from.
 *
 * Both sides are the sha in a deployed version's name (`deployedCommit`) and
 * nothing else — not a branch head, which is what *should* be there, and not
 * the newest release tag, which is what the broker was asked to deploy rather
 * than what is running. A service whose name is not a commit has no side: it
 * was deployed by hand, and a tag listing a guess is a tag the broker deploys.
 *
 * With several stages (D16) the first one HQ records wins for a service they
 * both run: the order they were declared in is the group's own, and picking by
 * anything else would make the release depend on the order of an account read.
 */
export function releaseDeploys(
  environments: ReadonlyArray<GroupEnvironmentRowInput>,
): ReleaseDeploys {
  const stage = new Map<string, string>();
  const production = new Map<string, string>();
  const failed = new Map<string, string>();
  for (const environment of environments) {
    const side = environment.tier === "production" ? production : stage;
    for (const service of environment.services) {
      const latest = service.deploy?.latest;
      if (environment.tier === "production" && latest?.state === "failed")
        failed.set(`${service.hostname}@${latest.sha}`, latest.at);
      const sha = deployedCommit(service.appVersionName);
      if (sha === undefined || side.has(service.hostname)) continue;
      side.set(service.hostname, sha);
    }
  }
  return { stage, production, failed };
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
