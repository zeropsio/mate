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
import { readZeropsMembership } from "./groups.ts";
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
  /** The Zerops project it is. */
  readonly project: string;
  /**
   * The branches that feed it, or the literal `release` for a production —
   * the newest approved `v*` tag and nothing else.
   */
  readonly sources: ReadonlyArray<string> | "release";
}

/**
 * A tier the group's recipe offers and the group does not have yet — the row
 * that asks. Once the recipe is on the group repo's `main`, a stage and a
 * production are the person's next steps, and a group that showed only its
 * Mate never said so (the owner, twice, 2026-09-17: "it never asked me to
 * setup production").
 */
export interface MissingEnvironmentRow {
  readonly kind: "missing-environment";
  readonly tier: GroupEnvironmentTier;
  readonly name: string;
  readonly line: string;
}

/** What a missing tier's row says. */
export const MISSING_ENVIRONMENT_LINE = "not set up yet";

/**
 * One row per tier the recipe offers on `main` and no declared environment
 * fills, stage before production — the order the person adds them in.
 */
export function missingEnvironmentRows(input: {
  /** The tiers whose import is on the group repo's `main`. */
  readonly tiersOnMain: ReadonlyArray<GroupEnvironmentTier>;
  readonly declarations: ReadonlyArray<Pick<GroupEnvironment, "tier">>;
  /**
   * The tiers the account already holds a project for. A declaration lands on
   * the group repo minutes after the environment is made, and until it does
   * the tier is declared nowhere — so the row that asks for it stood directly
   * under the environment the person was watching come up.
   */
  readonly filledTiers?: ReadonlyArray<GroupEnvironmentTier> | undefined;
}): ReadonlyArray<MissingEnvironmentRow> {
  const declared = new Set(input.declarations.map((entry) => entry.tier));
  const held = new Set(input.filledTiers ?? []);
  const offered = new Set(input.tiersOnMain);
  const order: ReadonlyArray<GroupEnvironmentTier> = ["stage", "production"];
  return order
    .filter((tier) => offered.has(tier) && !declared.has(tier) && !held.has(tier))
    .map((tier) => ({
      kind: "missing-environment",
      tier,
      name: tier === "stage" ? "Stage" : "Production",
      line: MISSING_ENVIRONMENT_LINE,
    }));
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
    out.push({ groupId: membership.groupId, projectId: project.id, tier });
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
   * An environment whose creation is under way or failed, and HQ does not hold yet: it stands in
   * the tier's place, so the tier is never offered a second time (§9.6).
   */
  | {
      readonly kind: "creating";
      readonly tier: GroupEnvironmentTier;
      readonly id: string;
      readonly line: string;
      /** Whether *Try again* stands on it: the creation failed and this person may add. */
      readonly retry: boolean;
    }
  /** A tier nobody added: quiet, never a step, a dot or a count. */
  | {
      readonly kind: "slot";
      readonly tier: GroupEnvironmentTier;
      readonly name: string;
      readonly line: string;
      /** Whether *Add* stands on it: the recipe holds the tier and this person may add. */
      readonly add: boolean;
    };

/** What production runs, as the section reads it. */
export type ProductionRuns = "unknown" | "empty" | "deploying" | "running";

/**
 * The *Environments* section of an application, always drawn: its stages (and a Mate that serves as
 * one), a slot for the stage when it has none, and production or its slot. Stage and production
 * are peers (P3): either, both or neither may exist, and neither waits on the other.
 */
export function environmentSlots(input: {
  readonly environments: ReadonlyArray<{
    readonly id: string;
    readonly tier: GroupEnvironmentTier;
  }>;
  /** Mates that are also the stage (`devstage`). */
  readonly devstages: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** Creations the platform accepted and HQ does not hold yet (the group tree's `pending`). */
  readonly pending: ReadonlyArray<{
    readonly id: string;
    readonly tier: GroupEnvironmentTier;
    readonly name: string;
    readonly failed: boolean;
  }>;
  /** The tiers the recipe on `main` offers and the application lacks (`missingEnvironmentRows`). */
  readonly missing: ReadonlyArray<GroupEnvironmentTier>;
  /** Whether the recipe is read: until it is, no slot is offered or said to wait for it. */
  readonly recipeRead: boolean;
  /** Whether this person may add an environment (`mayAddEnvironment`). */
  readonly mayAdd: boolean;
  /** What production runs: nothing (`empty`), a deploy under way, a release, or not known. */
  readonly productionRuns: ProductionRuns;
  /** The changes merged and waiting for production, as the release counts them. */
  readonly waiting: { readonly count: number; readonly atLeast: boolean };
  /** Whether `main` holds code; `undefined` where it is not known. */
  readonly mainHasCode: boolean | undefined;
  /** Whether *Review release* is offered to this person (the release gate allows). */
  readonly releaseOffered: boolean;
  /** The release tag on its way to production. */
  readonly releasing: string | undefined;
}): ReadonlyArray<EnvironmentSlotRow> {
  const slot = (tier: GroupEnvironmentTier): EnvironmentSlotRow => {
    const offered = input.missing.includes(tier);
    return {
      kind: "slot",
      tier,
      name: tier === "stage" ? "Stage" : "Production",
      line: input.recipeRead && !offered ? ENVIRONMENT_AWAITS_RECIPE : ENVIRONMENT_NOT_ADDED,
      add: input.mayAdd && input.recipeRead && offered,
    };
  };
  const stages = input.environments.filter((entry) => entry.tier === "stage");
  const production = input.environments.find((entry) => entry.tier === "production");
  // The listing's member stands in a creation's place once HQ holds the project.
  const held = new Set(input.environments.map((entry) => entry.id));
  const creating = (tier: GroupEnvironmentTier) =>
    input.pending
      .filter((entry) => entry.tier === tier && !held.has(entry.id))
      .map((entry): EnvironmentSlotRow => ({
        kind: "creating",
        tier,
        id: entry.id,
        line: entry.failed
          ? "Setup failed"
          : tier === "stage"
            ? STAGE_SETTING_UP
            : PRODUCTION_SETTING_UP,
        retry: entry.failed && input.mayAdd,
      }));
  const stagesComing = creating("stage");
  const productionComing = creating("production");
  const rows: Array<EnvironmentSlotRow> = [
    ...stages.map(({ id, tier }): EnvironmentSlotRow => ({
      kind: "environment",
      tier,
      id,
      note: undefined,
    })),
    ...input.devstages.map(({ id, name }): EnvironmentSlotRow => ({
      kind: "devstage",
      id,
      line: `${name} — the stage, deployed by its agent`,
    })),
  ];
  rows.push(...stagesComing);
  if (rows.length === 0) rows.push(slot("stage"));
  if (production !== undefined)
    rows.push({
      kind: "environment",
      tier: "production",
      id: production.id,
      note: productionNote(input),
    });
  else if (productionComing.length > 0) rows.push(...productionComing);
  else rows.push(slot("production"));
  return rows;
}

function productionNote(input: {
  readonly productionRuns: ProductionRuns;
  readonly waiting: { readonly count: number; readonly atLeast: boolean };
  readonly mainHasCode: boolean | undefined;
  readonly releaseOffered: boolean;
  readonly releasing: string | undefined;
}): ProductionNote | undefined {
  if (input.releasing !== undefined)
    return { text: `Releasing ${input.releasing}…`, review: false };
  if (input.productionRuns === "empty") {
    return input.mainHasCode === false
      ? { text: "Empty — waiting for the first merge", review: false }
      : { text: "Empty — waiting for its first release", review: input.releaseOffered };
  }
  if (input.waiting.count > 0)
    return {
      text: `${changesCountWords(input.waiting.count, input.waiting.atLeast)} waiting for production`,
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
