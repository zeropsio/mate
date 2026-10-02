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
 * runner that cannot run holds that deploy, and the line says so, and why — only what the client
 * sees of it: not there, being imported, imported and not started (building or its build failed:
 * one word true either way, since which broker an org runs, and whether it rebuilds a runner, is
 * not the app's to know), or stopped, which the broker wakes as a job queues.
 *
 * "On its way" is said only of a runner known able, and only for a window after the deploy was
 * asked for: a first deploy that never comes reads "Nothing deployed yet" again, never on its way
 * for ever.
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
  /** Its service is not in the Gitea project, or is being deleted. */
  | "missing"
  /** Being imported. */
  | "building"
  /** Imported and not started: its build runs, or failed — the client cannot tell which. */
  | "not-started"
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
  /** Asked for within the window, and the group's runner is known able to run it. */
  | { readonly kind: "on-its-way" }
  /** Asked for, and the group's runner cannot run it. */
  | { readonly kind: "runner"; readonly why: RunnerTrouble }
  /**
   * A build of it was seen to end with nothing running (`Deployment.afterBuild`), or the job that
   * deploys it failed on `main`'s head before any build (`firstDeployFailure`): `reason` only where
   * the broker's status carries the job's own words.
   */
  | { readonly kind: "failed"; readonly reason?: string };

/**
 * How long after its project was made an environment may still be coming up. The owner's stage
 * took 131 s (project 32 s, database 50 s, build 63–130 s, address 131 s); a first build can take
 * several minutes more. Past this, what it lacks is the pill's to say — not deployed yet, down —
 * not a step of its coming up.
 */
export const COMING_UP_WINDOW_MS = 15 * 60_000;

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
}

/** A runner's status, as what it means for a deploy waiting on it; unknown says nothing. */
function runnerOf(status: string): GroupRunner | undefined {
  if (failing(status)) return { kind: "unable", why: "not-started" };
  switch (status) {
    case "ACTIVE":
    case "UPGRADING":
      return { kind: "able" };
    case "NEW":
    case "CREATING":
      return { kind: "unable", why: "building" };
    case "READY_TO_DEPLOY":
      return { kind: "unable", why: "not-started" };
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
}): GroupRunner | undefined {
  if (input.services === undefined) return undefined;
  const hostname = runnerHostname(input.slug);
  const runner = input.services.find((service) => service.name === hostname);
  return runner === undefined ? { kind: "unable", why: "missing" } : runnerOf(runner.status);
}

/**
 * Where a stage's first deploy stands while it runs nothing: asked for once the group declares
 * the stage and `main` has code — the broker deploys `main` to a stage as its declaration lands —
 * held by a runner known unable to run, or on its way behind one known able — either only for
 * {@link COMING_UP_WINDOW_MS} after it was asked for. A runner not known, or a window gone by,
 * is the neutral wait: nothing is promised that the client cannot see.
 */
export function firstDeploy(input: {
  /** The group's environments declare it. */
  readonly declared: boolean;
  /** `main` has code; `undefined` where nothing says either way. */
  readonly mainHasCode: boolean | undefined;
  readonly runner: GroupRunner | undefined;
  /** The later of the stage's making and `main`'s last code landing; `undefined` unknown. */
  readonly askedAt: string | undefined;
  readonly nowMs: number;
}): FirstDeploy {
  if (!input.declared || input.mainHasCode !== true) return { kind: "awaited" };
  if (input.runner === undefined) return { kind: "awaited" };
  // Every word about the deploy is bounded by its ask: past the window no job is queued — the
  // broker stops a runner 15 min after its last one — and nothing is promised.
  const asked = input.askedAt === undefined ? Number.NaN : Date.parse(input.askedAt);
  if (Number.isNaN(asked) || input.nowMs - asked >= COMING_UP_WINDOW_MS) return { kind: "awaited" };
  return input.runner.kind === "unable"
    ? { kind: "runner", why: input.runner.why }
    : { kind: "on-its-way" };
}

/**
 * Whether a stop has run a deploy, from its flow stop: a version is known, or it runs or fails
 * one; `false` where it is known to run nothing; `undefined` while that is not known — what runs
 * there unread, or a build of a version nothing names.
 */
export function stopDeployed(stop: {
  readonly state: "checking" | "empty" | "deploying" | "deployed" | "failed";
  readonly version: unknown;
}): boolean | undefined {
  if (stop.version !== undefined) return true;
  switch (stop.state) {
    case "empty":
      return false;
    case "deployed":
    case "failed":
      return true;
    default:
      return undefined;
  }
}

