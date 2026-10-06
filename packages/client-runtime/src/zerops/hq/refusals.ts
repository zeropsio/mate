/**
 * HQ's refusals in the person's words. HQ answers a refusal with a code and, for its structure, a
 * reason (`apps/hq/src/api.ts`): a permission's (`@t3tools/shared/zeropsPermissions`'s `REASONS`,
 * every one of which has words here, or the type fails) or one of the structure's own. The words are
 * the client's; a reason this build has none for is named by itself.
 *
 * Pure (rule R1).
 *
 * @module hq/refusals
 */
import type { MERGE_REFUSALS } from "@t3tools/shared/hqChanges";
import type { HqOfferState } from "@t3tools/shared/hqOffers";
import type { ReleaseRefusal } from "@t3tools/shared/hqRelease";
import type { Reason } from "@t3tools/shared/zeropsPermissions";

/** Every permission's refusal, in words: a reason left out does not compile. */
const PERMISSION_WORDS: { readonly [R in Reason]: string } = {
  wrong_principal: "HQ takes this only from a person signed in to Zerops.",
  not_your_project: "A Mate speaks only for its own Zerops project.",
  not_active_member: "You are not an active member of this organization in Zerops.",
  unknown_kind:
    "HQ and this version of Mate do not know the same kinds of project, so this one is left as it is.",
  not_project_reader: "You have no access to this Zerops project.",
  not_mate_operator: "You need at least Basic user access to this Mate's Zerops project.",
  app_not_seen: "You have no access to that project.",
  not_structure_writer: "Only an owner or admin of the organization can do this.",
  not_project_admin: "You need Admin access to this Zerops project.",
  not_own_new_mate:
    "Only an owner or admin of the organization adds this here, or you, with a Mate you have just made.",
  kind_class_change:
    "Only an owner or admin of the organization turns a Mate into a stage or production, or back.",
  project_gone: "This Zerops project is gone.",
  held_as_environment: "This Zerops project is its project's stage or production, not a Mate.",
  not_a_mate: "HQ holds this Zerops project as no Mate.",
  mate_not_in_app: "This Mate is in no project in HQ yet.",
  unknown_change: "HQ has no such change.",
  not_your_change: "A Mate words only its own change.",
  not_your_app: "A Mate reaches only its own project's repositories.",
  changes_not_seen:
    "You need at least Basic user access to one of this project's Zerops projects to see its changes.",
  slot_taken:
    "This project has one of this kind already. Only an owner or admin of the organization replaces it.",
  not_app_developer:
    "You need at least Basic user access to one of this project's Zerops projects to do this.",
  not_recipe_repo: "Only the project's recipe lands by itself.",
  author_not_in_app: "Only a Mate of this project proposes its recipe.",
  recipe_empty: "This change changes nothing, so it was closed.",
  recipe_changes_files:
    "This change edits the project's recipe, so it waits for someone who develops the project to merge it.",
  no_production: "This project has no production yet.",
  not_releaser: "You need at least Basic user access to this project's production to release it.",
};

/**
 * Why HQ did not merge a change (`MERGE_REFUSALS`), in words: what stopped it, so the person knows
 * whether pressing again can help. A refusal left out does not compile.
 */
const MERGE_WORDS: { readonly [R in (typeof MERGE_REFUSALS)[number]]: string } = {
  head_moved: "Its Mate pushed to it since you opened it. Review it again.",
  conflict: "It no longer merges cleanly into main.",
  empty: "There is nothing in it that main does not have.",
  already_merged: "It is on main already.",
  unrelated: "It shares no history with main.",
  no_change: "Nothing was pushed to it yet.",
  main_moved: "Other changes kept landing on main meanwhile. Try again.",
  change_not_open: "This change is merged or closed already.",
};

/** HQ's code for a call Zerops refused HQ outright (`apps/hq/src/api.ts`): never retried. */
const ZEROPS_REFUSED = "zerops_refused";

type ZeropsRefusal = "unauthorized" | "forbidden" | "not_found" | "invalid";

/**
 * What Zerops said no to when it refused HQ itself, and who can change it: Zerops' reason, never
 * the person's permission. A reason left out does not compile.
 */
const ZEROPS_REFUSAL_WORDS: { readonly [R in ZeropsRefusal]: string } = {
  unauthorized:
    "Zerops no longer accepts HQ's access. An owner or admin of the organization sets HQ up again.",
  forbidden:
    "Zerops does not let HQ read this. An owner or admin of the organization checks HQ's access in Zerops.",
  not_found: "Zerops has no such project or service any more.",
  invalid: "Zerops did not accept HQ's request. Tell an owner or admin of the organization.",
};

