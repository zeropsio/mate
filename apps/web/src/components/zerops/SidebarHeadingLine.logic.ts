/**
 * A project heading's second line (D′): under the name and above the Mates, one line that says
 * what the project's release and its environments are doing — never a row after the Mates, which
 * reads as the last Mate's, the way a pull request under a Mate is that Mate's.
 *
 * The pills say only whether each place serves. The release is its own thing, with the Review
 * door a merge has, and the line follows it: "3 changes not released · all on stage",
 * "Releasing v2.4.0…", "v2.4.0 is live" for 4 s in the tab that watched it go out, or
 * "v2.4.0 didn’t go out" in amber. While a stage or a production comes up the same line names
 * each step: "Stage coming up · building the app", then "Stage is up", or "Stage didn’t come up"
 * in amber with Details.
 *
 * One line at a time: trouble, then an environment coming up, then a release — nothing can
 * release to a place that does not serve yet, and the wait is two minutes. Down and stopped are
 * the pills' alone.
 *
 * Pure: no clock of its own, no platform globals.
 */
import { changesCountWords } from "@t3tools/client-runtime/zerops";

import type { ChipState, ProductionChip, ReleaseFailure } from "./SidebarProductionChip.logic";

/** Where an environment coming up has got. */
export type ComingStep = "project" | "database" | "build" | "address";

/** An environment coming up, or one that did not come up. */
export type StopComing =
  | { readonly kind: "coming"; readonly step: ComingStep }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * How long after its project was made an environment may still be coming up. The owner's stage
 * took 131 s (project 32 s, database 50 s, build 63–130 s, address 131 s); a first build can take
 * several minutes more. Past this, what it lacks is the pill's to say — not deployed yet, down —
 * not a step of its coming up.
 */
export const COMING_UP_WINDOW_MS = 15 * 60_000;

/** How long "is live" and "is up" stand on the line before it folds. */
export const LANDING_MS = 4_000;

const STEP_WORDS: Record<ComingStep, string> = {
  project: "making the project",
  database: "adding the database",
  build: "building the app",
  address: "turning its address on",
};

const failing = (status: string) => /FAIL/u.test(status);

/**
 * Whether a stage or a production is coming up, and at which step, from what the platform says
 * of it: accepted and not listed yet, or its project still being made; then its services — a
 * database not running yet, a build running or its runtime not running yet, then no public
 * address. A runtime whose first build failed did not come up.
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
}): StopComing | undefined {
  if (input.pending) return { kind: "coming", step: "project" };
  if (input.projectStatus === "STOPPED") return undefined;
  if (input.projectStatus !== undefined && input.projectStatus !== "ACTIVE") {
    return { kind: "coming", step: "project" };
  }
  const made = input.createdAt === undefined ? Number.NaN : Date.parse(input.createdAt);
  if (Number.isNaN(made) || input.nowMs - made >= COMING_UP_WINDOW_MS) return undefined;
  if (input.services === undefined) return { kind: "coming", step: "project" };
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
    return { kind: "coming", step: "database" };
  }
  const broken = runtimes.find(({ status }) => failing(status));
  if (broken !== undefined) {
    return input.deployed
      ? undefined
      : { kind: "failed", reason: `the ${broken.hostname}’s build failed` };
  }
  if (input.building) return { kind: "coming", step: "build" };
  if (runtimes.some(({ status }) => !running(status))) {
    return input.tier === "production" && !input.deployed
      ? undefined
      : { kind: "coming", step: "build" };
  }
  if (input.routes === 0) return { kind: "coming", step: "address" };
  return undefined;
}

/** What the line is made of, besides what only this tab saw land (`HeadingLanding`). */
export interface HeadingLineInput {
  /** `undefined` where the project has no production, nor one on its way. */
  readonly production:
    | {
        readonly projectId: string | undefined;
        /** Its pill, as the heading draws it; `undefined` while unread. */
        readonly chip: ProductionChip | undefined;
        readonly coming: StopComing | undefined;
        /** The newest release that did not go out (`releaseFailureOf`). */
        readonly failure: ReleaseFailure | undefined;
      }
    | undefined;
  readonly stages: ReadonlyArray<{
    readonly projectId: string;
    readonly name: string;
    readonly coming: StopComing | undefined;
  }>;
  /** Changes merged and not live (`GroupFlowMain.notLive`). */
  readonly waiting: number;
  /** Whether that is only how many at least (`GroupFlowMain.notLiveAtLeast`). */
  readonly waitingAtLeast: boolean;
  /** A stage runs `main`'s head: every change waiting is on it. */
  readonly allOnStage: boolean;
}

/** What this tab watched land, standing on the line for {@link LANDING_MS}. */
export type HeadingLanding =
  | { readonly kind: "live"; readonly version: string }
  | { readonly kind: "up"; readonly name: string };

export type HeadingLineVerb =
  | { readonly kind: "review" }
  | { readonly kind: "details"; readonly projectId: string | undefined };

export interface HeadingLine {
  /** The fact, in the line's tone; the rest follows it muted, after a middle dot. */
  readonly fact: string;
  readonly rest: string | undefined;
  readonly tone: "ink" | "ok" | "amber";
  /** A release on its way: the stepped spinner before the fact. */
  readonly spinner: boolean;
  /**
   * The line is the release's — waiting, on its way, live, or not gone out: it leads with the
   * tag its folded heading's mark wears (`headingMark`), so the eye ties the two.
   */
  readonly release: boolean;
  /** The door at the line's end, in the column of the Review below it. */
  readonly verb: HeadingLineVerb | undefined;
}