const coming = (step: ComingStep): StopComing => ({ kind: "coming", step });

const AWAITED: FirstDeploy = { kind: "awaited" };

/** A project the platform is still making; any other status but ACTIVE is no step of coming up. */
const MAKING_PROJECT = "CREATING";

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
  readonly services: ReadonlyArray<PlatformService> | undefined;
  /** A deploy runs on it (`deployBuilding`). */
  readonly building: boolean;
  /** It has run a deploy (`stopDeployed`); `undefined` while that is not known. */
  readonly deployed: boolean | undefined;
  /** Its public routes. */
  readonly routes: number;
  /** A stage's first deploy, while it runs nothing (`firstDeploy`); unknown is awaited. */
  readonly firstDeploy: FirstDeploy | undefined;
}): StopComing | undefined {
  if (input.pending) return coming("project");
  const made = input.createdAt === undefined ? Number.NaN : Date.parse(input.createdAt);
  if (Number.isNaN(made) || input.nowMs - made >= COMING_UP_WINDOW_MS) return undefined;
  if (input.projectStatus === MAKING_PROJECT) return coming("project");
  // Stopped, being deleted, or a status nobody named: not a step of its coming up.
  if (input.projectStatus !== undefined && input.projectStatus !== "ACTIVE") return undefined;
  // Its services unread (a reload): nothing is said until they are, never "making the project".
  if (input.services === undefined) return undefined;
  const runtimes = input.services.filter((service) => service.runtime);
  const others = input.services.filter((service) => !service.runtime);
  const running = (status: string) => status === "ACTIVE";
  // The platform turns a stage's address on only after its first build: one serving has run a
  // deploy, read or not (a reload, a refused process demand). A deploy over it — a redeploy, a
  // release, its runtime UPGRADING — is that deploy's to say, never the place coming up again.
  const deployed = input.deployed ?? (input.routes > 0 ? true : undefined);
  if (deployed === true && input.routes > 0) return undefined;
  const brokenOther = others.find(({ status }) => failing(status));
  if (brokenOther !== undefined && deployed !== true) {
    return { kind: "failed", reason: `the ${brokenOther.hostname} didn’t start` };
  }
  if (others.some(({ status }) => !running(status) && !failing(status))) {
    return coming("database");
  }
  const broken = runtimes.find(({ status }) => failing(status));
  if (broken !== undefined) {
    return deployed === true
      ? undefined
      : { kind: "failed", reason: `the ${broken.hostname}’s build failed` };
  }
  if (input.building) return coming("build");
  // The import's own deploy carries no code: the app being added, never a build — and a stage
  // listing no runtime yet is still having it added (run 5: "awaits the runner" at +696 s, while
  // the import ran until +710 s).
  if (runtimes.length === 0 && deployed !== true) return coming("app");
  if (runtimes.some(({ status }) => MAKING.has(status))) return coming("app");
  if (deployed !== true) {
    if (input.tier === "production") return undefined;
    // What runs there not known yet: the neutral wait, never a claim about the runner.
    const first = deployed === false ? (input.firstDeploy ?? { kind: "awaited" }) : AWAITED;
    switch (first.kind) {
      case "awaited":
        return coming("awaiting-deploy");
      case "on-its-way":
        return coming("deploy-on-its-way");
      case "runner":
        return { kind: "coming", step: "runner", why: first.why };
      case "failed":
        return { kind: "failed", reason: "its first deploy failed" };
    }
  }
  if (runtimes.some(({ status }) => !running(status))) return coming("build");
  if (input.routes === 0) return coming("address");
  return undefined;
}

/** One service of an environment, as the platform lists it (`summarizeEnvironmentServices`). */
export interface PlatformService {
  readonly hostname: string;
  readonly status: string;
  readonly runtime: boolean;
}

/**
 * Where an environment's own import has got, from what the platform says of it alone — the
 * coming-up steps that come before any word about its first deploy, in {@link stopComing}'s order:
 * its project being made (CREATING), a database not running yet, its app being added (none listed
 * yet, or being made). `undefined` once the import is done, where something failed, its project
 * is stopped or being deleted, its services are unread under an active project (a reload), or its
 * window went by. A surface that cannot read the platform's steps still keeps their order by it:
 * the projects page's cell says nothing of a first deploy, or of the runner, before this is done.
 */