const isZeropsRefusal = (reason: string): reason is ZeropsRefusal =>
  Object.hasOwn(ZEROPS_REFUSAL_WORDS, reason);

/**
 * Why HQ made no release or rollback (`RELEASE_REFUSALS`), in words: only a main that moved, or a
 * newer release, is helped by reviewing it again. A refusal left out does not compile.
 */
const RELEASE_WORDS: { readonly [R in ReleaseRefusal]: string } = {
  production_moved: "Production changed since the review. Open the review again.",
  group_moved: "Main moved since you opened this. Review it again.",
  no_group_main: "The project's recipe has nothing on main to tag yet.",
  tag_taken: "A release of this name was made meanwhile. Review it again.",
  tag_not_newer: "A newer release was made meanwhile. Review it again.",
  unknown_service: "It lists a service the project's production does not have.",
  entry_not_on_main: "It lists a commit that is not on main.",
  release_not_approved: "That release was refused, so production cannot go back to it.",
};

/**
 * HQ's own refusals — its structure's (`StructureRefused` in `apps/hq/src/structure.ts`) and its
 * changes' (`ChangeRefused` in `apps/hq/src/changes.ts`) — in words.
 */
const STRUCTURE_WORDS: Readonly<Record<string, string>> = {
  name_length: "A name has 1 to 100 characters.",
  face_length: "A face has at most 64 characters.",
  hq_project: "HQ's own project belongs to no project.",
  mate_record_with_kind: "Only a Mate has a face.",
  mate_record_missing: "HQ has no record of this Mate yet.",
  mate_record_exists: "This Mate is set up already.",
  app_name_taken: "Another project already has this name.",
  app_not_found: "That project is gone from HQ.",
  app_not_empty:
    "This project is no longer empty: a Mate, an environment or a change is in it now.",
  mate_not_found: "HQ has no such Mate.",
  placed_or_production_taken:
    "This Zerops project is in a project already, or that project has its production.",
  production_taken: "That project has its production already.",
  held_changed: "Somebody changed this project in HQ meanwhile. Try again.",
  // A Mate's changes (`@t3tools/shared/hqChanges`), as a person meets them.
  repo_not_found: "HQ has no such repository.",
  change_not_found: "HQ has no such change.",
  attachment_not_found: "HQ has no such picture.",
  commit_not_found: "HQ has no such commit.",
  // An application's recipe (`@t3tools/shared/hqRecipe`).
  recipe_too_large: "This project's recipe is too large to read here.",
  // An application's environments and their deploy keys (`apps/hq/src/environments.ts`).
  environment_with_kind: "Only a stage or a production is an environment.",
  environment_name_missing: "An environment needs a name.",
  environment_name_long: "An environment's name has at most 63 characters.",
  environment_name_invalid:
    "An environment's name starts with a letter and has only small letters, digits and dashes.",
  environment_name_taken: "This project has an environment of that name already.",
  environment_not_found: "HQ has no such environment.",
  deploy_token_refused: "Zerops did not accept this deploy key.",
  deploy_token_scope: "This deploy key reaches more than its own project.",
  // HQ keeps a deploy key only sealed under its own key (`apps/hq/src/deployKeys.ts`).
  no_key_secret:
    "HQ has no key to keep deploy keys with yet. Whoever runs this HQ sets its HQ_KEY_SECRET.",
  // A deploy asked again ("Run again", `apps/hq/src/deploys.ts`).
  deploy_not_found: "HQ has no such deploy.",
  deploy_superseded: "A newer deploy took this one's place.",
  deploy_running: "HQ is deploying it now.",
  service_not_declared: "The recipe declares no such service here.",
  // A release rolled back to (`apps/hq/src/releases.ts`).
  release_not_found: "HQ has no such release.",
};

/**
 * Why HQ did not enroll a Mate (`MateRefused` in `apps/hq/src/mateCredentials.ts`; zcp's
 * `~/.zcp/hq/outcome.json`), in words: what stands, and what the person can do — or that zcp tries
 * again on its own, which it does for every refusal but `not_this_projects_mate`.
 */
