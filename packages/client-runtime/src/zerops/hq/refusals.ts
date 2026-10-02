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

/**
 * HQ's own refusals — its structure's (`StructureRefused` in `apps/hq/src/structure.ts`) and its
 * changes' (`ChangeRefused` in `apps/hq/src/changes.ts`) — in words.
 */
const STRUCTURE_WORDS: Readonly<Record<string, string>> = {
  name_length: "A name has 1 to 100 characters.",
  hq_project: "HQ's own project belongs to no project.",
  mate_record_with_kind: "Only a Mate has a name and a face.",
  mate_record_missing: "HQ has no record of this Mate yet.",
  mate_record_exists: "This Mate is set up already.",
  nothing_to_change: "There is nothing to change.",
  app_name_taken: "Another project already has this name.",
  app_not_found: "That project is gone from HQ.",
  mate_not_found: "HQ has no such Mate.",
  placed_or_production_taken:
    "This Zerops project is in a project already, or that project has its production.",
  production_taken: "That project has its production already.",
  held_changed: "Somebody changed this project in HQ meanwhile. Try again.",
  // A Mate's changes (`@t3tools/shared/hqChanges`), as a person meets them.
  repo_not_found: "HQ has no such repository.",
  change_not_found: "HQ has no such change.",
  attachment_not_found: "HQ has no such picture.",
};

/** What anything asked of the organization's HQ says where its official HQ is not open here. */
export const HQ_NOT_OPEN = "This organization's HQ is not open here.";

const isPermissionReason = (reason: string): reason is Reason =>
  Object.hasOwn(PERMISSION_WORDS, reason);
const isMergeRefusal = (reason: string): reason is keyof typeof MERGE_WORDS =>
  Object.hasOwn(MERGE_WORDS, reason);

/** What HQ's refusal says to the person: its reason in words, else named by its reason or code. */
export function hqRefusalWords(refusal: {
  readonly code: string;
  readonly reason: string | undefined;
}): string {
  const { reason } = refusal;
  if (reason !== undefined) {
    if (isPermissionReason(reason)) return PERMISSION_WORDS[reason];
    if (isMergeRefusal(reason)) return MERGE_WORDS[reason];
    const words = STRUCTURE_WORDS[reason];
    if (words !== undefined) return words;
  }
  return `HQ refused this (${reason ?? refusal.code}).`;
}
