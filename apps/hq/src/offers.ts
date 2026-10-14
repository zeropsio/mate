import { HQ_GIT_TARGET_VERBS, type HqGitTargetVerb } from "@t3tools/shared/hqOffers";
/**
 * What HQ offers a person, beside what its structure streams them (`@t3tools/shared/hqOffers`):
 * each verb decided by `can` over the very target its write is enforced with — the builders here,
 * which the writes call too — and over the org as HQ last read it (`Roles.view`). The write is
 * decided again at the press, over facts read for it, and its refusal wins.
 *
 * - **The organization**, once: making, renaming and deleting an application; and for each project
 *   the reader reads that HQ holds nowhere, writing its Mate's record.
 * - **An application**: its changes' verbs, a deploy asked again, and a release.
 * - **An environment**: its deploy token handed to HQ.
 * - **A Mate**: following it (who its door opens for), its record, leaving its application, and
 *   where it may go (`moveTo`): each application, or a new one, with the kinds it may take there.
 *
 * @module offers
 */
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import * as Schema from "effect/Schema";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { HqEnvironmentAttachment } from "@t3tools/shared/hqEnvironment";
import type { HqOffersOf } from "@t3tools/shared/hqOffers";
import { type Decision } from "@t3tools/shared/zeropsPermissions";
import {
  type AppAccessTarget,
  type Facts,
  type FactsFor,
  type Held,
  type PlacementTarget,
  type ReleaseTarget,
  type Targets,
  type Verb,
  can,
} from "./permissions.ts";
import { type RoleProjectKind, isMateKind } from "@t3tools/shared/zeropsRoles";

/** A project an application holds, as `hq_app_project` has it. */
export interface AppProjectRow {
  readonly project_id: string;
  readonly kind: string;
}

/** An application as a change's verbs take it: all of its projects, whoever sees which. */
export const appTarget = (
  projects: ReadonlyArray<Pick<AppProjectRow, "project_id">>,
  createdBy?: string,
): AppAccessTarget => ({
  projectIds: projects.map((row) => row.project_id),
  ...(createdBy === undefined ? {} : { createdBy }),
});

export const readAppTarget = (sql: SqlClient.SqlClient, appId: string) =>
  Effect.gen(function* () {
    const apps = yield* sql<{
      readonly created_by: string;
    }>`SELECT created_by FROM hq_app WHERE id::text = ${appId}`;
    const projects = yield* sql<{
      readonly project_id: string;
    }>`SELECT project_id FROM hq_app_project WHERE app_id::text = ${appId}`;
    return appTarget(projects, apps[0]?.created_by);
  });

/** Slot and release verdicts come from environment rows; devstage remains a Mate placement. */
export interface EnvironmentSlots {
  readonly productionTarget?: "zerops" | "git";
  readonly stageProjectIds: ReadonlyArray<string>;
  readonly productionProjectId: string | null;
}
export const environmentSlots = (
  environments: ReadonlyArray<{
    readonly project_id: string | null;
    readonly tier: string;
    readonly target?: string;
  }>,
): EnvironmentSlots => {
  const production = environments.find((row) => row.tier === "production");
  return {
    stageProjectIds: environments
      .filter((row) => row.tier === "stage" && row.project_id !== null)
      .map((row) => row.project_id!),
    productionProjectId: production?.project_id ?? null,
    ...(production?.target === "git" ? { productionTarget: "git" as const } : {}),
  };
};
export const readEnvironmentSlots = (sql: SqlClient.SqlClient, appId: string) =>
  Effect.map(
    sql<{ readonly project_id: string | null; readonly tier: string; readonly target: string }>`
    SELECT project_id, tier, target FROM hq_environment WHERE app_id::text = ${appId}`,
    environmentSlots,
  );
export const environmentSlotTaken = (
  tier: "stage" | "production",
  projects: ReadonlyArray<AppProjectRow>,
  slots: EnvironmentSlots,
  facts: Facts,
): boolean => {
  if (tier === "production" && slots.productionTarget === "git") return true;
  const projectIds =
    tier === "production"
      ? slots.productionProjectId === null
        ? []
        : [slots.productionProjectId]
      : [
          ...slots.stageProjectIds,
          ...projects.filter((row) => row.kind === "devstage").map((row) => row.project_id),
        ];
  return projectIds.some((id) => facts.projects.some((project) => project.id === id));
};

