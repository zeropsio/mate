/**
 * *Add stage* and *Add production* — what makes a Zerops project an environment of its
 * application (guide 5.2, SPEC §3.2b), and what says one is half-made.
 *
 * An environment is a Zerops project created from a tier, attached to its application in the
 * organization's HQ as its stage or production — HQ records the environment with the attach, its
 * name, its sources and its place in the order — and keyed: the deploy token HQ deploys it with,
 * minted by the person's own client (`deployToken.ts`).
 *
 * ## Public access
 *
 * Not here. `enable-subdomain-access` is refused before there is code (measured), so it is turned
 * on after the first deploy (5.2).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupEnvironments
 */

import type { HqPlacement } from "./hq/placement.ts";
import type { ZeropsRegistry } from "./hq/registry.ts";
import { projectNameInApp, readZeropsMembership } from "./groups.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";
import { environmentKeyed } from "./deployToken.ts";
import { deploymentReadFailed, type Deployment } from "./flow/deployment.ts";
import type { Shown } from "./knowledge/known.ts";
import { PRODUCTION_SETTING_UP } from "./groupFlow.ts";
import { changesCountWords } from "./projectAttention.ts";
import { STAGE_SETTING_UP } from "./stopComing.ts";

/** What a group environment is: a stage, or the one production. */
export type GroupEnvironmentTier = "stage" | "production";

/**
 * The tier a project's role puts it in, as HQ places it (`readZeropsMembership`), or `undefined`
 * for a role that is not an environment of the group — a Mate's own project is `dev`.
 */
export function environmentTierForRole(
  role: ZeropsEnvironmentRole | undefined,
): GroupEnvironmentTier | undefined {
  return role === "stage" ? "stage" : role === "prod" ? "production" : undefined;
}

/** An environment of an application, as HQ records it: its name, tier, project and sources. */
export interface GroupEnvironment {
  readonly name: string;
  readonly tier: GroupEnvironmentTier;
  /** @deprecated Zerops-only compatibility address; canonical declarations carry target. */
  readonly project: string;
  /**
   * The branches that feed it, or the literal `release` for a production —
   * the newest approved `v*` tag and nothing else.
   */
  readonly sources: ReadonlyArray<string> | "release";
}

/**
 * A stage or a production the account holds that its application does not know in full: not
 * placed in HQ as that kind, held as no environment, or — for a person who may keep it — keyed
 * with no deploy token that works (main E07: an environment made before a deploy has none, and HQ
 * deploys nothing to it until somebody who may opens the page). The writes that follow a
 * creation's project live in the page that made it, and a reload in that minute lost them — the
 * project ran, the page kept asking for the tier it already had (2026-09-17). The projects page
 * finishes these on its next read.
 */
export interface HalfMadeGroupEnvironment {
  readonly groupId: string;
  readonly projectId: string;
  readonly tier: GroupEnvironmentTier;
  /** HQ already places this project as its tier; finishing must preserve that placement. */
  readonly registered: boolean;
}

export function halfMadeGroupEnvironments(input: {
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    /** Where HQ places it (`ZeropsProject.hq`). */
    readonly hq?: HqPlacement | undefined;
  }>;
  readonly registry: ZeropsRegistry;
  /**
   * Per group, the environments HQ holds for it. A group missing here has not had them said:
   * nothing is half-made in it yet.
   */
  readonly environments: ReadonlyMap<
    string,
    ReadonlyArray<{
      readonly projectId: string;
      readonly keyHeld: boolean;
      readonly keyInvalid: boolean;
    }>
  >;
  /** Whether HQ's rule lets this person keep a project's deploy key (`keep_deploy_token`). */
  readonly mayKey: (projectId: string) => boolean;
  /**
   * Whether a press still holds the project (`pressElsewhere`): what it has not written yet is
   * its own to write, never half made.
   */
  readonly pressing?: (projectId: string) => boolean;
}): ReadonlyArray<HalfMadeGroupEnvironment> {
  const out: Array<HalfMadeGroupEnvironment> = [];
  for (const project of input.projects) {
    if (input.pressing?.(project.id) === true) continue;
    const membership = readZeropsMembership(project);
    if (membership.groupId === undefined) continue;
    const tier = environmentTierForRole(membership.role);
    if (tier === undefined) continue;
    const group = input.registry.groups.find((entry) => entry.groupId === membership.groupId);
    if (group === undefined) continue;
    const environments = input.environments.get(membership.groupId);
    if (environments === undefined) continue;
    const registered = group.projects.some(
      (entry) => entry.projectId === project.id && entry.kind === tier,
    );
    const environment = environments.find((entry) => entry.projectId === project.id);
    const keyed =
      environment !== undefined && (environmentKeyed(environment) || !input.mayKey(project.id));
    if (registered && keyed) continue;
    out.push({ groupId: membership.groupId, projectId: project.id, tier, registered });
  }
  return out;
}

