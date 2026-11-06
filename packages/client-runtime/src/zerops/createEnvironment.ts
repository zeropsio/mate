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
 * user's own token. Production reserves its project and access only: its
 * services arrive with an approved release. Other environments use a tier read
 * from the group repo (`recipeTier.ts`).
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
import { type ProjectGrant, withProjectGrant } from "./projectAccess.ts";
import { withZeropsMateTag, type ZeropsEnvironmentRole } from "./groups.ts";
import {
  deployTargetTier,
  hasProjectBlock,
  recipeProjectImportYaml,
  recipeServicesYaml,
  mateTier,
  recipeTierZcpServices,
  type MateTier,
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
  | {
      readonly kind: "tier";
      readonly tier: RecipeTier;
      readonly revision: string;
      readonly yaml: string;
    }
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
  /** Who reaches it beyond their organization role, as its creator chose (`projectAccess.ts`). */
  readonly userRoles?: ReadonlyArray<ProjectGrant>;
  /**
   * The membership a Mate's project marks its owner (`OWNER`), where `ownerAtAdd` names its
   * creator: sent with its project (ZEROPS-074). No environment without an agent is marked.
   */
  readonly owner?: string;
}

export type EnvironmentCreationStep =
  /** `POST /client/{clientId}/project`, born with its one tag where it gets an agent. */
  | {
      readonly kind: "create-project";
      readonly name: string;
      readonly tagList: ReadonlyArray<string>;
      readonly birth?: string;
      readonly location: string | undefined;
      /** Who reaches it from birth, sent with the project. */
      readonly userRoles?: ReadonlyArray<ProjectGrant>;
    }
  /**
   * A Mate's birth import, one `POST /project/{id}/service-stack/import`: the zcp that carries the
   * agent, holding the key the person mints for it on its own project, first by `priority`, and its
   * tier beside it, every service isolated but to the container (`api.ts`,
   * `importDevelopmentContainer`; `mateBirthImportYaml`).
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
      /** The tier it imports beside the container (`mateTier`); absent for a Mate alone. */
      readonly tier?: MateTier;
    }
  /**
   * The environment's registration in the organization's HQ: a Mate's record
   * in its application, and for a stage or a production its attachment and its
   * deploy key. Each write is safe to make again.
   */
  | { readonly kind: "register" }
  /**
   * `POST /project/{id}/service-stack/import` with a stage's tier,
   * whole, services only, converted for the platform
   * (`deployTargetTier`). A stage without a Mate only.
   */
  | {
      readonly kind: "import-recipe";
      readonly role: ZeropsEnvironmentRole;
      readonly yaml: string;
    }
  /**
   * `POST /client/{clientId}/project/import` — the project *and* its services
   * from one document, taken when a stage's recipe carries a `project:` block.
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
      /** Who reaches it, given once Zerops made it: an import document has no room for them. */
      readonly userRoles?: ReadonlyArray<ProjectGrant>;
    }
  /**
   * The services up, as the account's services listing pushes them; a Mate's is handed to its
   * coming-up view. Measured at ~2 minutes for a two-service recipe.
   */
  | { readonly kind: "await-ready"; readonly withAgent: boolean };

export type EnvironmentCreationPlan =
  | { readonly ok: true; readonly steps: ReadonlyArray<EnvironmentCreationStep> }
  | { readonly ok: false; readonly reason: string };

/**
 * The ordered platform calls that stand up one environment, or the reason
 * there are none.
 *
 * Order is not arbitrary. Where the project belongs is HQ's record: a Mate's
 * project is created under the birth intent HQ already holds (`birth`), and the
 * press registers every environment in its application. The one tag it is born
 * with, where it gets an agent, is the Zerops GUI's `mate` marker, which
 * nothing here reads.
 *
 * A Mate's birth is three steps: its project, created with its creator's `OWNER` override
 * (ZEROPS-074); its registration in its application at HQ, which authorizes its key; and one import
 * of its container, holding that key, and its whole tier (`mateBirthImportYaml`). The import states
 * what used to be steps of their own: the container first by `priority`, so its build queues
 * behind no service (the add of 2026-09-30), and every service isolated but to the container from
 * its creation, so nothing restarts to close the project off. Zerops finishes the import whether
 * the browser stays or not.
 *
 * A stage without an agent takes its tier whole, as one import (`deployTargetTier`). Production
 * imports no services here.
 */
