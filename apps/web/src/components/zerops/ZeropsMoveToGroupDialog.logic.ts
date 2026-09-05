/**
 * Moving a project into a group, or out of one — the decision without React.
 *
 * Membership is a wholesale write (`groups.ts`): the answer here is the
 * complete next membership, and "no group" is a valid answer that leaves the
 * project ungrouped with its agent's name intact.
 */

import type { ZeropsEnvironmentRole } from "@t3tools/client-runtime/zerops";

export interface MoveGroupChoice {
  readonly id: string;
  readonly name: string;
}

export interface MoveForm {
  /** An existing group id, `"new"`, or `"none"`. */
  readonly target: string;
  readonly newGroupName: string;
  readonly role: ZeropsEnvironmentRole | "";
}

export interface MoveFormErrors {
  readonly newGroupName?: string;
  readonly role?: string;
}

export type MoveMembership =
  | { readonly kind: "none" }
  | {
      readonly kind: "group";
      readonly groupId: string;
      readonly role: ZeropsEnvironmentRole;
      /** Set when the group is new, so the name travels with the first member. */
      readonly label?: string;
    };

export function validateMoveForm(form: MoveForm): MoveFormErrors {
  const errors: { newGroupName?: string; role?: string } = {};
  if (form.target === "none") return errors;
  if (form.target === "new" && form.newGroupName.trim().length === 0) {
    errors.newGroupName = "Give the group a name.";
  }
  if (form.role === "") errors.role = "Say what this environment is for.";
  return errors;
}

export function resolveMoveMembership(
  form: MoveForm,
  mintGroupId: () => string,
): MoveMembership | undefined {
  const errors = validateMoveForm(form);
  if (errors.newGroupName !== undefined || errors.role !== undefined) return undefined;
  if (form.target === "none" || form.role === "") return { kind: "none" };
  if (form.target === "new") {
    return {
      kind: "group",
      groupId: mintGroupId(),
      role: form.role,
      label: form.newGroupName.trim(),
    };
  }
  return { kind: "group", groupId: form.target, role: form.role };
}
