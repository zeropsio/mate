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
import {
  findMateIntegrationToken,
  planGroupReach,
  type ZeropsIntegrationToken,
  type ZeropsProjectGrant,
  type ZeropsTokenDelegation,
} from "./groupReach.ts";
import type { ZeropsAgentType } from "./newProject.ts";
import {
  projectCreationFailureSentence,
  projectCreationOutcome,
  type ZeropsProjectCreation,
} from "./projectCreation.ts";

/** The platform calls a creation makes, in the shape `api.ts` offers them. */
export interface EnvironmentCreationPlatform {
  readonly createProject: (input: {
    readonly clientId: string;
    readonly name: string;
    readonly tagList: ReadonlyArray<string>;
    readonly location?: string;
  }) => Promise<{ readonly id: string }>;
  /**
   * `POST /process/search` — the project's newest `project.create` process,
   * or nothing while none has appeared (`projectCreation.ts`). One read; the
   * waiting is this module's.
   */
  readonly readProjectCreation: (input: {
    readonly clientId: string;
    readonly projectId: string;
  }) => Promise<ZeropsProjectCreation | undefined>;
  readonly importDevelopmentContainer: (input: {
    readonly projectId: string;
    readonly agents: ReadonlyArray<ZeropsAgentType>;
  }) => Promise<{ readonly serviceName: string }>;
  readonly importServices: (projectId: string, yaml: string) => Promise<unknown>;
  /**
   * `POST /client/{id}/project/import` — a project and its services from one
   * whole-project document (`createEnvironment.ts`, `import-project`).
   */
  readonly importProject: (input: {
    readonly clientId: string;
    readonly yaml: string;
  }) => Promise<{ readonly projectId: string }>;
  /**
   * `GET /client/{id}/integration-token/list`, as grant metadata — names and
   * project grants, never a token value. The step needs the id of the token
   * the container import just minted, and nothing else about it.
   */
  readonly listIntegrationTokenGrants: (input: {
    readonly clientId: string;
  }) => Promise<ReadonlyArray<ZeropsIntegrationToken>>;
  /** `PUT /client/{id}/integration-token/{tokenId}` — the whole record, replaced. */
  readonly setIntegrationTokenProjects: (input: {
    readonly clientId: string;
    readonly tokenId: string;
    readonly name: string;
    readonly projects: ReadonlyArray<ZeropsProjectGrant>;
  }) => Promise<void>;
  /** `GET /client/{id}/integration-token/{tokenId}/delegation`. */
  readonly listTokenDelegations: (input: {
    readonly clientId: string;
    readonly tokenId: string;
  }) => Promise<ReadonlyArray<ZeropsTokenDelegation>>;
  /** `DELETE /client/{id}/integration-token/{tokenId}/delegation/{delegationId}`. */
  readonly deleteTokenDelegation: (input: {
    readonly clientId: string;
    readonly tokenId: string;
    readonly delegationId: string;
  }) => Promise<void>;
  /**
   * The whole of `projectIsolation.ts`'s plan against one project — the read,
   * the writes, the re-read and the restarts. One call rather than a port per
   * platform verb: the decision is the pure planner's and is tested there,
   * and the entry ids the writes need never leave the caller that read them.
   */
  /** Reads the latest shared-model projection; this callback performs no platform request. */
  readonly readObservedServices: (
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
      /**
       * Services that settled short of running — created with nothing
       * deployed, typically a `buildFromGit` service whose build did not go
       * through. The environment is up; these are what it still needs.
       */
      readonly undeployed: ReadonlyArray<string>;
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
  /** Captured account lifetime; a later login must never resume this operation. */
  readonly isCurrent?: () => boolean;
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
  /** Between `project.create` reads after the project POST. */
  readonly projectCreatePollIntervalMs?: number;
  /** How long the platform is given to confirm the project before the step fails. */
  readonly projectCreateWaitCapMs?: number;
}

/** Measured at ~2 minutes for a two-service recipe; a build can take longer. */
export const ENVIRONMENT_SERVICE_WAIT_CAP_MS = 600_000;
export const ENVIRONMENT_SERVICE_POLL_INTERVAL_MS = 5_000;
/**
 * `project.create` settles within about a second of the POST, finished or
 * failed (measured 2026-09-16); a minute is the bound past which the platform
 * has said nothing and the step stops pretending it will.
 */
export const PROJECT_CREATE_WAIT_CAP_MS = 60_000;
export const PROJECT_CREATE_POLL_INTERVAL_MS = 2_000;

function defaultDescribeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function runEnvironmentCreation(
  input: RunEnvironmentCreationInput,
): Promise<EnvironmentCreationOutcome> {
  const now = input.now ?? Date.now;
  const describeError = input.describeError ?? defaultDescribeError;
  const { sleep } = input;
  const assertCurrent = () => {
    if (input.isCurrent?.() === false) throw new Error("This account session has ended.");
  };
  const pollIntervalMs = input.pollIntervalMs ?? ENVIRONMENT_SERVICE_POLL_INTERVAL_MS;
  const serviceWaitCapMs = input.serviceWaitCapMs ?? ENVIRONMENT_SERVICE_WAIT_CAP_MS;
  const projectCreatePollIntervalMs =
    input.projectCreatePollIntervalMs ?? PROJECT_CREATE_POLL_INTERVAL_MS;
  const projectCreateWaitCapMs = input.projectCreateWaitCapMs ?? PROJECT_CREATE_WAIT_CAP_MS;

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
  let undeployed: ReadonlyArray<string> = [];
  // Read once and shared by the two steps that need it: the account's token
  // list does not change under a creation, and one read is one round trip
  // fewer between the container coming up and its ADMIN going away.
  let mateToken: ZeropsIntegrationToken | undefined;
  const resolveMateToken = async (): Promise<ZeropsIntegrationToken> => {
    if (mateToken !== undefined) return mateToken;
    const tokens = await input.platform.listIntegrationTokenGrants({ clientId: input.clientId });
    assertCurrent();
    const found = findMateIntegrationToken(tokens, requireProject(projectId));
    if (found === undefined) {
      throw new Error(
        "The container's own access token could not be found, so it still holds more of this project than it needs.",
      );
    }
    mateToken = found;
    return found;
  };
  report();

  for (let index = 0; index < input.steps.length; index += 1) {
    const step = input.steps[index]!;
    const startedAtMs = now();
    mark(index, { state: "running", startedAtMs });

    try {
      assertCurrent();
      switch (step.kind) {
        case "create-project": {
          const project = await input.platform.createProject({
            clientId: input.clientId,
            name: step.name,
            tagList: step.tagList,
            ...(step.location === undefined ? {} : { location: step.location }),
          });
          // Named before the wait: a creation the platform then fails has
          // still made a project, and the outcome must say which one.
          projectId = project.id;
          await awaitProjectCreated({
            clientId: input.clientId,
            projectId: project.id,
            platform: input.platform,
            startedAtMs,
            now,
            sleep,
            pollIntervalMs: projectCreatePollIntervalMs,
            capMs: projectCreateWaitCapMs,
            assertCurrent,
          });
          break;
        }
        case "import-project": {
          // One call for the project and its services, so an environment is
          // never briefly a project with nothing in it.
          const imported = await input.platform.importProject({
            clientId: input.clientId,
            yaml: step.yaml,
          });
          projectId = imported.projectId;
          break;
        }
        case "import-container": {
          const imported = await input.platform.importDevelopmentContainer({
            projectId: requireProject(projectId),
            agents: step.agents,
          });
          serviceName = imported.serviceName;
          break;
        }
        case "secure-container-token": {
          const token = await resolveMateToken();
          const write = planGroupReach({
            token,
            selfProjectId: requireProject(projectId),
            // A group of one: the new environment's siblings, if it has any,
            // are the projects-screen reconcile's business — that one runs on
            // every read and can see the whole account, while this runs once
            // and can see only what it just made.
            groupProjectIds: [requireProject(projectId)],
          });
          // Already exactly right — a platform that starts minting the lowered
          // shape makes this step a read.
          if (write !== undefined) {
            await input.platform.setIntegrationTokenProjects({
              clientId: input.clientId,
              tokenId: write.tokenId,
              name: token.name,
              projects: write.projects,
            });
          }
          break;
        }
        case "drop-container-delegation": {
          const token = await resolveMateToken();
          const delegations = await input.platform.listTokenDelegations({
            clientId: input.clientId,
            tokenId: token.id,
          });
          assertCurrent();
          // Every one of them, and only this token's. A Mate is never given a
          // delegation on purpose, so there is no shape worth keeping; an
          // account whose platform stopped granting them makes this a read.
          for (const delegation of delegations) {
            await input.platform.deleteTokenDelegation({
              clientId: input.clientId,
              tokenId: token.id,
              delegationId: delegation.id,
            });
            assertCurrent();
          }
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
              undeployed: [],
            };
          }
          undeployed = await awaitServices({
            projectId: requireProject(projectId),
            platform: input.platform,
            now,
            sleep,
            pollIntervalMs,
            capMs: serviceWaitCapMs,
            assertCurrent,
          });
          break;
        }
      }
      assertCurrent();
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
    undeployed,
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
 * The project POST answered; this waits for the platform to have actually
 * made the project. `project.create` is read until it is terminal: finished
 * returns, failed or canceled throws the platform's own sentence, and past
 * the cap with nothing terminal the step stops and says so. No process yet
 * is "not yet", never "fine" — the search can answer before the platform has
 * written the process it is about to run.
 *
 * The step's own start is the wait's start, so a verdict that is already in
 * on the first read costs the clock nothing.
 */
async function awaitProjectCreated(input: {
  readonly clientId: string;
  readonly projectId: string;
  readonly platform: EnvironmentCreationPlatform;
  readonly startedAtMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly pollIntervalMs: number;
  readonly capMs: number;
  readonly assertCurrent: () => void;
}): Promise<void> {
  for (;;) {
    input.assertCurrent();
    const creation = await input.platform.readProjectCreation({
      clientId: input.clientId,
      projectId: input.projectId,
    });
    input.assertCurrent();
    const outcome = projectCreationOutcome(creation);
    if (outcome.kind === "finished") return;
    if (outcome.kind === "failed") throw new Error(projectCreationFailureSentence(outcome));
    if (input.now() - input.startedAtMs > input.capMs) {
      throw new Error("Zerops did not confirm the project was created.");
    }
    await input.sleep(input.pollIntervalMs);
  }
}

/**
 * A service the platform has finished creating but that runs nothing yet.
 * A `buildFromGit` service lands here when its build fails — the export a
 * clone comes from cannot carry the build setup (`recipeExport.ts`) — and so
 * does any service that simply awaits a first deploy. Settled, not running.
 */
const UNDEPLOYED_STATUS = "READY_TO_DEPLOY";

/**
 * Every service settled — `ACTIVE`, or created with nothing deployed — with
 * the names of the latter, or a failure naming what is still on its way.
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
  readonly assertCurrent: () => void;
}): Promise<ReadonlyArray<string>> {
  const startedAt = input.now();
  for (;;) {
    input.assertCurrent();
    const services = await input.platform.readObservedServices(input.projectId);
    input.assertCurrent();
    const pending = services.filter(
      (service) => service.status !== "ACTIVE" && service.status !== UNDEPLOYED_STATUS,
    );
    if (services.length > 0 && pending.length === 0) {
      return services
        .filter((service) => service.status === UNDEPLOYED_STATUS)
        .map((service) => service.name);
    }

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
