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
 *   step that needs the person's rights done: its registration written, its
 *   container and its tier imported as one, which Zerops finishes whether the
 *   browser stays or not; the container wait is already a product surface — the
 *   provisioning state machine, its panel, its retry and enable paths — and
 *   duplicating it here would be a second opinion about when a container is
 *   ready.
 * - An environment **without one** has nothing to hand off to: no container,
 *   no health probe. So this waits for its services itself, on the account's
 *   services listing as Zerops pushes it, until every one of them has settled.
 *
 * The platform is a parameter (R1): this package may not reach for a client,
 * a clock or a timer, and the tests must not either.
 *
 * @module data/operations/runEnvironmentCreation
 */

import type { RunToEnd } from "./runToEnd.ts";
import type { EnvironmentCreationStep } from "../../zerops/createEnvironment.ts";
import { deployedVersion } from "../../zerops/groupRows.ts";
import { isUncertainZeropsFailure } from "../../zerops/errors.ts";
import type { MateBirthplace } from "../../zerops/newProject.ts";
import type {
  EnvironmentCreationOutcome,
  EnvironmentCreationStepProgress,
  ServiceDeployment,
} from "../../zerops/environmentCreationOutcome.ts";
import {
  UNCONFIRMED_PROJECT,
  UNCONFIRMED_WRITE,
  UNDEPLOYED_STATUS,
} from "../../zerops/environmentCreationOutcome.ts";

/**
 * What a creation acts through: each Zerops write as the account's operation, waited to its end
 * (`runToEnd`), and the steps HQ and the account's store take.
 */
export interface EnvironmentCreationPlatform {
  readonly run: RunToEnd;
  /**
   * The environment's group registration (`addGroupEnvironment.ts`), under the name the creation
   * made or resumed its project with; safe to ask again. Throws with the reason a write did not
   * go through.
   */
  readonly register: (projectId: string, projectName: string) => Promise<void>;
  /** The HQ and the web a Mate's container is born from; absent where no HQ is known. */
  readonly birthplace?: MateBirthplace;
  /**
   * Resolves with the project's services once every one of them has settled
   * (`servicesSettled`), as the account's services listing holds them: read once, then at each
   * frame Zerops pushes, performing no platform request. Rejects where that listing can no longer
   * be followed.
   */
  readonly untilServicesSettled: (
    projectId: string,
  ) => Promise<ReadonlyArray<{ readonly name: string; readonly status: string }>>;
}

interface RunEnvironmentCreationInput {
  readonly clientId: string;
  readonly steps: ReadonlyArray<EnvironmentCreationStep>;
  readonly platform: EnvironmentCreationPlatform;
  /** Captured account lifetime; a later login must never resume this operation. */
  readonly isCurrent?: () => boolean;
  /** Why the press may write nothing more, once it may not: its hold at HQ lapsed. */
  readonly stopped?: () => string | undefined;
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
  /** A birth's durable, exclusive claim around each non-idempotent platform write. */
  readonly birth?: {
    readonly id: string;
    readonly attempt: <T>(step: "create" | "import", send: () => Promise<T>) => Promise<T>;
  };
}

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
    const stopped = input.stopped?.();
    if (stopped !== undefined) throw new Error(stopped);
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
  const run = input.platform.run;
  const orgId = input.clientId;
  const attempt = <T>(step: "create" | "import", send: () => Promise<T>): Promise<T> =>
    input.birth === undefined ? send() : input.birth.attempt(step, send);
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
          await attempt("create", () =>
            run(
              {
                kind: "create-project",
                orgId,
                name: step.name,
                ...(input.birth === undefined ? {} : { birthId: input.birth.id }),
                tagList: step.tagList,
                ...(step.location === undefined ? {} : { location: step.location }),
                ...(step.userRoles === undefined ? {} : { userRoles: step.userRoles }),
                ...(step.corePackage === undefined ? {} : { corePackage: step.corePackage }),
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
            ),
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
          // An import document names no people: the creator's choice is given to the project made.
          if (step.userRoles !== undefined && step.userRoles.length > 0) {
            assertCurrent();
            await run(
              {
                kind: "grant-new-project-access",
                orgId,
                projectId: imported.projectId,
                userRoles: step.userRoles,
              },
              { orgId, unobserved: UNCONFIRMED_WRITE },
            );
          }
          break;
        }
        case "import-container": {
          if (step.tier?.projectVariables !== undefined)
            await run(
              {
                kind: "prepare-tier-variables",
                orgId,
                projectId: requireProject(projectId),
                variables: step.tier.projectVariables,
              },
              { orgId, unobserved: UNCONFIRMED_WRITE },
            );
          assertCurrent();
          const imported = await attempt("import", () =>
            run(
              {
                kind: "import-container",
                orgId,
                projectId: requireProject(projectId),
                projectName: projectName ?? "",
                agents: step.agents,
                ...(step.tier === undefined ? {} : { tierYaml: step.tier.yaml }),
                ...(input.platform.birthplace === undefined
                  ? {}
                  : { birthplace: input.platform.birthplace }),
              },
              { orgId, unobserved: UNCONFIRMED_WRITE },
            ),
          );
          serviceName = imported.serviceName;
          // A lapsed presence hold does not erase the accepted import's receipt. The original
          // account alone may report it; after sign-out no continuation may use its session.
          if (input.isCurrent?.() === false) throw new Error("This account session has ended.");
          await input.onContainerImported?.(imported);
          assertCurrent();
          break;
        }
        case "register": {
          const target = requireProject(projectId);
          const name = requireProjectName(projectName);
          // A stopped registration keeps the birth intent and the accepted project. Finish
          // setup can attach it to the intended application before continuing the other steps.
          await input.platform.register(target, name);
          break;
        }
        case "import-recipe": {
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

/** HQ names the Mate and the environment after it: a registration without one writes nothing. */
function requireProjectName(projectName: string | undefined): string {
  if (projectName === undefined || projectName.trim() === "")
    throw new Error("The project's name is not known.");
  return projectName;
}