/** An application as a release takes it: its projects, and its production (`null`: none yet). */
export const releaseTarget = (
  projects: ReadonlyArray<AppProjectRow>,
  slots: EnvironmentSlots,
): ReleaseTarget => ({
  ...appTarget(projects),
  productionProjectId: slots.productionProjectId,
  ...(slots.productionTarget === undefined ? {} : { productionTarget: slots.productionTarget }),
});

/**
 * Whether to offer `verb`: `can` over the org as HQ last read it. The one place a writing verb is
 * asked over facts of any age — an offer writes nothing; its write takes facts read for it
 * (`Facts<WriteFreshness>`, whose type rule stands everywhere else).
 */
export const offer = <V extends Verb>(
  userId: string,
  verb: V,
  target: Targets[V],
  facts: Facts,
): Decision => can({ kind: "person", userId }, verb, target, facts as FactsFor<V>);

const decodeAttachment = Schema.decodeUnknownSync(HqEnvironmentAttachment);

const ORG_VERBS = ["create_app", "rename_app", "delete_app"] as const;

export type OrgVerb = (typeof ORG_VERBS)[number];

/** What the person may do with the organization's applications. */
export const orgOffers = (userId: string, facts: Facts): HqOffersOf<OrgVerb> =>
  Object.fromEntries(
    ORG_VERBS.map((verb) => [verb, offer(userId, verb, null, facts)]),
  ) as HqOffersOf<OrgVerb>;

/** The verbs of an application's changes and deploys, asked of all of its projects. */
const CHANGE_VERBS = ["read_change", "comment_change", "merge_change", "close_change"] as const;

export type AppVerb =
  | (typeof CHANGE_VERBS)[number]
  | HqGitTargetVerb
  | "redeploy"
  | "add_mate"
  | "release"
  | "add_stage"
  | "add_production";

/** The create flow's prospective project is owned by its creator; this is never write evidence. */
const newEnvironmentOffer = (
  userId: string,
  projects: ReadonlyArray<AppProjectRow>,
  facts: Facts,
  tier: "stage" | "production",
  slots: EnvironmentSlots,
): Decision => {
  const member = facts.members.find(
    (member) => member.userId === userId && member.status === "ACTIVE",
  );
  const writer = offer(userId, "create_app", null, facts);
  if (member === undefined) return writer;
  if (!writer.allow && !member.canCreateProjects) return writer;
  const slotTaken = environmentSlotTaken(tier, projects, slots, facts);
  const decision = offer(
    userId,
    "attach",
    {
      projectId: "",
      held: "none",
      to: tier,
      appProjectIds: appTarget(projects).projectIds,
      slotTaken,
    },
    {
      ...facts,
      projects: [
        ...facts.projects,
        { id: "", userRoles: [{ clientUserId: member.clientUserId, roleCode: "OWNER" }] },
      ],
    },
  );
  return decision.allow && slotTaken ? { allow: false, reason: "slot_taken" } : decision;
};
/** What the person may do with an application of `projects`. */
export const appOffers = (
  userId: string,
  projects: ReadonlyArray<AppProjectRow>,
  facts: Facts,
  slots: EnvironmentSlots,
  createdBy?: string,
): HqOffersOf<AppVerb> => ({
  add_mate: offer(userId, "add_mate", appTarget(projects, createdBy), facts),
  redeploy: offer(
    userId,
    "redeploy",
    {
      ...appTarget(projects),
      projectId: slots.productionTarget === "git" ? null : slots.productionProjectId,
    },
    facts,
  ),
  ...(Object.fromEntries(
    CHANGE_VERBS.map((verb) => [verb, offer(userId, verb, appTarget(projects), facts)]),
  ) as HqOffersOf<(typeof CHANGE_VERBS)[number]>),
  ...(Object.fromEntries(
    HQ_GIT_TARGET_VERBS.map((verb) => [verb, offer(userId, verb, appTarget(projects), facts)]),
  ) as HqOffersOf<HqGitTargetVerb>),
  release: offer(userId, "release", releaseTarget(projects, slots), facts),
  add_stage: newEnvironmentOffer(userId, projects, facts, "stage", slots),
  add_production: newEnvironmentOffer(userId, projects, facts, "production", slots),
});

