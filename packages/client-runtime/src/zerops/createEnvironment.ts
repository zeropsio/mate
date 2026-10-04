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
 * user's own token, over a tier read from the group repo (`recipeTier.ts`) —
 * which is why a group can create its production environment while every one
 * of its dev environments is switched off, and why deleting any member breaks
 * nothing.
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

import type { ZeropsAgentType } from "./newProject.ts";
import { withZeropsMateTag, type ZeropsEnvironmentRole } from "./groups.ts";
import {
  deployTargetTier,
  hasProjectBlock,
  recipeProjectImportYaml,
  recipeServicesYaml,
  recipeTierZcpServices,
  splitRecipeTier,
  type RecipeRuntimes,
  type RecipeTier,
} from "./recipeTier.ts";

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
  // A stage is a deploy target, as its form's note says; an agent there is
  // the person's decision, like production's. A dev environment, on its own
  // or with its stage half, is a Mate by default.
  return role === "dev" || role === "devstage";
}

/**
 * Where the new environment's application comes from.
 *
 * - `tier`: a tier of the group repo, as `main` holds it. The plan converts it
 *   for the platform (`recipeTier.ts`).
 * - `none`: no application yet. The agent is the first thing in the
 *   environment and sets the rest up — which is the whole point of having one.
 *
 * There is no third option any more. The group repo is the one place a
 * group's shape is written down (D13); cloning a sibling's export carried
 * service shapes without their build setup, so it produced environments that
 * looked created and could not build.
 */
export type EnvironmentRecipeChoice =
  | { readonly kind: "tier"; readonly tier: RecipeTier; readonly yaml: string }
  | { readonly kind: "none" };

export interface EnvironmentCreationInput {
  readonly clientId: string;
  readonly role: ZeropsEnvironmentRole;
  /** What this environment is called, e.g. `"Beviro CRM - production"`. */
  readonly name: string;
  /** Defaults to an empty environment with an agent in it. */
  readonly recipe?: EnvironmentRecipeChoice;
  readonly location?: string;
  /** Overrides {@link defaultAgentForRole}. */
  readonly withAgent?: boolean;
  /**
   * The coding agents the new container offers, normally the ones this
   * group's existing environments are signed in with (`agentSelection.ts`).
   * Omitted or empty leaves the container offering every agent.
   */
  readonly agents?: ReadonlyArray<ZeropsAgentType>;
  /**
   * The birth intent HQ holds of the Mate (`recordBirth`), recorded before its project: the
   * project handle is bound to it at HQ before its attach.
   */
  readonly birth?: string;
}

