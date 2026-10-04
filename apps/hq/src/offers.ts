/**
 * What HQ offers a person, beside what its structure streams them (`@t3tools/shared/hqOffers`):
 * each verb decided by `can` over the very target its write is enforced with — the builders here,
 * which the writes call too — and over the org as HQ last read it (`Roles.view`). The write is
 * decided again at the press, over facts read for it, and its refusal wins.
 *
 * - **The organization**, once: making, renaming and deleting an application.
 * - **An application**: its changes' verbs, a deploy asked again, and a release.
 * - **An environment**: its deploy token handed to HQ.
 *
 * @module offers
 */
import type { HqOffersOf } from "@t3tools/shared/hqOffers";
import {
  type Decision,
  type Facts,
  type FactsFor,
  type ReleaseTarget,
  type Targets,
  type Verb,
  can,
} from "@t3tools/shared/zeropsPermissions";

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

export type AppVerb = (typeof CHANGE_VERBS)[number] | "release";

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
});

/** What the person may do with the environment of `projectId`. */
export const environmentOffers = (
  userId: string,
  projectId: string,
  facts: Facts,
): HqOffersOf<"keep_deploy_token"> => ({
  keep_deploy_token: offer(userId, "keep_deploy_token", { projectId }, facts),
});
