/**
 * The `can` records the client draws HQ's verbs from (`hqOffers.ts`), one builder per thing HQ's
 * structure streams — the organization, an application, an environment, a placed project, a
 * project held nowhere — each decided by the verb rule (`zeropsPermissions.ts`) over the person's
 * live Zerops facts. HQ decides each write again on the person's fresh read.
 *
 * Pure.
 *
 * @module zeropsOffers
 */
import type { HqOffers } from "./hqOffers.ts";
import {
  addMatePermission,
  attachPermission,
  changePermission,
  createAppPermission,
  deployPermission,
  detachPermission,
  mateRecordPermission,
  operateMatePermission,
  releasePermission,
  structurePermission,
  type Decision,
  type PermissionFacts,
  type ReleaseProduction,
} from "./zeropsPermissions.ts";
import { isMateKind } from "./zeropsRoles.ts";

/** The organization's verbs: making an application, and its structure — renaming, deleting one. */
export function organizationOffers(facts: PermissionFacts): HqOffers {
  const structure = structurePermission(facts);
  return {
    create_app: createAppPermission(facts),
    structure,
    rename_app: structure,
    delete_app: structure,
  };
}

/** An application as the offers read it: its projects, its production and its places. */
export interface ApplicationFacts {
  readonly projectIds: ReadonlyArray<string>;
  readonly production: ReleaseProduction;
  /** Its placement rows, each by its kind there. */
  readonly placements: ReadonlyArray<{ readonly projectId: string; readonly kind: string }>;
}

/** Whether a tier's place is taken: by a project Zerops lists, or a production delivered to Git. */
function slotTaken(facts: PermissionFacts, tier: string, app: ApplicationFacts): boolean {
  if (tier === "production" && app.production?.kind === "git") return true;
  return app.placements.some(
    (row) =>
      (tier === "production"
        ? row.kind === "production"
        : row.kind === "stage" || row.kind === "devstage") &&
      facts.project(row.projectId) !== undefined,
  );
}

/** Adding a tier environment the person makes: only an empty place is offered. */
function newEnvironmentOffer(
  facts: PermissionFacts,
  tier: "stage" | "production",
  app: ApplicationFacts,
): Decision {
  const creator = createAppPermission(facts);
  if (!creator.allow) return creator;
  const taken = slotTaken(facts, tier, app);
  const decision = attachPermission(facts, {
    projectId: null,
    projectIds: app.placements.map((row) => row.projectId),
    kind: tier,
    held: "none",
    slotTaken: taken,
  });
  return decision.allow && taken ? { allow: false, reason: "slot_taken" } : decision;
}

/** An application's verbs: its Mates, structure and remotes, release, changes and environments. */
export function applicationOffers(facts: PermissionFacts, app: ApplicationFacts): HqOffers {
  const structure = structurePermission(facts);
  return {
    add_mate: addMatePermission(facts, app.projectIds),
    structure,
    connect_remote: structure,
    replace_remote_token: structure,
    update_remote_address: structure,
    disconnect_remote: structure,
    release: releasePermission(facts, app.projectIds, app.production),
    read_change: changePermission(facts, "read_change", app.projectIds),
    comment_change: changePermission(facts, "comment_change", app.projectIds),
    merge_change: changePermission(facts, "merge_change", app.projectIds),
    close_change: changePermission(facts, "close_change", app.projectIds),
    add_stage: newEnvironmentOffer(facts, "stage", app),
    add_production: newEnvironmentOffer(facts, "production", app),
    add_git_environment: structure,
  };
}

/**
 * A Zerops environment's verbs: its deploy token and deploys, and — a production's — its removal,
 * which takes the role that could make its replacement.
 */
export function environmentOffers(
  facts: PermissionFacts,
  environment: { readonly projectId: string; readonly tier: "stage" | "production" },
  app: Pick<ApplicationFacts, "projectIds">,
): HqOffers {
  const offers = {
    keep_deploy_token: deployPermission(facts, "keep_deploy_token", environment.projectId),
    redeploy: deployPermission(facts, "redeploy", environment.projectId),
  };
  if (environment.tier !== "production") return offers;
  const creates = createAppPermission(facts);
  return {
    ...offers,
    remove_production: creates.allow
      ? attachPermission(facts, {
          projectId: null,
          projectIds: app.projectIds,
          kind: "production",
          held: "none",
          slotTaken: false,
        })
      : creates,
  };
}

/** A Git environment's verbs: the structure's; it keeps no deploy token. */
export function gitEnvironmentOffers(facts: PermissionFacts): HqOffers {
  const structure = structurePermission(facts);
  return {
    keep_deploy_token: { allow: false, reason: "unknown_kind" },
    remove_git_environment: structure,
    redeploy: structure,
  };
}

/**
 * A placed project's verbs, by its kind there: a Mate's operating, record and detaching; an
 * environment's finishing (`finish`, its attach where it is held). None for any other kind.
 */
export function placementOffers(
  facts: PermissionFacts,
  placement: { readonly projectId: string; readonly kind: string },
  app: Pick<ApplicationFacts, "projectIds">,
): HqOffers | undefined {
  const { projectId, kind } = placement;
  const mate: HqOffers = isMateKind(kind)
    ? {
        observe_mate: operateMatePermission(facts, projectId),
        edit_mate_record: mateRecordPermission(facts, projectId, { create: false, held: kind }),
        detach: detachPermission(facts, projectId, kind),
      }
    : {};
  const tier = kind === "devstage" ? "stage" : kind;
  const environment: HqOffers =
    tier === "stage" || tier === "production"
      ? {
          finish: attachPermission(facts, {
            projectId,
            projectIds: app.projectIds,
            kind: tier,
            held: kind,
            slotTaken: true,
          }),
        }
      : {};
  const offers: HqOffers = { ...mate, ...environment };
  return Object.keys(offers).length === 0 ? undefined : offers;
}

/** A project HQ holds nowhere: whether the person may make its Mate's record. */
export const unheldOffers = (facts: PermissionFacts, projectId: string): HqOffers => ({
  create_mate_record: mateRecordPermission(facts, projectId, { create: true, held: "none" }),
});
