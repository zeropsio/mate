/**
 * The wire contract of HQ's permission rule (`can`, `apps/hq/src/permissions.ts`, which HQ alone
 * runs): every reason a refusal names, and a decision's shape. HQ answers a refused write with its
 * reason, and streams what it offers each reader as decisions (`hqOffers.ts`); the client words
 * each reason (`hq/refusals.ts`) and decides none.
 *
 * @module zeropsPermissions
 */
export const REASONS = [
  "wrong_principal",
  "not_your_project",
  "not_active_member",
  "unknown_kind",
  "not_project_reader",
  "not_mate_operator",
  "app_not_seen",
  "not_structure_writer",
  "not_project_admin",
  "not_own_new_mate",
  "kind_class_change",
  "project_gone",
  "held_as_environment",
  "not_a_mate",
  "mate_not_in_app",
  "unknown_change",
  "not_your_change",
  "not_your_app",
  "changes_not_seen",
  "slot_taken",
  "not_app_developer",
  "not_recipe_repo",
  "author_not_in_app",
  "recipe_empty",
  "recipe_changes_files",
  "no_production",
  "not_releaser",
] as const;

export type Reason = (typeof REASONS)[number];

export type Decision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: Reason };
