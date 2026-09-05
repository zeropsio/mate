/**
 * Creating an environment in a group — the "clone this environment" and
 * "give this group a production" button, as a plan.
 *
 * ## Why this replaces copying a container
 *
 * The obvious way to make a second environment is to reach into an existing
 * one and copy what it has. That is what makes a group need a master: some
 * member becomes the thing every other member is derived from, load-bearing
 * and undeletable.
 *
 * So nothing here reads a container. Every step is a platform call with the
 * user's own token, over data that came from the recipe store — which is why a
 * group can create its production environment while every one of its dev
 * environments is switched off, and why deleting any member breaks nothing.
 *
 * ## Pure, like `candidates.ts`
 *
 * This file decides; it does not act. It turns "clone environment X as
 * production" into an ordered list of platform calls, so the branching is
 * testable without a network and the UI can render the steps as progress —
 * which matters, because a real import took **2 minutes** end to end
 * (`verified.md`, 2026-09-05). A spinner is the wrong shape for that; a
 * checklist is the right one.
 *
 * @module createEnvironment
 */

import { withZeropsGroupTags, type ZeropsEnvironmentRole } from "./groups.ts";
import { canCreateEnvironment, type ZeropsGroupRecord } from "./recipeStore.ts";

/**
 * Whether a new environment gets a `zcp` container — and so an agent, and a
 * conversation — or is a deployment target mate only watches.
 *
 * The default is deliberate: `dev`, `devstage` and `stage` are places somebody
 * works, so they get one. `prod` does not. An agent with a shell in production
 * is a different product decision from anything settled so far, and a default
 * is the wrong way to make it — a caller that wants one has to say so.
 */
export function defaultAgentForRole(role: ZeropsEnvironmentRole): boolean {
  return role !== "prod";
}

export interface EnvironmentCreationInput {
  readonly clientId: string;
  readonly groupId: string;
  /** The group's display name, mirrored into the project's tags. */
  readonly groupName?: string;
  readonly role: ZeropsEnvironmentRole;
  /** What this environment is called, e.g. `"Beviro CRM - production"`. */
  readonly name: string;
  /** The group's store record — the source of the recipe. */
  readonly record: ZeropsGroupRecord | undefined;
  readonly location?: string;
  /** Overrides {@link defaultAgentForRole}. */
  readonly withAgent?: boolean;
}

export type EnvironmentCreationStep =
  /** `POST /client/{clientId}/project`, tags included so it is never briefly ungrouped. */
  | {
      readonly kind: "create-project";
      readonly name: string;
      readonly tagList: ReadonlyArray<string>;
      readonly location: string | undefined;
    }
  /** `PUT /project/{id}/first-class-recipe/development-container` — the zcp that carries the agent. */
  | { readonly kind: "import-container" }
  /** `POST /project/{id}/service-stack/import` with the group's recipe for this role. */
  | { readonly kind: "import-recipe"; readonly role: ZeropsEnvironmentRole; readonly yaml: string }
  /** Poll until the services are up. Measured at ~2 minutes for a two-service recipe. */
  | { readonly kind: "await-ready"; readonly withAgent: boolean };

export type EnvironmentCreationPlan =
  | { readonly ok: true; readonly steps: ReadonlyArray<EnvironmentCreationStep> }
  | { readonly ok: false; readonly reason: string };

/**
 * The ordered platform calls that stand up one environment, or the reason
 * there are none.
 *
 * Order is not arbitrary. The project is created **with its tags already on
 * it**, so it never exists as an untagged project that the group tree would
 * miss — and since the group tree is derived from the lag-free project list
 * rather than the trailing search index, the new environment appears in its
 * group immediately.
 *
 * The container is imported before the application: it is the part the user
 * can start talking to, and on the roles that get one it is what narrates the
 * rest. When the recipe import fails, that agent is the thing that fixes it —
 * which is the whole reason mate does not try to be clever here.
 */
export function planEnvironmentCreation(input: EnvironmentCreationInput): EnvironmentCreationPlan {
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, reason: "An environment needs a name." };

  const gate = canCreateEnvironment(input.record, input.role);
  if (!gate.allowed) return { ok: false, reason: gate.reason ?? "No recipe for this role." };

  // `canCreateEnvironment` already proved this is a non-blank string.
  const yaml = input.record?.recipes[input.role] ?? "";
  const withAgent = input.withAgent ?? defaultAgentForRole(input.role);

  const steps: Array<EnvironmentCreationStep> = [
    {
      kind: "create-project",
      name,
      tagList: withZeropsGroupTags([], {
        groupId: input.groupId,
        role: input.role,
        ...(input.groupName === undefined ? {} : { label: input.groupName }),
      }),
      location: input.location,
    },
  ];

  if (withAgent) steps.push({ kind: "import-container" });
  steps.push({ kind: "import-recipe", role: input.role, yaml });
  steps.push({ kind: "await-ready", withAgent });

  return { ok: true, steps };
}

/**
 * A short, human label per step — the progress checklist the two-minute wait
 * needs. Kept beside the plan so a new step cannot be added without one.
 */
export function environmentCreationStepLabel(step: EnvironmentCreationStep): string {
  switch (step.kind) {
    case "create-project":
      return "Creating the environment";
    case "import-container":
      return "Adding the agent container";
    case "import-recipe":
      return "Importing the application";
    case "await-ready":
      return step.withAgent ? "Waiting for the agent" : "Waiting for the services";
  }
}