/** "Stage", or the stage's own name where the project has several. */
function stageWord(
  stages: HeadingLineInput["stages"],
  stage: HeadingLineInput["stages"][number],
): string {
  return stages.length > 1 ? stage.name : "Stage";
}

function failureReason(failure: ReleaseFailure | undefined): string {
  if (failure?.kind === "refused") return "HQ refused it";
  return failure?.service === undefined
    ? "its deploy failed"
    : `${failure.service}’s deploy failed`;
}

/** Production's pill states that serve something a release was cut from. */
const RELEASED: ReadonlySet<ChipState> = new Set(["ok", "waiting"]);

/**
 * The heading's second line, or none: trouble first — a release that did not go out, an
 * environment that did not come up — then an environment coming up, then what this tab watched
 * land, then the release on its way, then the changes waiting for one.
 */
export function headingLine(
  input: HeadingLineInput,
  landing: HeadingLanding | undefined,
): HeadingLine | undefined {
  const { production, stages } = input;
  const chip = production?.chip;
  if (chip?.state === "failed") {
    return {
      fact: `${production?.failure?.tag ?? "The release"} didn’t go out`,
      rest: failureReason(production?.failure),
      tone: "amber",
      spinner: false,
      release: true,
      verb: { kind: "review" },
    };
  }
  if (production?.coming?.kind === "failed") {
    return {
      fact: "Production didn’t come up",
      rest: production.coming.reason,
      tone: "amber",
      spinner: false,
      release: false,
      verb: { kind: "details", projectId: production.projectId },
    };
  }
  for (const stage of stages) {
    if (stage.coming?.kind !== "failed") continue;
    return {
      fact: `${stageWord(stages, stage)} didn’t come up`,
      rest: stage.coming.reason,
      tone: "amber",
      spinner: false,
      release: false,
      verb: { kind: "details", projectId: stage.projectId },
    };
  }
  if (production?.coming?.kind === "coming") {
    return {
      fact: "Production coming up",
      rest: STEP_WORDS[production.coming.step],
      tone: "ink",
      spinner: false,
      release: false,
      verb: undefined,
    };
  }
  for (const stage of stages) {
    if (stage.coming?.kind !== "coming") continue;
    return {
      fact: `${stageWord(stages, stage)} coming up`,
      rest: STEP_WORDS[stage.coming.step],
      tone: "ink",
      spinner: false,
      release: false,
      verb: undefined,
    };
  }
  if (landing !== undefined) {
    return {
      fact: landing.kind === "live" ? `${landing.version} is live` : `${landing.name} is up`,
      rest: "just now",
      tone: "ok",
      spinner: false,
      release: landing.kind === "live",
      verb: undefined,
    };
  }
  if (chip?.state === "releasing") {
    return {
      fact: chip.next === undefined ? "Production is deploying…" : `Releasing ${chip.next}…`,
      rest: undefined,
      tone: "ink",
      spinner: true,
      release: true,
      verb: chip.next === undefined ? undefined : { kind: "review" },
    };
  }
  if (chip === undefined || chip.state === "creating" || input.waiting <= 0) return undefined;
  const served = RELEASED.has(chip.state) ? chip.version : undefined;
  return {
    fact: `${changesCountWords(input.waiting, input.waitingAtLeast)} not released`,
    rest:
      chip.state === "empty"
        ? "nothing is live yet"
        : input.allOnStage
          ? "all on stage"
          : served === undefined
            ? undefined
            : `since ${served}`,
    tone: "ink",
    spinner: false,
    release: true,
    verb: { kind: "review" },
  };
}

/**
 * What landed between two readings, as this tab watched it: a release on its way now served
 * ("v2.4.0 is live"), production's first build serving ("v0.1.0 is live"), a stage that was
 * coming up now up ("Stage is up"). Nothing where this tab did not see it on its way.
 */
export function headingLanding(
  before: HeadingLineInput | undefined,
  after: HeadingLineInput,
): HeadingLanding | undefined {
  if (before === undefined) return undefined;
  const was = before.production;
  const now = after.production?.chip;
  if (now !== undefined && RELEASED.has(now.state) && now.version !== undefined) {
    if (was?.chip?.state === "releasing" || was?.coming?.kind === "coming") {
      return { kind: "live", version: now.version };
    }
  }
  for (const stage of after.stages) {
    if (stage.coming !== undefined) continue;
    const earlier = before.stages.find((entry) => entry.projectId === stage.projectId);
    if (earlier?.coming?.kind === "coming") {
      return { kind: "up", name: stageWord(after.stages, stage) };
    }
  }
  return undefined;
}

/** A folded heading's release mark, after its faces (D): the release, and nothing else. */
export type HeadingMark =
  /** How many changes wait, and whether that is only how many at least. */
  | { readonly kind: "waiting"; readonly count: number; readonly atLeast: boolean }
  | { readonly kind: "releasing"; readonly version: string | undefined }
  | { readonly kind: "live" }
  | { readonly kind: "failed" };

/**
 * What a folded heading's tag mark says: a release that did not go out (amber), one this tab
 * watched land (ok), one on its way (the spinner and its version), or how many changes wait for
 * one. An environment coming up is its pill's spinner, folded or open.
 */
export function headingMark(
  input: HeadingLineInput,
  landing: HeadingLanding | undefined,
): HeadingMark | undefined {
  const chip = input.production?.chip;
  if (chip === undefined) return undefined;
  if (chip.state === "failed") return { kind: "failed" };
  if (landing?.kind === "live") return { kind: "live" };
  if (chip.state === "releasing") return { kind: "releasing", version: chip.next };
  if (chip.state === "creating" || input.waiting <= 0) return undefined;
  return { kind: "waiting", count: input.waiting, atLeast: input.waitingAtLeast };
}
