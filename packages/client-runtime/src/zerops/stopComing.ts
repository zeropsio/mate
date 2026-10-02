/**
 * A stage or a production coming up, step by step, and the first deploy it waits for — the one
 * rule every surface says it by: the left menu's project heading ("Stage coming up · building the
 * app"), the projects page's stage line, a phone's.
 *
 * What it says is what the platform and the group's Gitea show, never a step that is not under
 * way. Run 4 (2026-10-02) caught two that were not: the import's own no-code deploy of the app
 * read "building the app", and a stage whose services stood ready read "turning its address on"
 * for 4.6 min while its first deploy waited for a group runner whose build had failed. The
 * platform turns a stage's address on only after its first build, so the address step comes only
 * after a deploy ran; before one, the stage waits for its first deploy, and says on what.
 *
 * The broker asks for a stage's deploy of `main` as its declaration lands
 * (`mate/deploy/{environment}/{service}` pending from then), and the group's runner runs it. A
 * runner that cannot run holds that deploy, and the line says so, and why — in the broker's own
 * terms (gitea-mate, pass 34): a runner not there yet, one being built, one whose build failed
 * (the broker deletes and imports it again on its own, so nobody is asked to fix it), and a
 * stopped one, which the broker wakes as a job queues.
 *
 * Pure: no network, no clock of its own, no platform globals (rule R1).
 *
 * @module stopComing
 */

/** Where an environment coming up has got. */
export type ComingStep =
  | "project"
  | "database"
  /** The platform makes its runtime, and the import's own no-code deploy readies it. */
  | "app"
  | "build"
  /** Its services stand ready and nothing asked for a deploy yet. */
  | "awaiting-deploy"
  /** A deploy of `main` is asked for and the runner can run it. */
  | "deploy-on-its-way"
  | "address";

/** Why the group's runner cannot run a deploy now. */
export type RunnerTrouble =
  /** Its service is not in the Gitea project, or is being deleted to be imported again. */
  | "missing"
  /** Imported, its build under way. */
  | "building"
  /** Its build failed, or never finished: the broker imports it again on its own. */
  | "failed"
  /** Stopped, stopping or starting: the broker starts it as a job queues. */
  | "waking";

/** An environment coming up, or one that did not come up. */
export type StopComing =
  | { readonly kind: "coming"; readonly step: ComingStep }
  /** A deploy of `main` is asked for and waits for the group's runner. */
  | { readonly kind: "coming"; readonly step: "runner"; readonly why: RunnerTrouble }
  | { readonly kind: "failed"; readonly reason: string };

/** The group's runner, as the Gitea project's services show it. */
export type GroupRunner =
  | { readonly kind: "able" }
  | { readonly kind: "unable"; readonly why: RunnerTrouble };

/** Where a stage's first deploy stands while it runs nothing. */
export type FirstDeploy =
  /** Nothing asked for one yet: `main` has no code, or the group does not declare the stage. */
  | { readonly kind: "awaited" }
  /** Asked for, and nothing known holds it. */
  | { readonly kind: "on-its-way" }
  /** Asked for, and the group's runner cannot run it. */
  | { readonly kind: "runner"; readonly why: RunnerTrouble };

/**
 * How long after its project was made an environment may still be coming up. The owner's stage
 * took 131 s (project 32 s, database 50 s, build 63–130 s, address 131 s); a first build can take
 * several minutes more. Past this, what it lacks is the pill's to say — not deployed yet, down —
 * not a step of its coming up.
 */
export const COMING_UP_WINDOW_MS = 15 * 60_000;

/**
 * How long a runner may stand imported and not deployed while its build may still be running:
 * twice the good build run 4 measured (121.5 s; the failed one took 54 s). Past it, its build
 * failed or never finished — what the broker replaces (it calls one broken after a failed build,
 * or 20 min). The account holds no process of the Gitea project, so its age is what says it.
 */
export const RUNNER_BUILD_MS = 4 * 60_000;

/** Zerops hostnames are `[a-z0-9]`, 25 at most. */
const HOSTNAME_MAX = 25;

