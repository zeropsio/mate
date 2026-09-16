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

import type { ZeropsAgentType } from "./newProject.ts";
import {
  withZeropsBotTag,
  withZeropsGroupTags,
  withZeropsMateTag,
  type ZeropsEnvironmentRole,
} from "./groups.ts";
import {
  canCreateEnvironment,
  hasProjectBlock,
  recipeProjectImportYaml,
  type ZeropsGroupRecord,
} from "./recipeStore.ts";

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

/**
 * Where the new environment's application comes from.
 *
 * - `store`: the group's published recipe for this role (`recipeStore.ts`).
 * - `services`: services-only import YAML the caller already holds — today a
 *   sibling's export with its container and secrets stripped
 *   (`recipeExport.ts`); `source` names where it came from, for the record.
 * - `none`: no application yet. The agent is the first thing in the
 *   environment and sets the rest up — which is the whole point of having one.
 */
export type EnvironmentRecipeChoice =
  | { readonly kind: "store" }
  | {
      readonly kind: "services";
      readonly yaml: string;
      readonly source: string;
      /**
       * Services this YAML declares but cannot build: the export carries no
       * `zeropsSetup`, so they come up with nothing deployed
       * (`recipeExport.ts`). Carried through so the environment's opening
       * message can name them — it is the job the new Mate is created for.
       */
      readonly needsDeploy?: ReadonlyArray<string>;
    }
  | { readonly kind: "none" };

export interface EnvironmentCreationInput {
  readonly clientId: string;
  readonly groupId: string;
  /** The group's display name, mirrored into the project's tags. */
  readonly groupName?: string;
  readonly role: ZeropsEnvironmentRole;
  /** What this environment is called, e.g. `"Beviro CRM - production"`. */
  readonly name: string;
  /** The group's store record — the source of the recipe when `recipe` is `store`. */
  readonly record: ZeropsGroupRecord | undefined;
  /** Defaults to the store. */
  readonly recipe?: EnvironmentRecipeChoice;
  readonly location?: string;
  /** Overrides {@link defaultAgentForRole}. */
  readonly withAgent?: boolean;
  /**
   * The agent's name, written onto the project at birth (`bots.ts`). A caller
   * that omits it gets an environment whose menu row falls back to the project
   * name — legible, but not somebody you can address.
   */
  readonly botName?: string;
  /**
   * The coding agents the new container offers, normally the ones this
   * group's existing environments are signed in with (`agentSelection.ts`).
   * Omitted or empty leaves the container offering every agent.
   */
  readonly agents?: ReadonlyArray<ZeropsAgentType>;
}