/** A slot's line while the tier is absent and could be added. */
export const ENVIRONMENT_NOT_ADDED = "Not added";
/** A slot's line where the recipe on `main` does not hold the tier yet: the Mate composes it. */
export const ENVIRONMENT_AWAITS_RECIPE = "Waiting for the Mate's recipe";

/** What the production row says beside its state, and whether *Review release* stands with it. */
export interface ProductionNote {
  readonly text: string;
  readonly review: boolean;
}

/** An environment of an application in any state: held by HQ, made but not attached, or being made. */
export interface HeldEnvironment {
  /** Opaque: today its Zerops project's id. */
  readonly id: string;
  readonly tier: GroupEnvironmentTier;
}

/**
 * What an application holds of each tier, in any state — HQ's record, a project the account made
 * as one that HQ does not know in full, a creation under way, a Mate that is also the stage
 * (`devstage`) — each counted once by its id (§9.6, §9.11).
 */
export function heldTiers(environments: ReadonlyArray<HeldEnvironment>): {
  readonly stages: number;
  readonly production: boolean;
} {
  const byId = new Map(environments.map((entry) => [entry.id, entry.tier] as const));
  const tiers = [...byId.values()];
  return {
    stages: tiers.filter((tier) => tier === "stage").length,
    production: tiers.includes("production"),
  };
}

/**
 * The one rule for whether a stage or a production may be added to an application — every door
 * (the projects page's menu, the sidebar's, the Environments section, the question after a first
 * merge) asks it. HQ offers the tier to this person (`add_stage` / `add_production`: its `attach`
 * rule, its empty place among the application's live projects); the recipe on `main` holds it;
 * and nothing of the tier stands here that HQ does not hold yet — a creation under way, a
 * half-made project, a Mate that is also the stage.
 */
export function environmentAddable(input: {
  readonly tier: GroupEnvironmentTier;
  readonly recipeRead: boolean;
  /** The tiers the recipe on `main` holds. */
  readonly recipeTiers: ReadonlyArray<GroupEnvironmentTier>;
  /** HQ offers this person the tier (`add_stage` / `add_production`). */
  readonly offered: boolean;
  /** HQ offers direct Git setup; it needs no Zerops recipe. */
  readonly gitOffered?: boolean;
  readonly held: ReturnType<typeof heldTiers>;
}): boolean {
  const zerops = input.offered && input.recipeRead && input.recipeTiers.includes(input.tier);
  if (!zerops && input.gitOffered !== true) return false;
  return input.tier === "production" ? !input.held.production : input.held.stages === 0;
}

/** The tiers HQ offers this person to add (`add_stage` / `add_production`, `add_git_environment`). */
export interface EnvironmentOffers {
  readonly stage: boolean;
  readonly production: boolean;
  /** HQ offers direct Git setup; it needs no Zerops recipe. */
  readonly git?: boolean;
  /** The Zerops path alone, where Git setup is offered beside it. */
  readonly zerops?: { readonly stage: boolean; readonly production: boolean };
}

/**
 * Everything an application's environments are told from, gathered once for every surface that
 * draws or offers one (the projects page's card and ···, the sidebar's menu, the *Environments*
 * section, the question after a first merge).
 */