export function stopImport(input: {
  readonly projectStatus: string | undefined;
  readonly createdAt: string | undefined;
  readonly nowMs: number;
  /** Its services as the platform lists them; `undefined` while unread. */
  readonly services: ReadonlyArray<PlatformService> | undefined;
}): "project" | "database" | "app" | undefined {
  const made = input.createdAt === undefined ? Number.NaN : Date.parse(input.createdAt);
  if (Number.isNaN(made) || input.nowMs - made >= COMING_UP_WINDOW_MS) return undefined;
  if (input.projectStatus === MAKING_PROJECT) return "project";
  if (input.projectStatus !== undefined && input.projectStatus !== "ACTIVE") return undefined;
  if (input.services === undefined) return undefined;
  if (input.services.some(({ status }) => failing(status))) return undefined;
  const runtimes = input.services.filter((service) => service.runtime);
  if (input.services.some((service) => !service.runtime && service.status !== "ACTIVE")) {
    return "database";
  }
  if (runtimes.length === 0 || runtimes.some(({ status }) => MAKING.has(status))) return "app";
  return undefined;
}

/** A listed stop as its flow and the platform's listing of its project hold it. */
export interface ListedStop {
  /** Its flow stop (`GroupFlowStop`): what it runs, and its first deploy. */
  readonly stop: {
    readonly state: "checking" | "empty" | "deploying" | "deployed" | "failed";
    readonly version: unknown;
    readonly firstDeploy?: FirstDeploy | undefined;
  };
  readonly projectStatus: string | undefined;
  readonly createdAt: string | undefined;
  readonly services: Parameters<typeof stopComing>[0]["services"];
  /** A deploy runs on it (`deployBuilding`). */
  readonly building: boolean;
  readonly routes: number;
}

/** Where a listed stage or production coming up has got — the one reading every surface makes. */
export function listedStopComing(
  tier: "stage" | "production",
  listed: ListedStop,
  nowMs: number,
): StopComing | undefined {
  return stopComing({
    tier,
    pending: false,
    projectStatus: listed.projectStatus,
    createdAt: listed.createdAt,
    nowMs,
    services: listed.services,
    building: listed.building,
    deployed: stopDeployed(listed.stop),
    routes: listed.routes,
    firstDeploy: listed.stop.firstDeploy,
  });
}

/**
 * Whether a listed stop serves: a deploy ran there and it has a public address. Only that lands
 * a stage "up" — never a coming-up window running out.
 */
export function stopServes(listed: Pick<ListedStop, "stop" | "routes">): boolean {
  return stopDeployed(listed.stop) === true && listed.routes > 0;
}

const STEP_WORDS: Record<ComingStep, string> = {
  project: "making the project",
  database: "adding the database",
  app: "adding the app",
  build: "building the app",
  "awaiting-deploy": "awaiting a first deploy",
  "deploy-on-its-way": "first deploy on its way",
  address: "turning its address on",
};

/** Why the runner holds a deploy, after "Stage awaits the runner · ". */
export const RUNNER_TROUBLE_WORDS: Record<RunnerTrouble, string> = {
  missing: "it isn’t there",
  building: "it’s being built",
  // Building, or its build failed: true either way, and asks nobody to fix it.
  "not-started": "it hasn’t started",
  waking: "it’s waking up",
};

/**
 * The line an environment coming up says, about `subject` ("Stage", a stage's own name,
 * "Production"): "Stage coming up · building the app", or — a new truth, so its own words —
 * "Stage awaits the runner · it’s being built". Each fits the menu’s narrowest line, 241 px of words.
 */
export function comingLine(
  subject: string,
  coming: Extract<StopComing, { readonly kind: "coming" }>,
): { readonly fact: string; readonly rest: string } {
  return coming.step === "runner"
    ? { fact: `${subject} awaits the runner`, rest: RUNNER_TROUBLE_WORDS[coming.why] }
    : { fact: `${subject} coming up`, rest: STEP_WORDS[coming.step] };
}

/**
 * The tone a stage's first deploy line wears beside its dot: busy while on its way, failed where it
 * failed, off while it waits.
 */
export function firstDeployTone(first: FirstDeploy | undefined): "busy" | "failed" | "off" {
  return first?.kind === "on-its-way" ? "busy" : first?.kind === "failed" ? "failed" : "off";
}

/** A stage whose first build was seen to end with nothing running. */
export const FIRST_DEPLOY_FAILED = "First deploy failed";

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
    case "failed":
      return FIRST_DEPLOY_FAILED;
    default:
      return undefined;
  }
}