/** Finishing a held environment reuses attach, independently of the create flow's empty slot. */
export const environmentSetupOffers = (
  userId: string,
  project: AppProjectRow,
  projects: ReadonlyArray<AppProjectRow>,
  facts: Facts,
): Partial<HqOffersOf<"finish">> => {
  const tier = project.kind === "devstage" ? "stage" : project.kind;
  if (tier !== "stage" && tier !== "production") return {};
  return {
    finish: offer(
      userId,
      "attach",
      {
        projectId: project.project_id,
        held: project.kind,
        to: tier,
        appProjectIds: appTarget(projects).projectIds,
        slotTaken: true,
      },
      facts,
    ),
  };
};

/** What the person may do with the environment of `projectId`. */
export const environmentOffers = (
  userId: string,
  projectId: string,
  facts: Facts,
): HqOffersOf<"keep_deploy_token" | "redeploy"> => ({
  redeploy: offer(userId, "redeploy", { projectIds: [projectId], projectId }, facts),
  keep_deploy_token: offer(userId, "keep_deploy_token", { projectId }, facts),
});

/** Git targets reuse the same application write verdicts as their fresh owners. */
export const gitEnvironmentRemovalOffer = (
  userId: string,
  projects: ReadonlyArray<Pick<AppProjectRow, "project_id">>,
  facts: Facts,
  tier: "stage" | "production",
) =>
  offer(
    userId,
    tier === "production" ? "add_git_environment" : "remove_git_environment",
    appTarget(projects),
    facts,
  );

export const gitEnvironmentOffers = (
  userId: string,
  projects: ReadonlyArray<AppProjectRow>,
  facts: Facts,
  tier: "stage" | "production",
) => ({
  keep_deploy_token: { allow: false as const, reason: "unknown_kind" as const },
  remove_git_environment: gitEnvironmentRemovalOffer(userId, projects, facts, tier),
  redeploy: offer(userId, "redeploy", { ...appTarget(projects), projectId: null }, facts),
});

/** A project placed into an application of `appProjects` as `to`: what a move is decided on. */
export const moveTarget = (
  projectId: string,
  held: Held,
  to: string,
  appProjects: ReadonlyArray<Pick<AppProjectRow, "project_id">>,
  appCreatedBy?: string,
): PlacementTarget => ({
  projectId,
  held,
  to,
  appProjectIds: appTarget(appProjects).projectIds,
  appCreatedBy,
});

/**
 * Whether moving `projectId` into an application of `appProjects` as `to` takes a production's
 * place another production Zerops still has (`facts`) holds: an application has one production
 * (`hq_app_one_production`), and only one Zerops no longer has makes room. The move refuses it
 * (`production_taken`), and is never offered it.
 */
export const productionTaken = (
  projectId: string,
  to: string,
  slots: EnvironmentSlots,
  facts: Facts,
): boolean =>
  to === "production" &&
  slots.productionProjectId !== null &&
  slots.productionProjectId !== projectId &&
  facts.projects.some((project) => project.id === slots.productionProjectId);

export type MateVerb = "observe_mate" | "edit_mate_record" | "detach";

/** What the person may do with the Mate of `projectId`, held as `held`. */
export const mateOffers = (
  userId: string,
  projectId: string,
  held: Held,
  facts: Facts,
): HqOffersOf<MateVerb> => ({
  observe_mate: offer(userId, "observe_mate", { projectId }, facts),
  edit_mate_record: offer(userId, "edit_mate_record", { projectId, held }, facts),
  detach: offer(userId, "detach", { projectId, held }, facts),
});

const KINDS: ReadonlyArray<RoleProjectKind> = ["mate", "devstage", "stage", "production"];

/**
 * Where a Mate may be moved, by the write's own rule: each application by id — and `new`, one the
 * person makes for it — with the kinds it may take there, none where it may take none. A Mate kind
 * only for a Mate HQ holds a record of (`mate_record_missing`); a production only where no other
 * production holds the place (`productionTaken`).
 */
