/**
 * A stage or a production coming up, step by step, and the first deploy it waits for — the one
 * rule every surface says it by: the left menu's project heading ("Stage coming up · building the
 * app"), the projects page's stage line, a phone's.
 *
 * What it says is what the platform and HQ show, never a step that is not under way. Run 4
 * (2026-10-02) caught two that were not: the import's own no-code deploy of the app read "building
 * the app", and a stage whose services stood ready read "turning its address on" for 4.6 min while
 * its first deploy had not run. The platform turns a stage's address on only after its first
 * build, so the address step comes only after a deploy ran; before one, the stage waits for its
 * first deploy.
 *
 * HQ deploys `main` to a stage itself, as jobs (`HqEnvironment.jobs`): queued, submitting,
 * building, then live, failed by the build, refused by HQ — nothing is tried twice — or skipped.
 * "On its way" is said only while HQ has a job of it in flight; a job always ends, so a first
 * deploy that never comes reads "Nothing deployed yet" again, never on its way for ever. What holds
 * it, the line says, as main said its runner did: HQ holds no deploy key that works for the stage.
 *
 * Whether it is coming up at all is its owners' word, never its age: its own import while the
 * platform says something of it is being made (a project CREATING, a service NEW or CREATING), and
 * past that only while HQ is still bringing it up (`HqEnvironment.birth`: the rollout its attach
 * asked for, not ended). One HQ did not bring up, or whose birth ended, says what it lacks on its
 * pill — a stopped database, nothing deployed, no address — never a step of coming up.
 *
 * Pure: no network, no clock of its own, no platform globals (rule R1).
 *
 * @module stopComing
 */
import type { EnvironmentBirth } from "@t3tools/shared/hqDeploys";

import { deployFollowText } from "./hq/deployAnswer.ts";
import { type HqJob, jobInFlight } from "./hq/environments.ts";

/** Where an environment coming up has got. */
export type ComingStep =
  | "project"
  | "database"
  /** The platform makes its runtime, and the import's own no-code deploy readies it. */
  | "app"
  | "build"
  /** Its services stand ready and nothing asked for a deploy yet. */
  | "awaiting-deploy"
  /** HQ has a deploy of it queued or under way. */
  | "deploy-on-its-way"
  /** HQ holds no deploy key that works for it, and deploys nothing until somebody mints one. */
  | "awaiting-key"
  | "address";

/** An environment coming up, or one that did not come up. */
export type StopComing =
  | { readonly kind: "coming"; readonly step: ComingStep }
  | { readonly kind: "failed"; readonly reason: string };

/** Where a stage's first deploy stands while it runs nothing. */
export type FirstDeploy =
  | { readonly kind: "setting-up"; readonly step: "project" | "database" | "app" }
  /** HQ has none in flight: nothing to promise. */
  | { readonly kind: "awaited" }
  /** HQ has a job of it queued, submitting or building. */
  | { readonly kind: "on-its-way" }
  /** HQ holds no deploy key that works for the stage: it deploys nothing until one is minted. */
  | { readonly kind: "held" }
  /**
   * Zerops ended a build of it HQ did not make failed with nothing running
   * (`Deployment.failedBuild`), or HQ says its build failed, or HQ refused it.
   */
  | { readonly kind: "failed"; readonly reason?: string | undefined }
  /** Following ended without an owner outcome; the next actor/action remains visible. */
  | { readonly kind: "unresolved"; readonly reason: string };

/** Whether HQ is still bringing an environment up: its birth told, and not ended. */
const beingBorn = (birth: EnvironmentBirth | null | undefined): boolean => birth?.ended === false;

const failing = (status: string) => /FAIL/u.test(status);

/** A first deploy that failed, with HQ's words for why where it has some. */
const failedFirst = (job: HqJob): FirstDeploy => ({
  kind: "failed",
  ...(job.reason == null ? {} : { reason: job.reason }),
});

/**
 * Where a stage's first deploy stands by HQ's jobs of it: failed where a build of it failed, which
 * is final; held while HQ holds no deploy key that works for the stage; failed where HQ refused it,
 * for nothing is tried twice; on its way while a job is queued, submitting or building. A job says
 * where it stands, so no clock does.
 */