export interface ApplicationEnvironmentFacts {
  /** The application's environments as HQ records them. */
  readonly environments: ReadonlyArray<
    HeldEnvironment & {
      readonly target?: import("@t3tools/shared/hqEnvironment").HqEnvironmentIdentity["target"];
    }
  >;
  /**
   * The account's projects of the application placed as a stage or a production, HQ recording the
   * environment or not (a half-made one, one a press still writes).
   */
  readonly listed?: ReadonlyArray<HeldEnvironment> | undefined;
  /** Mates that are also the stage (`devstage`). */
  readonly devstages: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** Creations the platform accepted and the listing does not hold yet (the group tree's `pending`). */
  readonly pending: ReadonlyArray<HeldEnvironment>;
  /** The tiers the recipe on `main` holds; meaningful once `recipeRead`. */
  readonly recipeTiers: ReadonlyArray<GroupEnvironmentTier>;
  /** Whether the recipe is read: until it is, no tier is offered or said to wait for it. */
  readonly recipeRead: boolean;
  /** What HQ offers this person; `null` before it says, and nothing is offered on a guess. */
  readonly offered: EnvironmentOffers | null;
}

/** What an application holds of each tier and what may be added to it: one answer, every surface. */
export interface ApplicationEnvironments {
  /** Everything it holds, in any state, each once. */
  readonly held: ReadonlyArray<HeldEnvironment>;
  readonly addable: { readonly stage: boolean; readonly production: boolean };
  /** What an absent tier's slot says: not added, or waiting for the recipe to hold it. */
  readonly absentLine: { readonly stage: string; readonly production: string };
  /** Mates that are also the stage, each with the line its Stage row says. */
  readonly devstages: ReadonlyArray<{ readonly id: string; readonly line: string }>;
}

/**
 * The account's projects of an application as its environments' facts read them: each placed as a
 * stage or a production, and each Mate that is also the stage (`devstage`), by its name in the app.
 */
export function listedEnvironmentsOf(
  groupId: string,
  projects: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly hq?: HqPlacement | undefined;
  }>,
): Pick<ApplicationEnvironmentFacts, "listed" | "devstages"> {
  const listed: Array<HeldEnvironment> = [];
  const devstages: Array<{ readonly id: string; readonly name: string }> = [];
  for (const project of projects) {
    const membership = readZeropsMembership(project);
    if (membership.groupId !== groupId) continue;
    if (membership.role === "devstage")
      devstages.push({ id: project.id, name: projectNameInApp(project) });
    const tier = environmentTierForRole(membership.role);
    if (tier !== undefined) listed.push({ id: project.id, tier });
  }
  return { listed, devstages };
}

/**
 * The one projection of an application's environments: what it holds — HQ's record (a Zerops one
 * by its project), the account's projects placed as a tier, a Mate that is also the stage, a
 * creation under way — and, by the one rule (`environmentAddable`), which tier may be added.
 */
export function applicationEnvironments(
  facts: ApplicationEnvironmentFacts,
): ApplicationEnvironments {
  const held: ReadonlyArray<HeldEnvironment> = [
    ...facts.environments.map(({ id, tier, target }) => ({
      id: target?.kind === "zerops" ? target.projectId : id,
      tier,
    })),
    ...(facts.listed ?? []),
    ...facts.devstages.map(({ id }) => ({ id, tier: "stage" as const })),
    ...facts.pending,
  ];
  const tiers = heldTiers(held);
  const { offered } = facts;
  const addable = (tier: GroupEnvironmentTier) =>
    offered !== null &&
    environmentAddable({
      tier,
      recipeRead: facts.recipeRead,
      recipeTiers: facts.recipeTiers,
      offered: offered.zerops?.[tier] ?? offered[tier],
      gitOffered: offered.git === true,
      held: tiers,
    });
  const absentLine = (tier: GroupEnvironmentTier) =>
    offered?.git !== true && facts.recipeRead && !facts.recipeTiers.includes(tier)
      ? ENVIRONMENT_AWAITS_RECIPE
      : ENVIRONMENT_NOT_ADDED;
  return {
    held,
    addable: { stage: addable("stage"), production: addable("production") },
    absentLine: { stage: absentLine("stage"), production: absentLine("production") },
    devstages: facts.devstages.map(({ id, name }) => ({
      id,
      line: `${name} — deployed by its agent`,
    })),
  };
}