export function planEnvironmentCreation(input: EnvironmentCreationInput): EnvironmentCreationPlan {
  const name = input.name.trim();
  if (name.length === 0) return { ok: false, reason: "An environment needs a name." };

  const access =
    input.userRoles === undefined || input.userRoles.length === 0
      ? {}
      : { userRoles: input.userRoles };
  // Production birth reserves the project and access only. Even a bundled recipe or an explicit
  // agent request must leave every service to an approved release, without waiting on services.
  if (input.role === "prod") {
    return {
      ok: true,
      steps: [
        {
          kind: "create-project",
          name,
          tagList: [],
          location: input.location,
          ...(input.birth === undefined ? {} : { birth: input.birth }),
          ...access,
        },
        { kind: "register" },
      ],
    };
  }

  const withAgent = input.withAgent ?? defaultAgentForRole(input.role);
  const recipe = input.recipe ?? { kind: "none" };
  if (recipe.kind === "none" && !withAgent) {
    return {
      ok: false,
      reason: "An environment with neither an agent nor an application has nothing in it.",
    };
  }
  const birthTier = withAgent && recipe.kind === "tier" ? mateTier(recipe.yaml) : undefined;
  const whole = !withAgent && recipe.kind === "tier" ? deployTargetTier(recipe.yaml) : undefined;
  if (recipe.kind === "tier" && birthTier === undefined && whole === undefined)
    return { ok: false, reason: "This project has no recipe merged yet." };
  // A project holds one Mate (audit D2): the container is the press's, never the tier's too.
  const zcp = withAgent && recipe.kind === "tier" ? recipeTierZcpServices(recipe.yaml) : [];
  if (zcp.length > 0) {
    return {
      ok: false,
      reason: `This project's recipe declares a Zerops Control Plane (${zcp.join(", ")}). A Mate brings its own: take it out of the recipe, then try again.`,
    };
  }

  if (withAgent) {
    // The Zerops GUI's marker on a project with an agent; where it belongs is HQ's.
    const tagList = withZeropsMateTag([]);
    return {
      ok: true,
      steps: [
        {
          kind: "create-project",
          name,
          tagList,
          location: input.location,
          ...(input.birth === undefined ? {} : { birth: input.birth }),
          ...(input.owner === undefined
            ? access
            : { userRoles: withProjectGrant(input.userRoles ?? [], input.owner, "OWNER") }),
        },
        // Its record in its application before its container (F6b, 2026-10-03): a press that stops
        // after it leaves a Mate HQ holds there, which any browser finishes under its name.
        { kind: "register" },
        {
          kind: "import-container",
          agents: input.agents ?? [],
          ...(birthTier === undefined ? {} : { tier: birthTier }),
        },
        { kind: "await-ready", withAgent: true },
      ],
    };
  }

  // A recipe that describes a whole project creates one in a single call. Not
  // taken when the caller placed the environment in a region: the project
  // block has no location, and silently ignoring one would put the
  // environment somewhere the user did not ask for.
  const wholeProject =
    whole !== undefined && input.location === undefined && hasProjectBlock(whole);
  const steps: Array<EnvironmentCreationStep> =
    wholeProject && whole !== undefined
      ? [
          {
            kind: "import-project",
            name,
            tagList: [],
            ...(input.birth === undefined ? {} : { birth: input.birth }),
            yaml: recipeProjectImportYaml(whole, { name }),
            ...access,
          },
        ]
      : [
          {
            kind: "create-project",
            name,
            tagList: [],
            location: input.location,
            ...(input.birth === undefined ? {} : { birth: input.birth }),
            ...access,
          },
        ];
  // Into a project that exists: the platform refuses a project block there.
  if (whole !== undefined && !wholeProject) {
    steps.push({ kind: "import-recipe", role: input.role, yaml: recipeServicesYaml(whole) });
  }
  steps.push({ kind: "register" });
  // Last, and the only step that waits on anything: everything the person's rights are needed
  // for is done before it.
  steps.push({ kind: "await-ready", withAgent: false });

  return { ok: true, steps };
}

/**
 * A short, human label per step — the progress checklist the two-minute wait
 * needs. Kept beside the plan so a new step cannot be added without one.
 *
 * `subject` names what is made — "the stage", "production" — so its steps say
 * it, and its taking in by HQ is said as its project's (the run's stage read
 * "Creating it", "Adding it to HQ").
 */
export function environmentCreationStepLabel(
  step: EnvironmentCreationStep,
  { subject }: { readonly subject?: string | undefined } = {},
): string {
  switch (step.kind) {
    case "create-project":
    case "import-project":
      return subject === undefined ? "Creating it" : `Creating ${subject}`;
    case "import-container":
      return "Adding its Mate's computer and services";
    case "register":
      return subject === undefined ? "Adding it to HQ" : `Adding ${subject} to your project`;
    case "import-recipe":
      return "Adding its services";
    case "await-ready":
      return step.withAgent
        ? "Waiting for its Mate"
        : subject === undefined
          ? "Starting its services"
          : `Starting ${subject}'s services`;
  }
}
