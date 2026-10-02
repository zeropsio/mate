/**
 * Moving a project into a group, or out of one — the decision without React.
 *
 * The answer is where HQ is asked to place the project: an application that exists, a new one
 * by its name (HQ makes it, and names its id), or none — which leaves the project ungrouped.
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
  | { readonly kind: "group"; readonly appId: string; readonly role: ZeropsEnvironmentRole }
  | { readonly kind: "new"; readonly name: string; readonly role: ZeropsEnvironmentRole };

export function validateMoveForm(form: MoveForm): MoveFormErrors {
  const errors: { newGroupName?: string; role?: string } = {};
  if (form.target === "none") return errors;
  if (form.target === "new" && form.newGroupName.trim().length === 0) {
    errors.newGroupName = "Give the group a name.";
  }
  if (form.role === "") errors.role = "Say what this environment is for.";
  return errors;
}

export function resolveMoveMembership(form: MoveForm): MoveMembership | undefined {
  const errors = validateMoveForm(form);
  if (errors.newGroupName !== undefined || errors.role !== undefined) return undefined;
  if (form.target === "none" || form.role === "") return { kind: "none" };
  if (form.target === "new") {
    return { kind: "new", name: form.newGroupName.trim(), role: form.role };
  }
  return { kind: "group", appId: form.target, role: form.role };
}