/**
 * One row of an application's *Environments* section. An environment is keyed by an opaque `id`
 * (today its Zerops project's), never assumed to be a Zerops project here, so a production that
 * is delivered another way fits the same rows (MODEL §8).
 */
export type EnvironmentSlotRow =
  | {
      readonly kind: "environment";
      readonly tier: GroupEnvironmentTier;
      readonly id: string;
      /** Production only: where its releases stand, when that is worth a line. */
      readonly note: ProductionNote | undefined;
    }
  /** A Mate that is also the application's stage: the agent deploys there, HQ does not. */
  | { readonly kind: "devstage"; readonly id: string; readonly line: string }
  /**
   * An environment whose creation is under way and HQ does not hold yet: it stands in the tier's
   * place, so the tier is never offered a second time (§9.6).
   */
  | {
      readonly kind: "creating";
      readonly tier: GroupEnvironmentTier;
      readonly id: string;
      readonly line: string;
    }
  /**
   * A project made as the tier that HQ does not hold in full (not attached, its key not kept):
   * the tier is not absent, and *Finish setup* is what completes it.
   */
  | {
      readonly kind: "half-made";
      readonly tier: GroupEnvironmentTier;
      readonly id: string;
      readonly line: string;
      /** Whether *Finish setup* stands on it: this person may add. */
      readonly finish: boolean;
    }
  /** A tier nobody added: quiet, never a step, a dot or a count. */
  | {
      readonly kind: "slot";
      readonly tier: GroupEnvironmentTier;
      readonly name: string;
      readonly line: string;
      /** Whether *Add* stands on it (`environmentAddable`). */
      readonly add: boolean;
    };

/** What production runs, as the section reads it. */
export type ProductionRuns = "unknown" | "empty" | "deploying" | "running";

/** A half-made environment's line. */
export const ENVIRONMENT_UNFINISHED = "Setup isn't finished";

/**
 * The *Environments* section of an application, drawn once HQ's environments are read: its stages
 * (and a Mate that serves as one), a slot for the stage when it has none, and production or its
 * slot. Stage and production are peers (P3): either, both or neither may exist, and neither waits
 * on the other.
 */
