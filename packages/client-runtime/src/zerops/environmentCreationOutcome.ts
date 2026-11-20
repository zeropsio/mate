// What the creation of an environment reports while it runs and when it ends, as values: the data
// layer's `runEnvironmentCreation` walks the plan and reports in them.

import type { EnvironmentCreationStep } from "./createEnvironment.ts";
import type { Deployment } from "./flow/deployment.ts";
import type { Known } from "./knowledge/known.ts";

export type EnvironmentCreationStepState = "queued" | "running" | "done" | "failed";

export interface EnvironmentCreationStepProgress {
  readonly step: EnvironmentCreationStep;
  readonly state: EnvironmentCreationStepState;
  /** Set on `failed`: what the platform said. */
  readonly error?: string;
  readonly startedAtMs?: number;
  readonly finishedAtMs?: number;
}

/** What one service of a created environment runs, as the wait for it saw it. */
export interface ServiceDeployment {
  readonly service: string;
  readonly deployment: Known<Deployment>;
}

export type EnvironmentCreationOutcome =
  | {
      readonly ok: true;
      readonly projectId: string;
      /** The zcp service, when the plan imported one. */
      readonly serviceName: string | undefined;
      /**
       * The container wait is the caller's to run: the project exists and
       * its imports were accepted, and what remains is the provisioning wait
       * this executor deliberately does not own. Nothing was read of what
       * the services run.
       */
      readonly awaitingAgent: true;
    }
  | {
      readonly ok: true;
      readonly projectId: string;
      readonly serviceName: string | undefined;
      readonly awaitingAgent: false;
      /**
       * What each service runs, from the read that saw every one of them
       * settled. A service created with nothing deployed — typically a
       * `buildFromGit` service whose build did not go through — is known to
       * run nothing: the environment is up, and it is what it still needs.
       */
      readonly deployments: ReadonlyArray<ServiceDeployment>;
    }
  | {
      readonly ok: false;
      /** Set once the project exists — the half that was built. */
      readonly projectId: string | undefined;
      /** The container accepted before a later step stopped. */
      readonly serviceName?: string;
      readonly failedStep: EnvironmentCreationStep;
      readonly error: string;
      /** The platform may have done the step anyway (`isUncertainZeropsFailure`): never ask it again. */
      readonly uncertain?: true;
    };

/**
 * The steps a press tried again may resume at: each is safe to ask again. An import of services
 * is not — a second one is refused for the hostnames the first made — so a creation that stopped
 * there, or at the project itself, is removed rather than resumed.
 */
export function resumableEnvironmentCreationStep(step: EnvironmentCreationStep): boolean {
  return step.kind === "import-container" || step.kind === "register";
}

/** Where the project's `project.create` can no longer be followed to its end. */
export const UNCONFIRMED_PROJECT = "Zerops did not confirm the project was created.";
/** Where a write's end can no longer be followed. */
export const UNCONFIRMED_WRITE =
  "Zerops may have accepted this operation, but its response was lost. Check the project and its services before starting another operation.";

/**
 * A service the platform has finished creating but that runs nothing yet.
 * A `buildFromGit` service lands here when its build fails — the export a
 * clone comes from cannot carry the build setup (`recipeExport.ts`) — and so
 * does any service that simply awaits a first deploy. Settled, not running.
 */
export const UNDEPLOYED_STATUS = "READY_TO_DEPLOY";

/**
 * Whether every service of a created environment has settled — `ACTIVE`, or created with nothing
 * deployed. An import's services appear a moment after the import is accepted, so an empty list
 * is "not yet", never "done": waiting on zero services would declare a production environment
 * ready before it had one.
 */
export function servicesSettled(
  services: ReadonlyArray<{ readonly status: string }> | undefined,
): boolean {
  return (
    services !== undefined &&
    services.length > 0 &&
    services.every((service) => service.status === "ACTIVE" || service.status === UNDEPLOYED_STATUS)
  );
}
