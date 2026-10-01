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
 *   no health probe. So this waits for its services itself, by reading the
 *   platform's own service status until every one of them is `ACTIVE`.
 *
 * The platform is a parameter (R1): this package may not reach for a client,
 * a clock or a timer, and the tests must not either.
 *
 * @module runEnvironmentCreation
 */

import type { EnvironmentCreationStep } from "./createEnvironment.ts";
import type { Deployment } from "./flow/deployment.ts";
import { deployedVersion } from "./groupRows.ts";
import type { Known } from "./knowledge/known.ts";
import { readsClosed } from "./projectIsolation.ts";
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
  /**
   * The container, holding the Mate's own key (`api.ts`): safe to ask again, a project that has
   * its container already making no write.
   */
  readonly importDevelopmentContainer: (input: {
    readonly projectId: string;
    /** What the project is called: its key is named after it. */
    readonly projectName: string;
    readonly agents: ReadonlyArray<ZeropsAgentType>;
    /** The tier's runtimes, for zcp to import on its first boot. */
    readonly setupRuntimesYaml?: string;
  }) => Promise<{ readonly serviceName: string; readonly imported: boolean }>;
  readonly importServices: (projectId: string, yaml: string) => Promise<unknown>;
  /**
   * `POST /client/{id}/project/import` — a project and its services from one
   * whole-project document (`createEnvironment.ts`, `import-project`).
   */
  readonly importProject: (input: {
    readonly clientId: string;
    readonly yaml: string;
  }) => Promise<{ readonly projectId: string }>;
  /** The project closed off (`projectIsolation.ts`); safe to ask again. */
  readonly closeOff: (projectId: string) => Promise<void>;
  /**
   * The project's `stack.updateProjectEnvs` processes, newest first, by id and status: the
   * container recipe writes the project's variables in one after its import, and a read of
   * `envIsolation` before it is through is stale.
   */
  readonly readProjectEnvWrites: (
    projectId: string,
  ) => Promise<ReadonlyArray<{ readonly id: string; readonly status: string }>>;
  /** The project's `envIsolation`, read back; undefined while the read has not caught up. */
  readonly readIsolation: (projectId: string) => Promise<string | undefined>;
  /**
   * `mate:closed-off` on the project, as the person: zcp's boot import of the runtimes waits for
   * it (pass 28). Idempotent.
   */
  readonly markClosedOff: (projectId: string) => Promise<void>;
  /**
   * The group's other Mates' keys extended to `READ_ONLY` on the project, where this person may
   * edit them; quietly nothing where they may not. Never fails the press.
   */
  readonly shareReach: (projectId: string) => Promise<void>;
  /**
   * The environment's group registration (`addGroupEnvironment.ts`); safe to ask again. Throws
   * with the reason a write did not go through.
   */
  readonly register: (projectId: string) => Promise<void>;
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
  /**
   * A press tried again: the step it resumes at, and the project the first press made. Only
   * steps that are safe to ask again resume (`resumableEnvironmentCreationStep`).
   */
  readonly resume?: {
    readonly from: number;
    readonly projectId: string;
    readonly projectName: string;
  };
  /** The platform took the project: everything after this step acts on it. */
  readonly onProjectAccepted?: (projectId: string) => void;
}

/** Between reads of a project's `envIsolation` while it has not caught up. */
export const ISOLATION_READ_MS = 1_000;
/** How many reads a close-off makes before it writes, or gives up: about ten seconds. */
export const ISOLATION_READS = 10;

/** A close-off's reads that must say closed before the mark, and the time between them. */
export const ISOLATION_CONFIRM_READS = 2;
export const ISOLATION_CONFIRM_MS = 2_000;
/**
 * How long a close-off waits for the container recipe's `stack.updateProjectEnvs`, created after
 * the import, to finish: past it, it goes on — the isolation it then writes and reads back twice
 * is the guard, and a stuck write is not the press's.
 */
export const RECIPE_ENV_WRITE_CAP_MS = 30_000;
export const RECIPE_ENV_WRITE_POLL_MS = 1_000;

/** The idempotent steps' tries: the platform's index catching up is the usual "not yet". */
export const PRESS_STEP_ATTEMPTS = 4;
export const PRESS_STEP_RETRY_MS = 2_000;

