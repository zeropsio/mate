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
import type { HqOffersOf } from "@t3tools/shared/hqOffers";
import { type Decision } from "@t3tools/shared/zeropsPermissions";
import {
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
): { readonly projectIds: ReadonlyArray<string> } => ({
  projectIds: projects.map((row) => row.project_id),
});

/** An application as a release takes it: its projects, and its production (`null`: none yet). */
export const releaseTarget = (projects: ReadonlyArray<AppProjectRow>): ReleaseTarget => ({
  ...appTarget(projects),
  productionProjectId: projects.find((row) => row.kind === "production")?.project_id ?? null,
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

const ORG_VERBS = ["create_app", "rename_app", "delete_app"] as const;

export type OrgVerb = (typeof ORG_VERBS)[number];

/** What the person may do with the organization's applications. */
export const orgOffers = (userId: string, facts: Facts): HqOffersOf<OrgVerb> =>
  Object.fromEntries(
    ORG_VERBS.map((verb) => [verb, offer(userId, verb, null, facts)]),
  ) as HqOffersOf<OrgVerb>;

/** The verbs of an application's changes and deploys, asked of all of its projects. */
const CHANGE_VERBS = [
  "read_change",
  "comment_change",
  "merge_change",
  "close_change",
  "redeploy",
] as const;

export type AppVerb = (typeof CHANGE_VERBS)[number] | "release" | "add_stage" | "add_production";

/** The create flow's prospective project is owned by its creator; this is never write evidence. */
const newEnvironmentOffer = (
  userId: string,
  projects: ReadonlyArray<AppProjectRow>,
  facts: Facts,
  tier: "stage" | "production",
): Decision => {
  const member = facts.members.find(
    (member) => member.userId === userId && member.status === "ACTIVE",
  );
  const writer = offer(userId, "create_app", null, facts);
  if (member === undefined) return writer;
  if (!writer.allow && !member.canCreateProjects) return writer;
  const slotTaken = projects.some(
    (row) =>
      (row.kind === tier || (tier === "stage" && row.kind === "devstage")) &&
      facts.projects.some((project) => project.id === row.project_id),
  );
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
): HqOffersOf<AppVerb> => ({
  ...(Object.fromEntries(
    CHANGE_VERBS.map((verb) => [verb, offer(userId, verb, appTarget(projects), facts)]),
  ) as HqOffersOf<(typeof CHANGE_VERBS)[number]>),
  release: offer(userId, "release", releaseTarget(projects), facts),
  add_stage: newEnvironmentOffer(userId, projects, facts, "stage"),
  add_production: newEnvironmentOffer(userId, projects, facts, "production"),
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
): HqOffersOf<"keep_deploy_token"> => ({
  keep_deploy_token: offer(userId, "keep_deploy_token", { projectId }, facts),
});

/** A project placed into an application of `appProjects` as `to`: what a move is decided on. */
export const moveTarget = (
  projectId: string,
  held: Held,
  to: string,
  appProjects: ReadonlyArray<Pick<AppProjectRow, "project_id">>,
): PlacementTarget => ({ projectId, held, to, appProjectIds: appTarget(appProjects).projectIds });

/**
 * Whether moving `projectId` into an application of `appProjects` as `to` takes a production's
 * place another production Zerops still has (`facts`) holds: an application has one production
 * (`hq_app_one_production`), and only one Zerops no longer has makes room. The move refuses it
 * (`production_taken`), and is never offered it.
 */
export const productionTaken = (
  projectId: string,
  to: string,
  appProjects: ReadonlyArray<AppProjectRow>,
  facts: Facts,
): boolean =>
  to === "production" &&
  appProjects.some(
    (row) =>
      row.kind === "production" &&
      row.project_id !== projectId &&
      facts.projects.some((project) => project.id === row.project_id),
  );

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
  apps: ReadonlyArray<{ readonly id: string; readonly projects: ReadonlyArray<AppProjectRow> }>,
  facts: Facts,
): {
  readonly moveTo: Readonly<Record<string, ReadonlyArray<RoleProjectKind>>>;
  readonly refused: Readonly<Record<string, Readonly<Record<string, string>>>>;
} => {
  const into = [...apps.map((app) => [app.id, app.projects] as const), ["new", []] as const];
  const refused: Record<string, Record<string, string>> = {};
  const moveTo: Record<string, RoleProjectKind[]> = {};
  for (const [id, projects] of into) {
    const reasons: Record<string, string> = {};
    const kinds: RoleProjectKind[] = [];
    for (const kind of KINDS) {
      const decision =
        id === "new" && !offer(userId, "create_app", null, facts).allow
          ? offer(userId, "create_app", null, facts)
          : offer(userId, "move", moveTarget(mate.projectId, mate.held, kind, projects), facts);
      const reason = !decision.allow
        ? decision.reason
        : !mate.recorded && isMateKind(kind)
          ? "mate_record_missing"
          : productionTaken(mate.projectId, kind, projects, facts)
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