const ENROLLMENT_WORDS: Readonly<Record<string, string>> = {
  // Its record comes with its press: one that stopped before it wrote it, Finish setup writes it.
  not_a_mate: "HQ has no record of this Mate yet. Finish its setup from its menu.",
  project_not_in_org: "Its Zerops project is not in this HQ's organization.",
  project_gone: "Its Zerops project is gone.",
  // HQ reads zcp's proof off the project a moment later than zcp writes it.
  env_mismatch: "HQ could not check its Zerops project yet. It tries again on its own.",
  expired: "HQ could not check its Zerops project yet. It tries again on its own.",
  unknown_nonce: "HQ could not check its Zerops project yet. It tries again on its own.",
  // One Mate per project (audit D2): zcp stops asking once HQ names another as its project's Mate.
  not_this_projects_mate:
    "Another Zerops Control Plane in its project is the project's Mate, and a project holds one. Delete this one in Zerops, or delete the other and restart this one.",
};

/** HQ's refusal of a Mate's enrollment, in words; a code this build has none for is named. */
export function enrollmentRefusalWords(code: string | undefined): string {
  if (code === undefined) return "HQ refused it. It tries again on its own.";
  return ENROLLMENT_WORDS[code] ?? `HQ refused it (${code}). It tries again on its own.`;
}

/** Where zcp found no official HQ in the organization: an admin sets one up. */
export const NO_HQ_WORDS = "This organization has no HQ yet. Ask an admin to set it up.";

/**
 * What a write HQ refused says when Zerops did not answer the roles it is decided over
 * (`503 zerops_unanswered`): nothing was done, and pressing again may go through.
 */
export const ZEROPS_UNANSWERED = "Zerops is not answering, so HQ did nothing. Try again.";

/** What anything asked of the organization's HQ says where its official HQ is not open here. */
export const HQ_NOT_OPEN = "This organization's HQ is not open here.";

const isPermissionReason = (reason: string): reason is Reason =>
  Object.hasOwn(PERMISSION_WORDS, reason);
const isMergeRefusal = (reason: string): reason is keyof typeof MERGE_WORDS =>
  Object.hasOwn(MERGE_WORDS, reason);
const isReleaseRefusal = (reason: string): reason is ReleaseRefusal =>
  Object.hasOwn(RELEASE_WORDS, reason);

/** What HQ's refusal says to the person: its reason in words, else named by its reason or code. */
export function hqRefusalWords(refusal: {
  readonly code: string;
  readonly reason: string | undefined;
}): string {
  const { reason } = refusal;
  if (refusal.code === ZEROPS_REFUSED && reason !== undefined && isZeropsRefusal(reason)) {
    return ZEROPS_REFUSAL_WORDS[reason];
  }
  if (reason !== undefined) {
    if (isPermissionReason(reason)) return PERMISSION_WORDS[reason];
    if (isMergeRefusal(reason)) return MERGE_WORDS[reason];
    if (isReleaseRefusal(reason)) return RELEASE_WORDS[reason];
    const words = STRUCTURE_WORDS[reason];
    if (words !== undefined) return words;
  }
  return `HQ refused this (${reason ?? refusal.code}).`;
}

/** How a verb's state is worded: a wall time, and when Zerops answered HQ's view of the roles. */
interface OfferWording {
  readonly at: (ms: number) => string;
  readonly rolesAnsweredAt: string | null;
}

/**
 * What a control says beside a verb HQ does not offer (`hqOffer`): HQ's refusal, as of when Zerops
 * answered the roles it was decided over; that HQ has not said; since when HQ does not answer.
 * Nothing for an offered one. `at` words a wall time; nothing here compares one with now.
 */
export function hqOfferWords(
  state: Exclude<HqOfferState, { readonly kind: "allowed" }>,
  input: OfferWording,
): string;
export function hqOfferWords(state: HqOfferState, input: OfferWording): string | undefined;
export function hqOfferWords(state: HqOfferState, input: OfferWording): string | undefined {
  switch (state.kind) {
    case "allowed":
      return undefined;
    case "refused": {
      const words = hqRefusalWords({ code: "forbidden", reason: state.reason });
      const answered = input.rolesAnsweredAt === null ? NaN : Date.parse(input.rolesAnsweredAt);
      return Number.isNaN(answered) ? words : `${words} Zerops roles as of ${input.at(answered)}.`;
    }
    case "unknown":
      return "HQ has not said yet.";
    case "unavailable":
      return `HQ unavailable since ${input.at(state.since)}.`;
  }
}