export const moveDestinations = (
  userId: string,
  mate: { readonly projectId: string; readonly held: Held; readonly recorded: boolean },
  apps: ReadonlyArray<{
    readonly id: string;
    readonly projects: ReadonlyArray<AppProjectRow>;
    readonly slots: EnvironmentSlots;
    readonly createdBy?: string;
  }>,
  facts: Facts,
): {
  readonly moveTo: Readonly<Record<string, ReadonlyArray<RoleProjectKind>>>;
  readonly refused: Readonly<Record<string, Readonly<Record<string, string>>>>;
} => {
  const into = [
    ...apps,
    {
      id: "new",
      createdBy: userId,
      projects: [],
      slots: { stageProjectIds: [], productionProjectId: null },
    },
  ];
  const refused: Record<string, Record<string, string>> = {};
  const moveTo: Record<string, RoleProjectKind[]> = {};
  for (const { id, projects, slots, createdBy } of into) {
    const reasons: Record<string, string> = {};
    const kinds: RoleProjectKind[] = [];
    for (const kind of KINDS) {
      const decision =
        id === "new" && !offer(userId, "create_app", null, facts).allow
          ? offer(userId, "create_app", null, facts)
          : offer(
              userId,
              "move",
              moveTarget(mate.projectId, mate.held, kind, projects, createdBy),
              facts,
            );
      const reason = !decision.allow
        ? decision.reason
        : !mate.recorded && isMateKind(kind)
          ? "mate_record_missing"
          : productionTaken(mate.projectId, kind, slots, facts)
            ? "production_taken"
            : isMateKind(mate.held) !== isMateKind(kind)
              ? "class_move_receipt_required"
              : undefined;
      if (reason === undefined) kinds.push(kind);
      else reasons[kind] = reason;
    }
    if (kinds.length > 0) moveTo[id] = kinds;
    if (Object.keys(reasons).length > 0) refused[id] = reasons;
  }
  return { moveTo, refused };
};

/** Whether the person may write the record of a Mate on `projectId`, which HQ holds nowhere. */
export const recordOffers = (
  userId: string,
  projectId: string,
  facts: Facts,
): HqOffersOf<"create_mate_record"> => ({
  create_mate_record: offer(userId, "create_mate_record", { projectId, held: "none" }, facts),
});

/** The attachment stamp is the destination identity, including ABA remove/add of the same id. */
export interface ProductionAttachmentRow {
  readonly id: string | null;
  readonly created_at: string | null;
  readonly target: "zerops" | "git" | null;
  readonly project_id: string | null;
  readonly branch: string | null;
  readonly delivery: "direct" | null;
}
export const productionAttachmentOf = (
  row: ProductionAttachmentRow | undefined,
): HqEnvironmentAttachment | undefined =>
  row?.id == null
    ? undefined
    : decodeAttachment({
        environmentId: row.id,
        createdAt: row.created_at,
        target:
          row.target === "git"
            ? { kind: "git", branch: row.branch!, delivery: row.delivery! }
            : { kind: "zerops", projectId: row.project_id! },
      });
export const readProductionAttachment = (sql: SqlClient.SqlClient, appId: string, lock = false) =>
  Effect.map(
    sql<ProductionAttachmentRow>`SELECT id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
    target,project_id,branch,delivery FROM hq_environment WHERE app_id::text=${appId} AND tier='production'
    ${lock ? sql`FOR UPDATE` : sql``}`,
    ([row]) => productionAttachmentOf(row),
  );

/** Git release units are connected code repositories; the recipe is never a Git release unit. */
export const gitReleaseRoster = <A extends { readonly name: string; readonly connected: boolean }>(
  repos: ReadonlyArray<A>,
) => repos.filter((repo) => repo.name !== RECIPE_REPO && repo.connected);

/** One acceptance/navigation blocker; ended unresolved receipts still need their next actor. */
export const readGitReleaseBlocker = (
  sql: SqlClient.SqlClient,
  appId: string,
  attachment: HqEnvironmentAttachment,
) =>
  Effect.map(
    sql<{ tag: string | null }>`SELECT r.tag FROM hq_rollout r
    WHERE r.app_id::text=${appId} AND r.cause='release'
      AND (r.environment_id IS NULL OR (r.environment_id=${attachment.environmentId}
        AND r.environment_created_at=${attachment.createdAt}::timestamptz))
      AND (r.planned_at IS NULL OR EXISTS (SELECT 1 FROM hq_deploy_job j
        WHERE j.rollout_id=r.id AND j.environment_id=${attachment.environmentId}
          AND (j.ended_at IS NULL OR j.state='unresolved' OR j.evidence->>'phase'='recovering')))
    UNION ALL SELECT label AS tag FROM hq_deploy_job WHERE environment_id=${attachment.environmentId}
      AND (state='unresolved' OR evidence->>'phase'='recovering') LIMIT 1`,
    ([row]) =>
      row === undefined
        ? undefined
        : row.tag === null
          ? "The last production hand-over needs to be settled."
          : `Releasing ${row.tag}…`,
  );
