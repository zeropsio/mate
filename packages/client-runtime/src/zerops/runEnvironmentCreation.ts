/**
 * Runs an environment creation plan against the platform.
 *
 * `createEnvironment.ts` decides; this acts. It walks the plan in order, tells
 * the caller which step it is on (the two-minute wait wants a checklist, not
 * a spinner), and stops at the first failure with the step it failed on —
 * because a half-built environment is a real project on the account, and the
 * user needs to know which half exists.
 *
 * ## Who waits
 *
 * The last steps are where the two kinds of environment part ways:
 *
 * - An environment **with an agent** is handed back at `await-ready`, every
 *   step that needs the person's rights done: its container imported with
 *   its key and its runtimes, its project closed off, its registration
 *   written. The container then sets itself up (zcp imports the runtimes on
 *   boot); the container wait is already a product surface — the
 *   provisioning state machine, its panel, its retry and enable paths — and
 *   duplicating it here would be a second opinion about when a container is
 *   ready.
 * - An environment **without one** has nothing to hand off to: no container,
 *   no health probe. So this waits for its services itself, on the account's
 *   services listing, until every one of them has settled.
 *
 * The platform is a parameter (R1): this package may not reach for a client,
 * a clock or a timer, and the tests must not either.
 *
 * @module runEnvironmentCreation
 */

import type { RunToEnd } from "../data/operations/runToEnd.ts";
import type { EnvironmentCreationStep } from "./createEnvironment.ts";
import type { Deployment } from "./flow/deployment.ts";
import { deployedVersion } from "./groupRows.ts";
import type { Known } from "./knowledge/known.ts";
import { isUncertainZeropsFailure } from "./errors.ts";

/**
 * What a creation acts through: each Zerops write as the account's operation, waited to its end
 * (`runToEnd`), and the steps HQ and the account's store take.
 */
export interface EnvironmentCreationPlatform {
  readonly run: RunToEnd;
  /**
   * The close-off recorded in the Mate's birth at HQ, as the person: zcp's boot import of the
   * runtimes waits for it (pass 28). Idempotent.
   */
  readonly markClosedOff: (projectId: string) => Promise<void>;
  /**
   * The environment's group registration (`addGroupEnvironment.ts`); safe to ask again. Throws
   * with the reason a write did not go through.
   */
  readonly register: (projectId: string) => Promise<void>;
  /** Reads the latest shared-model projection; this callback performs no platform request. */
  /**
   * Resolves with the project's services once every one of them has settled
   * (`servicesSettled`), as the account's services listing holds them: read as they change, never
   * on a clock. Rejects where that listing can no longer be followed.
   */
  readonly untilServicesSettled: (
    projectId: string,
  ) => Promise<ReadonlyArray<{ readonly name: string; readonly status: string }>>;
}

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

export interface RunEnvironmentCreationInput {
  readonly clientId: string;
  readonly steps: ReadonlyArray<EnvironmentCreationStep>;
  readonly platform: EnvironmentCreationPlatform;
  /** Captured account lifetime; a later login must never resume this operation. */
  readonly isCurrent?: () => boolean;
  readonly onProgress?: (progress: ReadonlyArray<EnvironmentCreationStepProgress>) => void;
  /** Turns an unknown failure into the sentence the checklist shows. */
  readonly describeError?: (cause: unknown) => string;
  readonly now?: () => number;
  /**
   * A press tried again: the step it resumes at, and the project the first press made. Only
   * steps that are safe to ask again resume (`resumableEnvironmentCreationStep`).
   */
  readonly resume?: {
    readonly from: number;
    readonly projectId: string;
    readonly projectName: string;
    readonly serviceName?: string;
  };
  /** The platform took the project: everything after this step acts on it. */
  readonly onProjectAccepted?: (projectId: string) => void | Promise<void>;
  /** Zerops took the container's import: its creation process, where it named one. */
  readonly onContainerImported?: (imported: {
    readonly processId?: string;
  }) => void | Promise<void>;
}

/**
 * The steps a press tried again may resume at: each is safe to ask again. An import of services
 * is not — a second one is refused for the hostnames the first made — so a creation that stopped
 * there, or at the project itself, is removed rather than resumed.
 */
export function resumableEnvironmentCreationStep(step: EnvironmentCreationStep): boolean {
  return step.kind === "import-container" || step.kind === "close-off" || step.kind === "register";
}

/** Where the project's `project.create` can no longer be followed to its end. */
export const UNCONFIRMED_PROJECT = "Zerops did not confirm the project was created.";
/** Where a write's end can no longer be followed. */
export const UNCONFIRMED_WRITE =
  "Zerops may have accepted this operation, but its response was lost. Check the project and its services before starting another operation.";

function defaultDescribeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function runEnvironmentCreation(
  input: RunEnvironmentCreationInput,
): Promise<EnvironmentCreationOutcome> {
  const now = input.now ?? Date.now;
  const describeError = input.describeError ?? defaultDescribeError;
  const assertCurrent = () => {
    if (input.isCurrent?.() === false) throw new Error("This account session has ended.");
  };

  const progress: Array<EnvironmentCreationStepProgress> = input.steps.map((step) => ({
    step,
    state: "queued",
  }));
  const report = () => input.onProgress?.([...progress]);
  const mark = (index: number, patch: Partial<EnvironmentCreationStepProgress>) => {
    const current = progress[index];
    if (current === undefined) return;
    progress[index] = { ...current, ...patch };
    report();
  };

  let projectId: string | undefined = input.resume?.projectId;
  let projectName: string | undefined = input.resume?.projectName;
  let serviceName: string | undefined = input.resume?.serviceName;
  let deployments: ReadonlyArray<ServiceDeployment> = [];
  /** This press imported a container: a harden before it is no longer the last word. */
  let containerImported = false;
  const run = input.platform.run;
  const orgId = input.clientId;
  /** The project's acceptance told on, while the create waits for its end. */
  let accepting: Promise<{ readonly error: unknown } | null> = Promise.resolve(null);
  const accept = async (id: string) => {
    projectId = id;
    assertCurrent();
    await input.onProjectAccepted?.(id);
  };
  report();

  const from = input.resume?.from ?? 0;
  for (let index = 0; index < from; index += 1)
    progress[index] = { ...progress[index]!, state: "done" };
  if (from > 0) report();

  for (let index = from; index < input.steps.length; index += 1) {
    const step = input.steps[index]!;
    const startedAtMs = now();
    mark(index, { state: "running", startedAtMs });

    try {
      assertCurrent();
      switch (step.kind) {
        case "create-project": {
          // Named as Zerops takes it, before its end: a creation the platform then fails has
          // still made a project, and the outcome must say which one.
          projectName = step.name;
          await run(
            {
              kind: "create-project",
              orgId,
              name: step.name,
              tagList: step.tagList,
              ...(step.location === undefined ? {} : { location: step.location }),
            },
            {
              orgId,
              unobserved: UNCONFIRMED_PROJECT,
              accepted: ({ projectId: id }) => {
                accepting = accept(id).then(
                  () => null,
                  (error: unknown) => ({ error }),
                );
              },
            },
          ).finally(async () => {
            const stopped = await accepting;
            if (stopped !== null) throw stopped.error;
          });
          break;
        }
        case "import-project": {
          // One call for the project and its services, so an environment is
          // never briefly a project with nothing in it.
          const imported = await run(
            { kind: "import-project", orgId, name: step.name, yaml: step.yaml },
            { orgId, unobserved: UNCONFIRMED_WRITE },
          );
          projectName = step.name;
          await accept(imported.projectId);
          break;
        }
        case "import-container": {
          const imported = await run(
            {
              kind: "import-container",
              orgId,
              projectId: requireProject(projectId),
              projectName: projectName ?? "",
              agents: step.agents,
              ...(step.runtimes === undefined ? {} : { setupRuntimesYaml: step.runtimes.yaml }),
            },
            { orgId, unobserved: UNCONFIRMED_WRITE },
          );
          serviceName = imported.serviceName;
          if (imported.imported) containerImported = true;
          assertCurrent();
          await input.onContainerImported?.(imported);
          break;
        }
        case "close-off": {
          const target = requireProject(projectId);
          // A container imported after hardening may have changed isolation: the project is read,
          // closed off where it is not, and read back. One that does not read closed off stops
          // here; the creator's next action owns another check.
          if (step.isolated !== true || containerImported)
            await run(
              { kind: "harden-project", orgId, projectId: target, confirm: true },
              { orgId, unobserved: UNCONFIRMED_WRITE },
            );
          assertCurrent();
          await input.platform.markClosedOff(target);
          break;
        }
        case "register": {
          const target = requireProject(projectId);
          // A stopped registration keeps the birth intent and the accepted project. Finish
          // setup can attach it to the intended application before continuing the other steps.
          await input.platform.register(target);
          break;
        }
        case "import-recipe":
        case "import-managed": {
          await run(
            {
              kind: "import-services",
              orgId,
              projectId: requireProject(projectId),
              yaml: step.yaml,
            },
            { orgId, unobserved: UNCONFIRMED_WRITE },
          );
          break;
        }
        case "await-ready": {
          if (step.withAgent) {
            // Handed off, not finished: the caller's provisioning wait takes
            // over from here, and it reports its own progress.
            return {
              ok: true,
              projectId: requireProject(projectId),
              serviceName,
              awaitingAgent: true,
            };
          }
          const services = await input.platform.untilServicesSettled(requireProject(projectId));
          assertCurrent();
          deployments = services.map((service) => ({
            service: service.name,
            deployment: {
              state: "known",
              value:
                service.status === UNDEPLOYED_STATUS
                  ? { kind: "none" }
                  : { kind: "running", activatedAt: null, version: deployedVersion(undefined) },
              asOf: { ordinal: 1, atMs: now() },
              coverage: "complete",
              freshness: { kind: "settled" },
            },
          }));
          break;
        }
      }
      assertCurrent();
    } catch (cause) {
      const error = describeError(cause);
      mark(index, { state: "failed", error, finishedAtMs: now() });
      return {
        ok: false,
        projectId,
        ...(serviceName === undefined ? {} : { serviceName }),
        failedStep: step,
        error,
        ...(isUncertainZeropsFailure(cause) ? { uncertain: true as const } : {}),
      };
    }

    mark(index, { state: "done", finishedAtMs: now() });
  }

  return {
    ok: true,
    projectId: requireProject(projectId),
    serviceName,
    awaitingAgent: false,
    deployments,
  };
}

function requireProject(projectId: string | undefined): string {
  if (projectId === undefined) {
    // A plan always creates the project first (`planEnvironmentCreation`);
    // reaching here means a caller hand-built a plan that does not.
    throw new Error("The environment's project has not been created yet.");
  }
  return projectId;
}

/**
 * A service the platform has finished creating but that runs nothing yet.
 * A `buildFromGit` service lands here when its build fails — the export a
 * clone comes from cannot carry the build setup (`recipeExport.ts`) — and so
 * does any service that simply awaits a first deploy. Settled, not running.
 */
const UNDEPLOYED_STATUS = "READY_TO_DEPLOY";

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
