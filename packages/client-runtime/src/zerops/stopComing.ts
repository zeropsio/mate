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
 * HQ deploys `main` to a stage itself, and records each deploy it asks for (`HqEnvironment.deploys`):
 * queued, deploying, live or failed — by the build (final) or by HQ (asked again on its next pass).
 * "On its way" is said only while HQ's record has it queued or deploying, and only for a window
 * after that record last changed: a first deploy that never comes reads "Nothing deployed yet"
 * again, never on its way for ever.
 *
 * Pure: no network, no clock of its own, no platform globals (rule R1).
 *
 * @module stopComing
 */
import type { HqDeploy } from "./hq/environments.ts";

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
  | "address";

/** An environment coming up, or one that did not come up. */
export type StopComing =
  | { readonly kind: "coming"; readonly step: ComingStep }
  | { readonly kind: "failed"; readonly reason: string };

/** Where a stage's first deploy stands while it runs nothing. */
export type FirstDeploy =
  /** HQ has none queued or under way: nothing to promise. */
  | { readonly kind: "awaited" }
  /** HQ has it queued or deploying, its record changed within the window. */
  | { readonly kind: "on-its-way" }
  /**
   * A build of it was seen to end with nothing running (`Deployment.afterBuild`), or HQ says its
   * build failed.
   */
  | { readonly kind: "failed" };

/**
 * How long after its project was made an environment may still be coming up. The owner's stage
 * took 131 s (project 32 s, database 50 s, build 63–130 s, address 131 s); a first build can take
 * several minutes more. Past this, what it lacks is the pill's to say — not deployed yet, down —
 * not a step of its coming up.
 */
export const COMING_UP_WINDOW_MS = 15 * 60_000;

const failing = (status: string) => /FAIL/u.test(status);

/**
 * Where a stage's first deploy stands by HQ's records of it: failed where HQ says a build of it
 * failed, which is final; on its way while HQ has it queued or deploying, for
 * {@link COMING_UP_WINDOW_MS} after the record last changed.
 */
export function firstDeploy(input: {
  /** HQ's newest deploy of each of the stage's services (`EnvironmentRow.deploys`). */
  readonly deploys: ReadonlyArray<HqDeploy>;
  readonly nowMs: number;
}): FirstDeploy {
  if (input.deploys.some(({ failure }) => failure === "job")) return { kind: "failed" };
  const asked = input.deploys.some(
    ({ state, at }) =>
      (state === "pending" || state === "deploying") &&
      input.nowMs - Date.parse(at) < COMING_UP_WINDOW_MS,
  );
  return asked ? { kind: "on-its-way" } : { kind: "awaited" };
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
  /** It has run a deploy (`stopDeployed`); `undefined` while that is not known. */
  readonly deployed: boolean | undefined;
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
  // The import's own deploy carries no code: the app being added, never a build.
  if (runtimes.some(({ status }) => MAKING.has(status))) return coming("app");
  if (deployed !== true) {
    if (input.tier === "production") return undefined;
    // What runs there not known yet: the neutral wait, never a claim about its deploy.
    const first = deployed === false ? (input.firstDeploy ?? { kind: "awaited" }) : AWAITED;
    switch (first.kind) {
      case "awaited":
        return coming("awaiting-deploy");
      case "on-its-way":
        return coming("deploy-on-its-way");
      case "failed":
        return { kind: "failed", reason: "its first deploy failed" };
    }
  }
  if (runtimes.some(({ status }) => !running(status))) return coming("build");
  if (input.routes === 0) return coming("address");
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

/**
 * The line an environment coming up says, about `subject` ("Stage", a stage's own name,
 * "Production"): "Stage coming up · building the app". Each fits the menu’s narrowest line, 241 px
 * of words.
 */
export function comingLine(
  subject: string,
  coming: Extract<StopComing, { readonly kind: "coming" }>,
): { readonly fact: string; readonly rest: string } {
  return { fact: `${subject} coming up`, rest: STEP_WORDS[coming.step] };
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
    case "failed":
      return FIRST_DEPLOY_FAILED;
    default:
      return undefined;
  }
}