export type EnvironmentCreationStep =
  /** `POST /client/{clientId}/project`, tags included so it is never briefly ungrouped. */
  | {
      readonly kind: "create-project";
      readonly name: string;
      readonly tagList: ReadonlyArray<string>;
      readonly birth?: string;
      readonly location: string | undefined;
    }
  /**
   * `PUT /project/{id}/first-class-recipe/development-container` — the zcp
   * that carries the agent, holding the key the person mints for it on its
   * own project (`api.ts`, `importDevelopmentContainer`), and the tier's
   * runtimes for zcp to import on its first boot (`MATE_SETUP_RUNTIMES`).
   *
   * `agents` is the group's own selection, so a Mate added to a group comes up
   * offering what that group signed in with rather than the platform's whole
   * menu. Empty means the group has authorized nothing yet, and the import
   * document then omits `ZCP_AGENTS` entirely — absent offers every agent,
   * empty offers none (MC-11).
   */
  | {
      readonly kind: "import-container";
      readonly agents: ReadonlyArray<ZeropsAgentType>;
      /** The tier's runtimes, in one wave (`splitRecipeTier`); absent when it has none. */
      readonly runtimes?: RecipeRuntimes;
    }
  /**
   * The project closed off and marked so at HQ (`markClosedOff`): read back at
   * once — the container recipe leaves it `service service@zcp` within a
   * second of the import, and a new project starts `service` — and written
   * `service` only where it reads anything else (`projectIsolation.ts`). zcp
   * imports the runtimes on the mark alone, so no service the project runs
   * ever reads another's variables, the Mate's key among them.
   */
  | {
      readonly kind: "close-off";
      /**
       * The press has just isolated the project itself (`hardenMate`): the step trusts that and
       * reads no trailing index to isolate it again.
       */
      readonly isolated?: true;
    }
  /**
   * The environment's registration in the organization's HQ: a Mate's record
   * in its application, and for a stage or a production its attachment and its
   * deploy key. Each write is safe to make again.
   */
  | { readonly kind: "register" }
  /**
   * `POST /project/{id}/service-stack/import` with a stage's or a
   * production's tier, whole, services only, converted for the platform
   * (`deployTargetTier`).
   */
  | {
      readonly kind: "import-recipe";
      readonly role: ZeropsEnvironmentRole;
      readonly yaml: string;
    }
  /**
   * `POST /project/{id}/service-stack/import` with a Mate's managed services
   * alone, into the project `create-project` made — the second half of what
   * `import-project` does in one call for a tier that describes its project.
   */
  | { readonly kind: "import-managed"; readonly yaml: string }
  /**
   * `POST /client/{clientId}/project/import` — the project *and* its services
   * from one document, taken when the recipe carries a `project:` block.
   *
   * Preferred over create-then-import because stripping that block drops its
   * `envVariables`, and a published tier puts real things there (`APP_KEY` in
   * every Laravel recipe). They cannot be written back afterwards either: the
   * values are preprocessor directives the platform evaluates on the way in.
   * `recipeProjectImportYaml` has already put this environment's name and tags
   * into the document, so it is tagged at birth like the other path.
   */
  | {
      readonly kind: "import-project";
      readonly name: string;
      readonly tagList: ReadonlyArray<string>;
      readonly birth?: string;
      readonly yaml: string;
    }
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
 * The container is imported before the application's runtimes: it is the part
 * the user can start talking to, and on the roles that get one it is what
 * narrates the rest. When the recipe import fails, that agent is the thing
 * that fixes it — which is the whole reason mate does not try to be clever
 * here.
 *
 * An environment with an agent takes its tier in two imports
 * (`splitRecipeTier`). The project goes in with its managed services alone —
 * its variables and generated secrets evaluated there and nowhere else — and
 * then the container, holding its key and the runtimes for zcp to import on
 * its first boot (`MATE_SETUP_RUNTIMES`) — registered in its application before it — and the
 * press then closes the project off, so nothing after it needs this browser. Measured on
 * the add of 2026-09-30, the whole tier in one import cost the container's
 * build a queue behind the services' priority waves, and closing off
 * afterwards restarted nine services, a storage's restart failing: closed off
 * before any runtime exists, it restarts nothing.
 *
 * An environment without one — a stage, a production — has nothing to close
 * off, and takes its tier whole, as one import (`deployTargetTier`).
 */