export type EnvironmentCreationStep =
  /** `POST /client/{clientId}/project`, tags included so it is never briefly ungrouped. */
  | {
      readonly kind: "create-project";
      readonly name: string;
      readonly tagList: ReadonlyArray<string>;
      readonly location: string | undefined;
    }
  /**
   * `PUT /project/{id}/first-class-recipe/development-container` — the zcp
   * that carries the agent.
   *
   * `agents` is the group's own selection, so a Mate added to a group comes up
   * offering what that group signed in with rather than the platform's whole
   * menu. Empty means the group has authorized nothing yet, and the import
   * document then omits `ZCP_AGENTS` entirely — absent offers every agent,
   * empty offers none (MC-11).
   */
  | { readonly kind: "import-container"; readonly agents: ReadonlyArray<ZeropsAgentType> }
  /**
   * `PUT /client/{clientId}/integration-token/{tokenId}` — the container's own
   * token, lowered to what zcp actually needs (`groupReach.ts`).
   *
   * The platform mints it with `ADMIN` on the project, which is also what a
   * shell in that container and the agent running there hold. Lowering it is
   * the one step that has to happen while nobody has talked to the Mate yet,
   * so it sits directly after the container import rather than at the end.
   */
  | { readonly kind: "secure-container-token" }
  /**
   * `DELETE /client/{clientId}/integration-token/{tokenId}/delegation/{id}` —
   * the one-time mint the platform hands every new Mate.
   *
   * It grants `NO_ACCESS` + *can create projects*, so the Mate can make one
   * more project; and a token minted through a delegation names the
   * **delegating person** as its creator, which is precisely the claim a
   * throwaway at the door is trusted for. Lowering the token (above) does not
   * touch it — it is a separate record — so it gets a step of its own.
   */
  | { readonly kind: "drop-container-delegation" }
  /**
   * The project's own variables stop reaching every container in it
   * (`projectIsolation.ts`): `envIsolation` to `service`, `ZCP_API_KEY` moved
   * onto the container as a sensitive service variable, the project entry
   * deleted, every service restarted.
   *
   * Before the application import rather than after it, so no app container
   * and no build ever boots holding the Mate's key and its agent's login —
   * and so the restarts this step ends with are over one container, not over
   * services that were still being created.
   */
  | { readonly kind: "isolate-project-env" }
  /** `POST /project/{id}/service-stack/import` with the group's recipe for this role. */
  | { readonly kind: "import-recipe"; readonly role: ZeropsEnvironmentRole; readonly yaml: string }
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
      readonly yaml: string;
    }
  /** Poll until the services are up. Measured at ~2 minutes for a two-service recipe. */
  | { readonly kind: "await-ready"; readonly withAgent: boolean }
  /**
   * The Mate's Gitea access, asked of the org's broker as the person and
   * written onto its `zcp` service (guide 1.5, `giteaCredential.ts`).
   *
   * Last, and **tolerant**. It needs the container to exist and the account's
   * Gitea to be up, and neither is this creation's to guarantee: an account
   * whose Gitea is still building says *waiting for Gitea* and the
   * projects-screen reconcile picks it up on the next read. A Mate without it
   * is a working Mate that cannot push yet, which is a far better outcome than
   * a creation that reports failure over a project that exists and runs.
   */
  | { readonly kind: "fetch-gitea-credential" };

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

  const withAgent = input.withAgent ?? defaultAgentForRole(input.role);
  const recipe = input.recipe ?? { kind: "store" };

  let yaml: string | null;
  switch (recipe.kind) {
    case "store": {
      const gate = canCreateEnvironment(input.record, input.role);
      if (!gate.allowed) return { ok: false, reason: gate.reason ?? "No recipe for this role." };
      // `canCreateEnvironment` already proved this is a non-blank string.
      yaml = input.record?.recipes[input.role] ?? "";
      break;
    }
    case "services": {
      if (recipe.yaml.trim().length === 0) {
        return { ok: false, reason: `There is nothing to clone from ${recipe.source}.` };
      }
      yaml = recipe.yaml;
      break;
    }
    case "none":
      yaml = null;
      break;
  }

  if (yaml === null && !withAgent) {
    return {
      ok: false,
      reason: "An environment with neither an agent nor an application has nothing in it.",
    };
  }

  // Membership first, then the name: naming is not a membership write, and
  // routing it through one clears the group (`groups.ts`).
  const tagList = taggedAtBirth(input, withAgent);

  // A recipe that describes a whole project creates one in a single call. Not
  // taken when the caller placed the environment in a region: the project
  // block has no location, and silently ignoring one would put the
  // environment somewhere the user did not ask for.
  const wholeProject = yaml !== null && input.location === undefined && hasProjectBlock(yaml);

  const steps: Array<EnvironmentCreationStep> = wholeProject
    ? [
        {
          kind: "import-project",
          name,
          tagList,
          yaml: recipeProjectImportYaml(yaml ?? "", { name, tagList }),
        },
      ]
    : [{ kind: "create-project", name, tagList, location: input.location }];

  if (withAgent) {
    steps.push({ kind: "import-container", agents: input.agents ?? [] });
    // Only a container has a token to lower: an environment created without
    // one is a deployment target, and the platform mints it nothing.
    steps.push({ kind: "secure-container-token" });
    steps.push({ kind: "drop-container-delegation" });
    steps.push({ kind: "isolate-project-env" });
  }
  if (yaml !== null && !wholeProject) steps.push({ kind: "import-recipe", role: input.role, yaml });
  steps.push({ kind: "await-ready", withAgent });
  // Only a Mate has a `zcp` service to write the credential onto, and only a
  // ready one can be restarted into it — so this follows the wait.
  if (withAgent) steps.push({ kind: "fetch-gitea-credential" });

  return { ok: true, steps };
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
    case "secure-container-token":
      return "Locking the container's access";
    case "drop-container-delegation":
      return "Taking back the container's one-time permit";
    case "isolate-project-env":
      return "Closing the project's shared variables";
    case "import-recipe":
      return "Importing the application";
    case "await-ready":
      return step.withAgent ? "Waiting for the agent" : "Waiting for the services";
    case "fetch-gitea-credential":
      return "Giving the Mate its Gitea access";
  }
}

/**
 * The tags a new environment is created with: its membership, and — when it
 * gets an agent — the `mate` marker and the agent's name. The marker is
 * written here, at birth, rather than after the container import, so a
 * creation that fails between the two still leaves a project that says what
 * it was meant to be.
 */
function taggedAtBirth(input: EnvironmentCreationInput, withAgent: boolean): ReadonlyArray<string> {
  const membership = withZeropsGroupTags([], {
    groupId: input.groupId,
    role: input.role,
    ...(input.groupName === undefined ? {} : { label: input.groupName }),
  });
  if (!withAgent) return membership;
  const declared = withZeropsMateTag(membership);
  return input.botName === undefined ? declared : withZeropsBotTag(declared, input.botName);
}