/**
 * The steps a press tried again may resume at: each is safe to ask again. An import of services
 * is not — a second one is refused for the hostnames the first made — so a creation that stopped
 * there, or at the project itself, is removed rather than resumed.
 */
export function resumableEnvironmentCreationStep(step: EnvironmentCreationStep): boolean {
  return (
    step.kind === "import-container" ||
    step.kind === "close-off" ||
    step.kind === "register" ||
    step.kind === "share-reach"
  );
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

  let projectId: string | undefined = input.resume?.projectId;
  let projectName: string | undefined = input.resume?.projectName;
  let serviceName: string | undefined;
  let deployments: ReadonlyArray<ServiceDeployment> = [];
  /**
   * The project's variable writes before this press imported its container: null where they
   * could not be read; undefined where this press imported none.
   */
  let envWritesBefore: ReadonlySet<string> | null | undefined;
  /**
   * `envIsolation` as soon as it reads at all, a second apart for about ten seconds; undefined
   * while it never did. A read that answers is the answer, open or closed.
   */
  const readIsolation = async (target: string): Promise<string | undefined> => {
    for (let read = 1; ; read += 1) {
      // A read that failed is asked again like one not caught up, and said once none is left.
      const answer = await input.platform.readIsolation(target).then(
        (isolation) => ({ isolation }),
        (cause: unknown) => ({ cause }),
      );
      assertCurrent();
      if ("isolation" in answer && answer.isolation !== undefined) return answer.isolation;
      if (read >= ISOLATION_READS) {
        if ("cause" in answer) throw answer.cause;
        return undefined;
      }
      await sleep(ISOLATION_READ_MS);
      assertCurrent();
    }
  };

  /**
   * Two reads two seconds apart that say closed, writing isolation wherever one says anything
   * else — once, and the two reads asked again after it.
   */
  const confirmClosed = async (target: string): Promise<void> => {
    let written = false;
    for (let closedReads = 0; closedReads < ISOLATION_CONFIRM_READS;) {
      if (closedReads > 0) {
        await sleep(ISOLATION_CONFIRM_MS);
        assertCurrent();
      }
      const isolation = await readIsolation(target);
      if (isolation === undefined) throw new Error("The project's isolation could not be read.");
      if (readsClosed(isolation)) {
        closedReads += 1;
        continue;
      }
      if (written) throw new Error("The project does not read as closed off yet.");
      await input.platform.closeOff(target);
      assertCurrent();
      written = true;
      closedReads = 0;
    }
  };

  /** An idempotent step, tried again while it answers "not yet". */
  const withTries = async (attempt: () => Promise<void>): Promise<void> => {
    for (let tried = 1; ; tried += 1) {
      try {
        await attempt();
        return;
      } catch (cause) {
        if (tried >= PRESS_STEP_ATTEMPTS) throw cause;
      }
      assertCurrent();
      await sleep(PRESS_STEP_RETRY_MS);
      assertCurrent();
    }
  };
  const accept = (id: string) => {
    projectId = id;
    input.onProjectAccepted?.(id);
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
          const project = await input.platform.createProject({
            clientId: input.clientId,
            name: step.name,
            tagList: step.tagList,
            ...(step.location === undefined ? {} : { location: step.location }),
          });
          // Named before the wait: a creation the platform then fails has
          // still made a project, and the outcome must say which one.
          projectName = step.name;
          accept(project.id);
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
          projectName = step.name;
          accept(imported.projectId);
          break;
        }
        case "import-container": {
          // What has written the project's variables so far: the recipe's write is the one the
          // close-off then waits for. Unknown where it could not be read.
          envWritesBefore = await input.platform
            .readProjectEnvWrites(requireProject(projectId))
            .then(
              (writes): ReadonlySet<string> | null => new Set(writes.map((write) => write.id)),
              (): ReadonlySet<string> | null => null,
            );
          const imported = await input.platform.importDevelopmentContainer({
            projectId: requireProject(projectId),
            projectName: projectName ?? "",
            agents: step.agents,
            ...(step.runtimes === undefined ? {} : { setupRuntimesYaml: step.runtimes.yaml }),
          });
          serviceName = imported.serviceName;
          if (!imported.imported) envWritesBefore = undefined;
          break;
        }
        case "close-off": {
          const target = requireProject(projectId);
          // The read trails the platform, and zcp imports the runtimes on the mark alone: the
          // recipe's own write of the project's variables is waited out first, isolation is
          // written wherever a read says anything but closed, and the mark goes only on two
          // reads, two seconds apart, that say closed.
          if (step.isolated !== true) {
            await awaitRecipeEnvWrite({
              projectId: target,
              platform: input.platform,
              before: envWritesBefore,
              now,
              sleep,
              assertCurrent,
            });
            await confirmClosed(target);
          }
          await withTries(() => input.platform.markClosedOff(target));
          break;
        }
        case "share-reach": {
          const target = requireProject(projectId);
          // Quietly nothing where it cannot: the group-reach reconcile gives the sight later.
          await input.platform.shareReach(target).catch(() => undefined);
          break;
        }
        case "register": {
          const target = requireProject(projectId);
          // A Mate is closed off by now: a refused registration leaves it running, waiting for
          // an owner to register it (*Finish setup*). A stage or a production has nothing else
          // that makes it whole, and stops here.
          const stopsHere = !input.steps.slice(0, index).some((made) => made.kind === "close-off");
          try {
            await withTries(() => input.platform.register(target));
          } catch (cause) {
            if (stopsHere) throw cause;
            assertCurrent();
            mark(index, { state: "failed", error: describeError(cause), finishedAtMs: now() });
            continue;
          }
          break;
        }
        case "import-recipe":
        case "import-managed": {
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
          deployments = await awaitServices({
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
 * what each runs, or a failure naming what is still on its way. The read that
 * saw them all settled is the evidence: an `ACTIVE` service runs something it
 * does not name, a `READY_TO_DEPLOY` one runs nothing.
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
}): Promise<ReadonlyArray<ServiceDeployment>> {
  const startedAt = input.now();
  for (let reads = 1; ; reads += 1) {
    input.assertCurrent();
    const services = await input.platform.readObservedServices(input.projectId);
    input.assertCurrent();
    const pending = services.filter(
      (service) => service.status !== "ACTIVE" && service.status !== UNDEPLOYED_STATUS,
    );
    if (services.length > 0 && pending.length === 0) {
      const asOf = { ordinal: reads, atMs: input.now() };
      return services.map((service) => ({
        service: service.name,
        deployment: {
          state: "known",
          value:
            service.status === UNDEPLOYED_STATUS
              ? { kind: "none" }
              : { kind: "running", activatedAt: null, version: deployedVersion(undefined) },
          asOf,
          coverage: "complete",
          freshness: { kind: "settled" },
        },
      }));
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

const ENV_WRITE_UNDER_WAY = new Set(["PENDING", "RUNNING"]);

/**
 * Waits out the container recipe's write of the project's variables: through once a write this
 * press's import made — one not there before it — has ended and none is under way; for a press that
 * imported no container here, once none is under way. Never past {@link RECIPE_ENV_WRITE_CAP_MS};
 * a read that fails counts as not through yet.
 */
async function awaitRecipeEnvWrite(input: {
  readonly projectId: string;
  readonly platform: EnvironmentCreationPlatform;
  /** The writes before the import; null where unread, undefined where nothing was imported. */
  readonly before: ReadonlySet<string> | null | undefined;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly assertCurrent: () => void;
}): Promise<void> {
  const deadline = input.now() + RECIPE_ENV_WRITE_CAP_MS;
  for (;;) {
    const writes = await input.platform.readProjectEnvWrites(input.projectId).then(
      (answer) => answer,
      () => null,
    );
    input.assertCurrent();
    if (writes !== null) {
      const underWay = writes.some((write) => ENV_WRITE_UNDER_WAY.has(write.status));
      const before = input.before;
      const recipeDone =
        before === undefined ||
        writes.some((write) => !before?.has(write.id) && !ENV_WRITE_UNDER_WAY.has(write.status));
      if (!underWay && recipeDone) return;
    }
    if (input.now() >= deadline) return;
    await input.sleep(RECIPE_ENV_WRITE_POLL_MS);
    input.assertCurrent();
  }
}