export function environmentSlots(
  input: ApplicationEnvironmentFacts & {
    /**
     * Projects made as a tier that HQ does not hold in full (`halfMadeGroupEnvironments`), each with
     * whether HQ offers this person finishing it (`can.finish` of its project).
     */
    readonly halfMade: ReadonlyArray<HeldEnvironment & { readonly finish: boolean }>;
    /** What production runs: nothing (`empty`), a deploy under way, a release, or not known. */
    readonly productionRuns: ProductionRuns;
    /** The changes merged and waiting for production, as the release counts them. */
    readonly waiting: {
      readonly count: number;
      readonly atLeast: boolean;
      readonly changeCount?: number | undefined;
    };
    /** Whether `main` holds code; `undefined` where it is not known. */
    readonly mainHasCode: boolean | undefined;
    /** Whether *Review release* is offered to this person (the release gate allows). */
    readonly releaseOffered: boolean;
    /** The release tag on its way to production. */
    readonly releasing: string | undefined;
  },
): ReadonlyArray<EnvironmentSlotRow> {
  const heldIds = new Set(
    input.environments.flatMap((entry) =>
      entry.target === undefined
        ? [entry.id]
        : entry.target.kind === "zerops"
          ? [entry.target.projectId]
          : [],
    ),
  );
  // HQ's record stands in for a creation or a half-made project it now holds.
  const pending = input.pending.filter((entry) => !heldIds.has(entry.id));
  const halfMade = input.halfMade.filter(
    (entry) => !heldIds.has(entry.id) && !pending.some((other) => other.id === entry.id),
  );
  // A project placed as its tier that HQ does not record and nothing calls half-made yet: a press
  // still writes it, so it stands as being set up.
  const shown = new Set([
    ...heldIds,
    ...pending.map(({ id }) => id),
    ...halfMade.map(({ id }) => id),
  ]);
  const writing = [...pending, ...(input.listed ?? []).filter((entry) => !shown.has(entry.id))];
  const { addable, absentLine, devstages } = applicationEnvironments({
    ...input,
    // A half-made project is the account's, placed as its tier.
    listed: [...(input.listed ?? []), ...halfMade],
  });
  const slot = (tier: GroupEnvironmentTier): EnvironmentSlotRow => ({
    kind: "slot",
    tier,
    name: tier === "stage" ? "Stage" : "Production",
    line: absentLine[tier],
    add: addable[tier],
  });
  const coming = (tier: GroupEnvironmentTier): ReadonlyArray<EnvironmentSlotRow> => [
    ...writing
      .filter((entry) => entry.tier === tier)
      .map((entry): EnvironmentSlotRow => ({
        kind: "creating",
        tier,
        id: entry.id,
        line: tier === "stage" ? STAGE_SETTING_UP : PRODUCTION_SETTING_UP,
      })),
    ...halfMade
      .filter((entry) => entry.tier === tier)
      .map((entry): EnvironmentSlotRow => ({
        kind: "half-made",
        tier,
        id: entry.id,
        line: ENVIRONMENT_UNFINISHED,
        finish: entry.finish,
      })),
  ];
  const production = input.environments.find((entry) => entry.tier === "production");
  const rows: Array<EnvironmentSlotRow> = [
    ...input.environments
      .filter((entry) => entry.tier === "stage")
      .map(({ id, tier }): EnvironmentSlotRow => ({
        kind: "environment",
        tier,
        id,
        note: undefined,
      })),
    ...devstages.map(({ id, line }): EnvironmentSlotRow => ({ kind: "devstage", id, line })),
    ...coming("stage"),
  ];
  if (rows.length === 0) rows.push(slot("stage"));
  if (production !== undefined)
    rows.push({
      kind: "environment",
      tier: "production",
      id: production.id,
      note: productionNote(input),
    });
  else {
    const rest = coming("production");
    if (rest.length > 0) rows.push(...rest);
    else rows.push(slot("production"));
  }
  return rows;
}

function productionNote(input: {
  readonly productionRuns: ProductionRuns;
  readonly waiting: {
    readonly count: number;
    readonly atLeast: boolean;
    readonly changeCount?: number | undefined;
  };
  readonly mainHasCode: boolean | undefined;
  readonly releaseOffered: boolean;
  readonly releasing: string | undefined;
}): ProductionNote | undefined {
  if (input.releasing !== undefined)
    return { text: `Releasing ${input.releasing}…`, review: false };
  if (input.productionRuns === "empty") {
    // Its row says it is not released yet; the note says what that waits for, never the same again.
    return input.mainHasCode === false
      ? { text: "Waiting for the first merge", review: false }
      : { text: "Waiting for its first release", review: input.releaseOffered };
  }
  if (input.waiting.count > 0)
    return {
      text: `${changesCountWords(input.waiting.count, input.waiting.atLeast, input.waiting.changeCount)} waiting for production`,
      review: input.releaseOffered,
    };
  return undefined;
}

/**
 * What a production runs, as the platform's pushed answer says it: nothing, a build, or a version —
 * and `unknown` for an answer not read, failed or stale, which claims nothing.
 */
export function productionRunsOf(deployment: Shown<Deployment> | undefined): ProductionRuns {
  if (deployment?.state !== "known" || deploymentReadFailed(deployment)) return "unknown";
  switch (deployment.value.kind) {
    case "none":
      return "empty";
    case "deploying":
      return "deploying";
    default:
      return "running";
  }
}