/**
 * The group's runner service in the account's Gitea project: `runner` + the group's slug with
 * `-` removed, cut to 25 characters (gitea-mate `docs/vocabulary.md`).
 */
export function runnerHostname(slug: string): string {
  return `runner${slug.replaceAll("-", "")}`.slice(0, HOSTNAME_MAX);
}

const failing = (status: string) => /FAIL/u.test(status);

/** One service of the account's Gitea project, as the account holds it. */
export interface GiteaProjectService {
  readonly name: string;
  readonly status: string;
  /** When it was imported. */
  readonly created?: string | undefined;
}

/** A runner's status, as what it means for a deploy waiting on it; unknown says nothing. */
function runnerOf(runner: GiteaProjectService, nowMs: number): GroupRunner | undefined {
  if (failing(runner.status)) return { kind: "unable", why: "failed" };
  switch (runner.status) {
    case "ACTIVE":
    case "UPGRADING":
      return { kind: "able" };
    case "NEW":
    case "CREATING":
    case "READY_TO_DEPLOY": {
      const created = runner.created === undefined ? Number.NaN : Date.parse(runner.created);
      const stuck = !Number.isNaN(created) && nowMs - created >= RUNNER_BUILD_MS;
      return { kind: "unable", why: stuck ? "failed" : "building" };
    }
    case "STOPPED":
    case "STOPPING":
    case "STARTING":
      return { kind: "unable", why: "waking" };
    case "DELETING":
      return { kind: "unable", why: "missing" };
    default:
      return undefined;
  }
}

/**
 * The group's runner, from the services of the account's Gitea project as the account already
 * holds them (no read of its own); `undefined` while they are not read, or its status says
 * nothing known.
 */
export function groupRunner(input: {
  readonly slug: string;
  readonly services: ReadonlyArray<GiteaProjectService> | undefined;
  readonly nowMs: number;
}): GroupRunner | undefined {
  if (input.services === undefined) return undefined;
  const hostname = runnerHostname(input.slug);
  const runner = input.services.find((service) => service.name === hostname);
  return runner === undefined ? { kind: "unable", why: "missing" } : runnerOf(runner, input.nowMs);
}

/**
 * Where a stage's first deploy stands while it runs nothing: asked for once the group declares
 * the stage and `main` has code — the broker deploys `main` to a stage as its declaration lands —
 * and held by a runner that cannot run.
 */
export function firstDeploy(input: {
  /** The group's environments declare it. */
  readonly declared: boolean;
  /** `main` has code; `undefined` where nothing says either way. */
  readonly mainHasCode: boolean | undefined;
  readonly runner: GroupRunner | undefined;
}): FirstDeploy {
  if (!input.declared || input.mainHasCode !== true) return { kind: "awaited" };
  if (input.runner?.kind === "unable") return { kind: "runner", why: input.runner.why };
  return { kind: "on-its-way" };
}

const coming = (step: ComingStep): StopComing => ({ kind: "coming", step });

/** A runtime the platform is still making: its container, then the import's no-code deploy. */
const MAKING: ReadonlySet<string> = new Set(["NEW", "CREATING"]);

/**
 * Whether a stage or a production is coming up, and at which step, from what the platform says
 * of it: accepted and not listed yet, or its project still being made; then its services — a
 * database not running yet, its runtime being made, a build running; then a stage's first deploy
 * (`firstDeploy`); then, once a deploy ran, no public address. A runtime whose first build failed
 * did not come up.
 *
 * Production's first build is its first release: until one is pressed its runtime waits, which
 * is "nothing released yet", not a step of its coming up.
 */