export function planEnvironmentCreation(input: EnvironmentCreationInput): EnvironmentCreationPlan {
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, reason: "An environment needs a name." };

  const withAgent = input.withAgent ?? defaultAgentForRole(input.role);
  const recipe = input.recipe ?? { kind: "none" };
  if (recipe.kind === "none" && !withAgent) {
    return {
      ok: false,
      reason: "An environment with neither an agent nor an application has nothing in it.",
    };
  }
  const tier = recipe.kind === "tier" ? readTier(recipe.yaml, withAgent) : null;
  if (tier === undefined) return { ok: false, reason: "This project has no recipe merged yet." };
  // A project holds one Mate (audit D2): the container is the press's, never the tier's too.
  const zcp = withAgent && recipe.kind === "tier" ? recipeTierZcpServices(recipe.yaml) : [];
  if (zcp.length > 0) {
    return {
      ok: false,
      reason: `This project's recipe declares a Zerops Control Plane (${zcp.join(", ")}). A Mate brings its own: take it out of the recipe, then try again.`,
    };
  }

  // Membership first, then the name: naming is not a membership write, and
  // routing it through one clears the group (`groups.ts`).
  const tagList = withAgent ? withZeropsMateTag([]) : [];

  // A recipe that describes a whole project creates one in a single call. Not
  // taken when the caller placed the environment in a region: the project
  // block has no location, and silently ignoring one would put the
  // environment somewhere the user did not ask for.
  const wholeProject =
    tier !== null && input.location === undefined && hasProjectBlock(tier.withProject);

  const steps: Array<EnvironmentCreationStep> = wholeProject
    ? [
        {
          kind: "import-project",
          name,
          tagList,
          ...(input.birth === undefined ? {} : { birth: input.birth }),
          yaml: recipeProjectImportYaml(tier.withProject, { name, tagList }),
        },
      ]
    : [
        {
          kind: "create-project",
          name,
          tagList,
          location: input.location,
          ...(input.birth === undefined ? {} : { birth: input.birth }),
        },
      ];
  // Into a project that exists: the platform refuses a project block there,
  // and an import that names no service at all.
  if (tier !== null && !wholeProject && tier.firstImportHasServices) {
    const yaml = recipeServicesYaml(tier.withProject);
    steps.push(
      withAgent
        ? { kind: "import-managed", yaml }
        : { kind: "import-recipe", role: input.role, yaml },
    );
  }

  // Every environment is registered in the organization's HQ, which decides who may: an owner or
  // an admin, or a member attaching their own new Mate. A Mate's record in its application comes
  // before its container (F6b, 2026-10-03): a press that stops after it leaves a Mate HQ holds
  // there, which any browser finishes under its name. A registration HQ refuses stops the press.
  if (withAgent) steps.push({ kind: "register" });
  if (withAgent) {
    steps.push({
      kind: "import-container",
      agents: input.agents ?? [],
      ...(tier?.runtimes === undefined ? {} : { runtimes: tier.runtimes }),
    });
  }
  // The close-off after the container: it is what makes the Mate need no browser.
  if (withAgent) steps.push({ kind: "close-off" });
  if (!withAgent) steps.push({ kind: "register" });
  // Last, and the only step that waits on anything: everything the person's rights are needed
  // for is done before it.
  steps.push({ kind: "await-ready", withAgent });

  return { ok: true, steps };
}

/** A tier as the plan imports it; `undefined` when it declares no services. */
function readTier(
  yaml: string,
  withAgent: boolean,
):
  | {
      /** The first import's document, project block and all. */
      readonly withProject: string;
      readonly firstImportHasServices: boolean;
      /** What zcp imports on its first boot, once the press has closed the project off. */
      readonly runtimes: RecipeRuntimes | undefined;
    }
  | undefined {
  if (withAgent) {
    const split = splitRecipeTier(yaml);
    return split === undefined
      ? undefined
      : {
          withProject: split.managed,
          firstImportHasServices: split.managedServices.length > 0,
          runtimes: split.runtimes,
        };
  }
  const whole = deployTargetTier(yaml);
  return whole === undefined
    ? undefined
    : { withProject: whole, firstImportHasServices: true, runtimes: undefined };
}

/**
 * A short, human label per step — the progress checklist the two-minute wait
 * needs. Kept beside the plan so a new step cannot be added without one.
 */
export function environmentCreationStepLabel(step: EnvironmentCreationStep): string {
  switch (step.kind) {
    case "create-project":
    case "import-project":
      return "Creating the environment";
    case "import-container":
      return "Adding the agent container";
    case "close-off":
      return "Closing the project off";
    case "register":
      return "Registering it in its project";
    case "import-recipe":
      return "Importing the application";
    case "import-managed":
      return "Adding the managed services";
    case "await-ready":
      return step.withAgent ? "Waiting for the agent" : "Waiting for the services";
  }
}
