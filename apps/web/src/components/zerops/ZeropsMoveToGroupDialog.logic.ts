/**
 * Moving a project into a group, or out of one — the decision without React.
 *
 * The answer is where HQ is asked to place the project: an application that exists, a new one
 * by its name (HQ makes it, and names its id), or none — which leaves the project ungrouped. Only
 * what HQ offers this person is drawn (`moveChoices`, from HQ's `moveTo` and `detach`): a choice HQ
 * would refuse is no choice.
 */

import { kindOfRole, type ZeropsEnvironmentRole } from "@t3tools/client-runtime/zerops";
import type { HqMoveTo } from "@t3tools/shared/hqOffers";

/** An application, as the person sees it. */
export interface MoveApp {
  readonly id: string;
  readonly name: string;
}

/** An application the project may go into, as the roles it may take there. */
export interface MoveGroupChoice {
  readonly id: string;
  readonly name: string;
  readonly roles: ReadonlyArray<ZeropsEnvironmentRole>;
}

/** Where this person may place the project, as HQ offers it. */
export interface MoveChoices {
  readonly apps: ReadonlyArray<MoveGroupChoice>;
  /** The roles it may take in a new application; none where they may not make one. */
  readonly newApp: ReadonlyArray<ZeropsEnvironmentRole>;
  /** Whether it may leave its application. */
  readonly none: boolean;
}

const MOVE_ROLES: ReadonlyArray<ZeropsEnvironmentRole> = ["dev", "stage", "prod"];

/**
 * Each application with the roles the project may take there, a new one's where the person may
 * make it, and whether it may leave — as HQ offers them: its `moveTo` (none while HQ has not said,
 * or does not answer) and its `detach`.
 */
export function moveChoices(input: {
  readonly moveTo: HqMoveTo | undefined;
  /** Whether HQ offers it leaving its application (`detach`). */
  readonly detach: boolean;
  readonly apps: ReadonlyArray<MoveApp>;
}): MoveChoices {
  const rolesInto = (target: string) =>
    MOVE_ROLES.filter((role) => input.moveTo?.[target]?.includes(kindOfRole(role)) === true);
  return {
    apps: input.apps.flatMap((app) => {
      const roles = rolesInto(app.id);
      return roles.length === 0 ? [] : [{ id: app.id, name: app.name, roles }];
    }),
    newApp: rolesInto("new"),
    none: input.detach,
  };
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

/** The roles the project may take at `target`: an application's, a new one's; none out of all. */
export function moveRolesFor(
  choices: MoveChoices,
  target: string,
): ReadonlyArray<ZeropsEnvironmentRole> {
  if (target === "new") return choices.newApp;
  return choices.apps.find((app) => app.id === target)?.roles ?? [];
}

/** `role` where the project may take it at `target`; else the first role it may take there. */
export function roleWithin(
  choices: MoveChoices,
  target: string,
  role: ZeropsEnvironmentRole | "" | undefined,
): ZeropsEnvironmentRole | "" {
  const roles = moveRolesFor(choices, target);
  return role !== undefined && role !== "" && roles.includes(role) ? role : (roles[0] ?? "");
}

/** What the form opens on: where the project is and as what, where that may be chosen; else the first choice. */
export function initialMoveForm(
  choices: MoveChoices,
  current: {
    readonly groupId: string | undefined;
    readonly role: ZeropsEnvironmentRole | undefined;
  },
): MoveForm {
  const targets = [
    ...choices.apps.map((app) => app.id),
    ...(choices.newApp.length > 0 ? ["new"] : []),
    ...(choices.none ? ["none"] : []),
  ];
  const target =
    current.groupId !== undefined && targets.includes(current.groupId)
      ? current.groupId
      : (targets[0] ?? "none");
  return { target, newGroupName: "", role: roleWithin(choices, target, current.role) };
}

export function validateMoveForm(form: MoveForm): MoveFormErrors {
  const errors: { newGroupName?: string; role?: string } = {};
  if (form.target === "none") return errors;
  if (form.target === "new" && form.newGroupName.trim().length === 0) {
    errors.newGroupName = "Give the project a name.";
  }
  if (form.role === "") errors.role = "Say what this environment is for.";
  return errors;
}

export function resolveMoveMembership(
  form: MoveForm,
  choices?: MoveChoices,
): MoveMembership | undefined {
  const errors = validateMoveForm(form);
  if (errors.newGroupName !== undefined || errors.role !== undefined) return undefined;
  if (
    choices !== undefined &&
    (form.target === "none"
      ? !choices.none
      : form.role === "" || !moveRolesFor(choices, form.target).includes(form.role))
  )
    return undefined;
  if (form.target === "none" || form.role === "") return { kind: "none" };
  if (form.target === "new") {
    return { kind: "new", name: form.newGroupName.trim(), role: form.role };
  }
  return { kind: "group", appId: form.target, role: form.role };
}