export function firstDeploy(input: {
  /** HQ's newest job of each of the stage's services (`EnvironmentRow.deploys`). */
  readonly deploys: ReadonlyArray<HqJob>;
  /** HQ holds no deploy key that works for the stage (`EnvironmentRow.keyGap`). */
  readonly keyGap: boolean;
}): FirstDeploy {
  const built = input.deploys.find(({ state }) => state === "failed");
  if (built !== undefined) return failedFirst(built);
  if (input.keyGap) return { kind: "held" };
  const refused = input.deploys.find(({ state }) => state === "refused");
  if (refused !== undefined) return failedFirst(refused);
  const unresolved = input.deploys.find(({ state }) => state === "unresolved");
  if (unresolved !== undefined)
    return { kind: "unresolved", reason: deployFollowText(unresolved)! };
  return input.deploys.some(jobInFlight) ? { kind: "on-its-way" } : { kind: "awaited" };
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
  /** HQ bringing it up (`HqEnvironment.birth`); none where HQ did not, or nothing told yet. */
  readonly birth: EnvironmentBirth | null | undefined;
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
  // What the platform says it is making is its import's own step, whoever brought it up; past
  // that, only HQ still bringing it up makes it coming up.
  if (!beingBorn(input.birth)) {
    if (others.some(({ status }) => MAKING.has(status))) return coming("database");
    return runtimes.some(({ status }) => MAKING.has(status)) ? coming("app") : undefined;
  }
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
    // What runs there not known yet: the neutral wait, never a claim about its deploy.
    const first = deployed === false ? (input.firstDeploy ?? { kind: "awaited" }) : AWAITED;
    switch (first.kind) {
      case "setting-up":
        return coming(first.step);
      case "awaited":
        return coming("awaiting-deploy");
      case "on-its-way":
        return coming("deploy-on-its-way");
      case "held":
        return coming("awaiting-key");
      case "failed":
        return { kind: "failed", reason: "its first deploy failed" };
      case "unresolved":
        return undefined;
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
 * is stopped or being deleted, or its services are unread under an active project (a reload). Past
 * what the platform says it is making, only while HQ is still bringing it up. A surface that cannot read the platform's steps still keeps their order by it:
 * the projects page's cell says nothing of a first deploy, or of the runner, before this is done.
 */
export function stopImport(input: {
  readonly projectStatus: string | undefined;
  /** HQ bringing it up (`HqEnvironment.birth`); none where HQ did not, or nothing told yet. */
  readonly birth: EnvironmentBirth | null | undefined;
  /** Its services as the platform lists them; `undefined` while unread. */
  readonly services: ReadonlyArray<PlatformService> | undefined;
}): "project" | "database" | "app" | undefined {
  if (input.projectStatus === MAKING_PROJECT) return "project";
  if (input.projectStatus !== undefined && input.projectStatus !== "ACTIVE") return undefined;
  if (input.services === undefined) return undefined;
  if (input.services.some(({ status }) => failing(status))) return undefined;
  const runtimes = input.services.filter((service) => service.runtime);
  if (!beingBorn(input.birth)) {
    if (input.services.some((service) => !service.runtime && MAKING.has(service.status))) {
      return "database";
    }
    return runtimes.some(({ status }) => MAKING.has(status)) ? "app" : undefined;
  }
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
    /** HQ bringing it up (`HqEnvironment.birth`). */
    readonly birth?: EnvironmentBirth | null | undefined;
  };
  readonly projectStatus: string | undefined;
  readonly services: Parameters<typeof stopComing>[0]["services"];
  /** A deploy runs on it (`deployBuilding`). */
  readonly building: boolean;
  readonly routes: number;
}

/** Where a listed stage or production coming up has got — the one reading every surface makes. */
export function listedStopComing(
  tier: "stage" | "production",
  listed: ListedStop,
): StopComing | undefined {
  return stopComing({
    tier,
    pending: false,
    projectStatus: listed.projectStatus,
    birth: listed.stop.birth,
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

const STEP_WORDS: Record<Exclude<ComingStep, "awaiting-key">, string> = {
  project: "making the project",
  database: "adding the database",
  app: "adding the app",
  build: "building the app",
  "awaiting-deploy": "awaiting a first deploy",
  "deploy-on-its-way": "first deploy on its way",
  address: "turning its address on",
};

/** What a stage HQ holds for a deploy key says of itself: nothing comes up until one is minted. */
const awaitsKey = (subject: string) => `${subject} awaits a deploy key`;

/**
 * The line an environment coming up says, about `subject` ("Stage", a stage's own name,
 * "Production"): "Stage coming up · building the app", or — held, so nothing comes up until
 * somebody mints a key — its own fact, "Stage awaits a deploy key" (630d8f1bb's rule for main's
 * runner). Each fits the menu’s narrowest line, 241 px of words.
 */
export function comingLine(
  subject: string,
  coming: Extract<StopComing, { readonly kind: "coming" }>,
): { readonly fact: string; readonly rest: string | undefined } {
  return coming.step === "awaiting-key"
    ? { fact: awaitsKey(subject), rest: undefined }
    : { fact: `${subject} coming up`, rest: STEP_WORDS[coming.step] };
}

/**
 * The tone a stage's first deploy line wears beside its dot: busy while on its way or being set up,
 * failed where it failed, off while it waits.
 */
export function firstDeployTone(first: FirstDeploy | undefined): "busy" | "failed" | "off" {
  switch (first?.kind) {
    case "on-its-way":
    case "setting-up":
      return "busy";
    case "failed":
      return "failed";
    default:
      return "off";
  }
}

/** A stage's line while its creation, or its own import, is under way. */
export const STAGE_SETTING_UP = "Setting up a stage…";

/** A stage whose first deploy failed: its build, as Zerops or HQ ended it, or HQ refusing it. */
export const FIRST_DEPLOY_FAILED = "First deploy failed";

/** A stage's first deploy on its way, where its line would say nothing is deployed. */
export const FIRST_DEPLOY_ON_ITS_WAY = "First deploy on its way";

/** A stage's first deploy held: HQ holds no deploy key that works for it — the menu's words. */
const FIRST_DEPLOY_AWAITS_KEY = awaitsKey("Stage");

/**
 * What a stage that runs nothing says of its first deploy, where its line says what it runs:
 * `undefined` while nothing asked for one — the line's own "Nothing deployed yet" stands.
 */
export function firstDeployLine(first: FirstDeploy | undefined): string | undefined {
  switch (first?.kind) {
    case "on-its-way":
      return FIRST_DEPLOY_ON_ITS_WAY;
    case "held":
      return FIRST_DEPLOY_AWAITS_KEY;
    case "failed":
      return FIRST_DEPLOY_FAILED;
    case "unresolved":
      return first.reason;
    case "setting-up":
      return STAGE_SETTING_UP;
    default:
      return undefined;
  }
}
