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
 * The last step, `await-ready`, is where the two kinds of environment part
 * ways:
 *
 * - An environment **with an agent** is handed back the moment its imports
 *   are accepted. The container wait is already a product surface — the
 *   provisioning state machine, its panel, its retry and enable paths — and
 *   duplicating it here would be a second opinion about when a container is
 *   ready. The caller starts that wait for the returned project.
 * - An environment **without one** has nothing to hand off to: no container,
 *   no health probe. So this waits for its services itself, by reading the
 *   platform's own service status until every one of them is `ACTIVE`.
 *
 * The platform is a parameter (R1): this package may not reach for a client,
 * a clock or a timer, and the tests must not either.
 *
 * @module runEnvironmentCreation
 */

import type { EnvironmentCreationStep } from "./createEnvironment.ts";

/** The four platform calls a creation makes, in the shape `api.ts` offers them. */
export interface EnvironmentCreationPlatform {
  readonly createProject: (input: {
    readonly clientId: string;
    readonly name: string;
    readonly tagList: ReadonlyArray<string>;
    readonly location?: string;
  }) => Promise<{ readonly id: string }>;
  readonly importDevelopmentContainer: (input: {
    readonly projectId: string;
  }) => Promise<{ readonly serviceName: string }>;
  readonly importServices: (projectId: string, yaml: string) => Promise<unknown>;
  readonly listServices: (
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

export type EnvironmentCreationOutcome =
  | {
      readonly ok: true;
      readonly projectId: string;
      /** The zcp service, when the plan imported one. */
      readonly serviceName: string | undefined;
      /**
       * True when the container wait is the caller's to run: the project
       * exists and its imports were accepted, and what remains is the
       * provisioning wait this executor deliberately does not own.
       */
      readonly awaitingAgent: boolean;
    }
  | {
      readonly ok: false;
      /** Set once the project exists — the half that was built. */
      readonly projectId: string | undefined;
      readonly failedStep: EnvironmentCreationStep;
      readonly error: string;
    };

export interface RunEnvironmentCreationInput {
  readonly clientId: string;
  readonly steps: ReadonlyArray<EnvironmentCreationStep>;
  readonly platform: EnvironmentCreationPlatform;
  readonly onProgress?: (progress: ReadonlyArray<EnvironmentCreationStepProgress>) => void;
  /** Turns an unknown failure into the sentence the checklist shows. */
  readonly describeError?: (cause: unknown) => string;
  readonly now?: () => number;
  /**
   * Between service reads while waiting without an agent. The caller's, not
   * this package's: a timer is platform (R1), and the web hands in the one
   * its own polling loops already use.
   */
  readonly sleep: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  /** How long a service wait is given before it is called a failure. */
  readonly serviceWaitCapMs?: number;
}

/** Measured at ~2 minutes for a two-service recipe; a build can take longer. */
export const ENVIRONMENT_SERVICE_WAIT_CAP_MS = 600_000;
export const ENVIRONMENT_SERVICE_POLL_INTERVAL_MS = 5_000;

function defaultDescribeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function runEnvironmentCreation(
  input: RunEnvironmentCreationInput,
): Promise<EnvironmentCreationOutcome> {
  const now = input.now ?? Date.now;
  const describeError = input.describeError ?? defaultDescribeError;
  const { sleep } = input;
  const pollIntervalMs = input.pollIntervalMs ?? ENVIRONMENT_SERVICE_POLL_INTERVAL_MS;
  const serviceWaitCapMs = input.serviceWaitCapMs ?? ENVIRONMENT_SERVICE_WAIT_CAP_MS;

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

  let projectId: string | undefined;
  let serviceName: string | undefined;
  report();

  for (let index = 0; index < input.steps.length; index += 1) {
    const step = input.steps[index]!;
    const startedAtMs = now();
    mark(index, { state: "running", startedAtMs });

    try {
      switch (step.kind) {
        case "create-project": {
          const project = await input.platform.createProject({
            clientId: input.clientId,
            name: step.name,
            tagList: step.tagList,
            ...(step.location === undefined ? {} : { location: step.location }),
          });
          projectId = project.id;
          break;
        }
        case "import-container": {
          const imported = await input.platform.importDevelopmentContainer({
            projectId: requireProject(projectId),
          });
          serviceName = imported.serviceName;
          break;
        }
        case "import-recipe": {
          await input.platform.importServices(requireProject(projectId), step.yaml);
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
          await awaitServices({
            projectId: requireProject(projectId),
            platform: input.platform,
            now,
            sleep,
            pollIntervalMs,
            capMs: serviceWaitCapMs,
          });
          break;
        }
      }
    } catch (cause) {
      const error = describeError(cause);
      mark(index, { state: "failed", error, finishedAtMs: now() });
      return { ok: false, projectId, failedStep: step, error };
    }

    mark(index, { state: "done", finishedAtMs: now() });
  }

  return {
    ok: true,
    projectId: requireProject(projectId),
    serviceName,
    awaitingAgent: false,
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
 * Every service `ACTIVE`, or a failure naming the ones that are not.
 *
 * An import's services appear a moment after the import is accepted, so an
 * empty list is "not yet", never "done": waiting on zero services would
 * declare a production environment ready before it had one.
 */
async function awaitServices(input: {
  readonly projectId: string;
  readonly platform: EnvironmentCreationPlatform;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly pollIntervalMs: number;
  readonly capMs: number;
}): Promise<void> {
  const startedAt = input.now();
  for (;;) {
    const services = await input.platform.listServices(input.projectId);
    const pending = services.filter((service) => service.status !== "ACTIVE");
    if (services.length > 0 && pending.length === 0) return;

    if (input.now() - startedAt > input.capMs) {
      const names = pending.map((service) => service.name).join(", ");
      throw new Error(
        services.length === 0
          ? "The services never appeared."
          : `Still waiting for ${names} after ${Math.round(input.capMs / 60_000)} minutes.`,
      );
    }
    await input.sleep(input.pollIntervalMs);
  }
}