export function stopComing(input: {
  readonly tier: "stage" | "production";
  /** Its creation was accepted and the listing does not hold its project yet. */
  readonly pending: boolean;
  readonly projectStatus: string | undefined;
  /** When its project was made; unknown is never "just made". */
  readonly createdAt: string | undefined;
  readonly nowMs: number;
  /** Its services as the platform lists them; `undefined` while unread. */
  readonly services:
    | ReadonlyArray<{
        readonly hostname: string;
        readonly status: string;
        readonly runtime: boolean;
      }>
    | undefined;
  /** A deploy runs on it (`deployBuilding`). */
  readonly building: boolean;
  /** It has run a deploy: a version is known, or the platform says one runs. */
  readonly deployed: boolean;
  /** Its public routes. */
  readonly routes: number;
  /** A stage's first deploy, while it runs nothing (`firstDeploy`); unknown is awaited. */
  readonly firstDeploy: FirstDeploy | undefined;
}): StopComing | undefined {
  if (input.pending) return coming("project");
  if (input.projectStatus === "STOPPED") return undefined;
  if (input.projectStatus !== undefined && input.projectStatus !== "ACTIVE") {
    return coming("project");
  }
  const made = input.createdAt === undefined ? Number.NaN : Date.parse(input.createdAt);
  if (Number.isNaN(made) || input.nowMs - made >= COMING_UP_WINDOW_MS) return undefined;
  if (input.services === undefined) return coming("project");
  const runtimes = input.services.filter((service) => service.runtime);
  const others = input.services.filter((service) => !service.runtime);
  const running = (status: string) => status === "ACTIVE";
  if (input.deployed && runtimes.every(({ status }) => running(status)) && input.routes > 0) {
    return undefined;
  }
  const brokenOther = others.find(({ status }) => failing(status));
  if (brokenOther !== undefined && !input.deployed) {
    return { kind: "failed", reason: `the ${brokenOther.hostname} didn’t start` };
  }
  if (others.some(({ status }) => !running(status) && !failing(status))) {
    return coming("database");
  }
  const broken = runtimes.find(({ status }) => failing(status));
  if (broken !== undefined) {
    return input.deployed
      ? undefined
      : { kind: "failed", reason: `the ${broken.hostname}’s build failed` };
  }
  if (input.building) return coming("build");
  // The import's own deploy carries no code: the app being added, never a build.
  if (runtimes.some(({ status }) => MAKING.has(status))) return coming("app");
  if (!input.deployed) {
    if (input.tier === "production") return undefined;
    const first = input.firstDeploy ?? { kind: "awaited" };
    switch (first.kind) {
      case "awaited":
        return coming("awaiting-deploy");
      case "on-its-way":
        return coming("deploy-on-its-way");
      case "runner":
        return { kind: "coming", step: "runner", why: first.why };
    }
  }
  if (runtimes.some(({ status }) => !running(status))) return coming("build");
  if (input.routes === 0) return coming("address");
  return undefined;
}

const STEP_WORDS: Record<ComingStep, string> = {
  project: "making the project",
  database: "adding the database",
  app: "adding the app",
  build: "building the app",
  "awaiting-deploy": "waiting for its first deploy",
  "deploy-on-its-way": "its first deploy is on its way",
  address: "turning its address on",
};

/** Why the runner holds a deploy, in the words after "waiting for the runner". */
export const RUNNER_TROUBLE_WORDS: Record<RunnerTrouble, string> = {
  missing: "it isn’t there",
  building: "it’s being built",
  failed: "its build failed, the broker rebuilds it",
  waking: "it’s waking up",
};

/** "waiting for the runner · its build failed" */
const runnerWait = (why: RunnerTrouble) => `waiting for the runner · ${RUNNER_TROUBLE_WORDS[why]}`;

/** A step of an environment coming up, in the words after "Stage coming up · ". */
export function comingWords(coming: Extract<StopComing, { readonly kind: "coming" }>): string {
  return coming.step === "runner" ? runnerWait(coming.why) : STEP_WORDS[coming.step];
}

/** A stage's first deploy on its way, where its line would say nothing is deployed. */
export const FIRST_DEPLOY_ON_ITS_WAY = "First deploy on its way";

/**
 * What a stage that runs nothing says of its first deploy, where its line says what it runs:
 * `undefined` while nothing asked for one — the line's own "Nothing deployed yet" stands.
 */
export function firstDeployLine(first: FirstDeploy | undefined): string | undefined {
  switch (first?.kind) {
    case "on-its-way":
      return FIRST_DEPLOY_ON_ITS_WAY;
    case "runner":
      return `Waiting for the runner · ${RUNNER_TROUBLE_WORDS[first.why]}`;
    default:
      return undefined;
  }
}
