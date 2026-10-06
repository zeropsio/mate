/**
 * A project's production and its stages as two chips on its heading — one
 * for production, one for the stage or stages — and each chip's menu.
 *
 * What a person needs of them, by moment: always, at a glance, that there is
 * one; when one is in trouble, at once and loudest, even with the project
 * folded; when they act, what it runs, its links, what waits, what failed and
 * where to look. So a chip is its word alone, and the whole of it turns when
 * something is wrong — amber while the last release or deploy did not go
 * through and the old one still serves, red while it is down (S3), hollow
 * while it is stopped on purpose (the owner, 2026-09-29: "the whole tag
 * should get like reddish when something is wrong.. so you'd have two badges
 * one for prod, one for stage(s)"). Its menu holds the rest: the state in
 * words and the version, the note that says what went wrong, the fix to ask a
 * Mate for (S6), the links, what waits for a release, and the way to Zerops —
 * for each stage, on the stages' chip.
 *
 * Every fact comes from what the menu already reads — `groupFlow`'s stops, the
 * platform's services, HQ's releases — and a chip is drawn only once what
 * decides it is read: until then it is unknown, and the menu draws — where only
 * HQ's releases answer is missing — what the platform alone says; else nothing.
 *
 * Pure: no React, no clock, no store.
 */
import {
  cannotTellWhatRuns,
  changesCountWords,
  sameCommit,
  type FlowReleaseRow,
  type GroupEnvironmentRowInput,
  type GroupFlowProduction,
  type GroupFlowStop,
  type ZeropsPublicRoute,
  firstDeployLine,
} from "@t3tools/client-runtime/zerops";

import { deployBuilding, type Deployment } from "@t3tools/client-runtime/zerops/flow";
import { type HqJob, jobFailed } from "@t3tools/client-runtime/zerops/hq";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

import type { FixProblem } from "~/zerops/fixRequest";

/** How a stop stands on the platform, by what serves it. */
export type StopServing =
  /** Nothing on the platform says it does not serve. */
  | { readonly kind: "serving" }
  /** Somebody stopped it: the project, or every service that serves it. */
  | { readonly kind: "stopped" }
  /** The platform marks these serving services failed: nothing is served through them. */
  | { readonly kind: "down"; readonly services: ReadonlyArray<string> }
  /** Not read, or in a state that says neither. */
  | { readonly kind: "unknown" };

const SERVICE_STATUS_PREFIX = "SERVICE_";

const statusWord = (status: string) =>
  status.startsWith(SERVICE_STATUS_PREFIX) ? status.slice(SERVICE_STATUS_PREFIX.length) : status;

/**
 * How a stop stands, read off what serves it: the runtimes behind its public
 * routes, or every runtime where no route is public. A database whose upgrade
 * failed, or a worker no route reaches, takes no page down; a serving runtime
 * with FAIL in its status does, whatever the platform calls it next (as
 * `serviceStatusTone` reads it). Stopped is the project stopped, or every
 * serving runtime stopped — one stopped beside another that serves still
 * serves.
 */
export function stopServing(input: {
  readonly projectStatus: string | undefined;
  /** Its services as the platform lists them (`summarizeEnvironmentServices`). */
  readonly services:
    | ReadonlyArray<{
        readonly hostname: string;
        readonly status: string;
        readonly runtime: boolean;
      }>
    | undefined;
  /** Its public routes, each by the service it reaches. */
  readonly routes: ReadonlyArray<{ readonly service: string }>;
}): StopServing {
  if (input.projectStatus === "STOPPED") return { kind: "stopped" };
  if (input.projectStatus !== undefined && input.projectStatus !== "ACTIVE") {
    return { kind: "unknown" };
  }
  if (input.services === undefined) return { kind: "unknown" };
  const runtimes = input.services.filter((service) => service.runtime);
  const routed = new Set(input.routes.map((route) => route.service));
  const behindRoutes = runtimes.filter((service) => routed.has(service.hostname));
  const serving = behindRoutes.length > 0 ? behindRoutes : runtimes;
  if (serving.length === 0) return { kind: "serving" };
  const failed = serving
    .filter((service) => /FAIL/u.test(service.status))
    .map((service) => service.hostname);
  if (failed.length > 0) return { kind: "down", services: failed };
  return serving.every((service) => statusWord(service.status) === "STOPPED")
    ? { kind: "stopped" }
    : { kind: "serving" };
}

/** A release that did not go through, newer than what production serves. */
export interface ReleaseFailure {
  readonly tag: string;
  /**
   * Its production deploy failed, or it is a release the old broker refused after its tag — a
   * record kept from before HQ, which refuses a release before any tag or record.
   */
  readonly kind: "deploy-failed" | "refused";
  /** When: the failed deploy's, as HQ records it, or the refused tag's; `undefined` where unread. */
  readonly at: string | undefined;
  /** The words for it: the failed deploy's message, as HQ records it, or the broker's recorded refusal reason. */
  readonly error: string | undefined;
  /** The service whose deploy failed. */
  readonly service: string | undefined;
}

/**
 * The newest release that failed or was refused, among the ones newer than
 * the release production runs (`stopFailedDeploy`'s rule): an older failure
 * is history. HQ's record of the failed deploy carries its words and its time.
 */
export function releaseFailureOf(input: {
  /** Newest first. */
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  readonly environmentInputs: ReadonlyArray<GroupEnvironmentRowInput>;
}): ReleaseFailure | undefined {
  const live = input.releases.findIndex((release) => release.standing === "live");
  const newer = live === -1 ? input.releases : input.releases.slice(0, live);
  const release = newer.find(
    (entry) => entry.standing === "deploy-failed" || entry.verdict === "refused",
  );
  if (release === undefined) return undefined;
  if (release.verdict === "refused") {
    return {
      tag: release.tag,
      kind: "refused",
      at: release.taggedAt,
      error: wordsOf(release.detail),
      service: undefined,
    };
  }
  const entry = release.failedEntry;
  const failed = entry === undefined ? undefined : failedDeploy(input.environmentInputs, entry);
  return {
    tag: release.tag,
    kind: "deploy-failed",
    at: failed === undefined ? undefined : (failed.endedAt ?? failed.at),
    error: wordsOf(failed?.reason ?? undefined),
    service: entry?.service,
  };
}

const wordsOf = (text: string | undefined): string | undefined => {
  const trimmed = text?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

/**
 * HQ's job of one service's production deploy of one commit that ended deploying nothing — the
 * build's own failure, or HQ's refusal — while it is the newest.
 */
function failedDeploy(
  environments: ReadonlyArray<GroupEnvironmentRowInput>,
  entry: { readonly service: string; readonly commit: string },
): HqJob | undefined {
  const production = environments.find((environment) => environment.tier === "production");
  const latest = production?.services.find((service) => service.hostname === entry.service)?.deploy
    ?.latest;
  return latest !== undefined &&
    latest.sha !== null &&
    jobFailed(latest) &&
    sameCommit(entry.commit, latest.sha)
    ? latest
    : undefined;
}

export type ChipLabel = "prod" | "stage";

export type ChipState =
  | "ok"
  | "waiting"
  | "releasing"
  | "failed"
  | "down"
  | "stopped"
  | "creating"
  | "empty"
  | "unverified";

/** What a chip says: its stops, their state and the facts that state names. */
export interface ProductionChip {
  readonly label: ChipLabel;
  readonly state: ChipState;
  readonly readLine?: string;
  /** What serves now: a release's tag, a hand-made name, a stage's branch. */
  readonly version?: string;
  /** What is on its way, while releasing — and while down or stopped, where one is. */
  readonly next?: string;
  /** Changes merged and not live, while they wait — and while down or stopped. */
  readonly waiting?: number;
  /** Whether `waiting` is only how many at least: HQ stopped counting. */
  readonly waitingAtLeast?: true;
  /**
   * Production's services whose commit cannot be told, while it serves: the chip says so where it
   * would say healthy.
   */
  readonly untold?: ReadonlyArray<string>;
  /** The stage chip over several stages: each by its name, in the state it is in. */
  readonly stages?: ReadonlyArray<{ readonly name: string; readonly state: ChipState }>;
}

export type ChipView =
  | { readonly kind: "none" }
  /**
   * Not all of it read. `partial` is what the platform alone says while HQ has not answered the
   * releases.
   */
  | { readonly kind: "unknown"; readonly partial?: ProductionChip }
  | { readonly kind: "chip"; readonly chip: ProductionChip };

/**
 * What HQ said of the application's releases: answered (with the failed release it read), or not
 * yet — its flow not read, or not answered.
 */
export type ReleasesAnswer =
  | { readonly kind: "answered"; readonly failure: ReleaseFailure | undefined }
  | { readonly kind: "waiting" };

const NONE: ChipView = { kind: "none" };
const UNKNOWN: ChipView = { kind: "unknown" };

/**
 * The chip the platform's facts alone make, as HQ's releases answer stands: itself once answered;
 * while HQ has not answered, only partial — drawn where nothing is remembered, never remembered.
 */
function asReleasesStand(alone: ChipView, releases: ReleasesAnswer): ChipView {
  if (releases.kind === "answered") return alone;
  return alone.kind === "chip" ? { kind: "unknown", partial: alone.chip } : UNKNOWN;
}

const chipView = (chip: ProductionChip): ChipView => ({ kind: "chip", chip });

/** Only the facts a state names, so two draws of one state are one chip. */
function chipOf(
  label: ChipLabel,
  state: ChipState,
  facts: {
    readonly readLine?: string;
    readonly version?: string | undefined;
    readonly next?: string | undefined;
    readonly waiting?: number | undefined;
    readonly waitingAtLeast?: boolean;
    readonly untold?: ReadonlyArray<string>;
  } = {},
): ChipView {
  return chipView({
    label,
    state,
    ...(facts.readLine === undefined ? {} : { readLine: facts.readLine }),
    ...(facts.version === undefined ? {} : { version: facts.version }),
    ...(facts.next === undefined ? {} : { next: facts.next }),
    ...(facts.waiting === undefined ? {} : { waiting: facts.waiting }),
    ...(facts.waiting !== undefined && facts.waitingAtLeast === true
      ? { waitingAtLeast: true as const }
      : {}),
    ...(facts.untold === undefined || facts.untold.length === 0 ? {} : { untold: facts.untold }),
  });
}

/**
 * Production's chip, worst first: being set up; down or stopped, from the
 * platform alone and at once — with a release on its way, or changes
 * waiting, beside it, since those are true as well; unknown while what runs
 * or how its services stand is unread, and while HQ's releases answer is, where it
 * is coming — with what the platform alone says as its `partial`; a release
 * on its way; a release that failed (amber: the old one still serves);
 * nothing released yet; changes waiting (nothing is wrong); healthy. No chip
 * where the project has no production.
 */
export function productionChip(input: {
  readonly production: GroupFlowProduction;
  /** A deploy running on production: what served before it, and what it builds. */
  readonly building:
    | { readonly from: string | undefined; readonly to: string | undefined }
    | undefined;
  /** Changes merged and not live (`GroupFlowMain.notLive`). */
  readonly waiting: number;
  /** Whether that is only how many at least (`GroupFlowMain.notLiveAtLeast`). */
  readonly waitingAtLeast: boolean;
  /** Production's services whose commit cannot be told (`ZeropsReleaseOffer.untold`). */
  readonly untold: ReadonlyArray<string>;
  readonly serving: StopServing;
  readonly releases: ReleasesAnswer;
}): ChipView {
  const { production } = input;
  if (production.kind === "creating") return chipOf("prod", "creating");
  if (production.kind === "absent") return NONE;
  const served =
    input.building === undefined ? production.stop.version?.label : input.building.from;
  const waiting = input.waiting > 0 ? input.waiting : undefined;
  const { serving, waitingAtLeast, untold } = input;
  if (serving.kind === "down" || serving.kind === "stopped") {
    // A release tagged for production, or a deploy the platform runs on it.
    const next = production.kind === "releasing" ? production.tag : input.building?.to;
    return chipOf("prod", serving.kind, {
      version: served,
      next: next === served ? undefined : next,
      waiting,
      waitingAtLeast,
    });
  }
  if (
    serving.kind === "unknown" &&
    !(production.kind === "checking" && production.stop.readFailed === true)
  )
    return UNKNOWN;
  if (production.kind === "checking")
    return chipOf("prod", "unverified", { readLine: production.line });
  const failed =
    (input.releases.kind === "answered" && input.releases.failure !== undefined) ||
    production.kind === "deploy-failed";
  const chip = (): ChipView => {
    if (production.kind === "releasing") {
      return chipOf("prod", "releasing", { version: served, next: production.tag });
    }
    if (input.building !== undefined || production.kind === "deploying") {
      const next = input.building?.to;
      return chipOf("prod", "releasing", {
        version: served,
        next: next === served ? undefined : next,
      });
    }
    if (failed) return chipOf("prod", "failed", { version: served, untold });
    if (served === undefined) return chipOf("prod", "empty", { waiting, waitingAtLeast });
    if (waiting !== undefined)
      return chipOf("prod", "waiting", { version: served, waiting, waitingAtLeast, untold });
    return chipOf("prod", "ok", { version: served, untold });
  };
  return asReleasesStand(chip(), input.releases);
}

/**
 * A deploy running on a stop, as the platform pushed it: what served before it
 * (`undefined` where nothing did, or nothing says) and what it builds.
 */
export function buildingOf(
  deployment: Shown<Deployment> | undefined,
): { readonly from: string | undefined; readonly to: string | undefined } | undefined {
  const building = deployBuilding(deployment);
  if (building === undefined) return undefined;
  const { previous, version } = building;
  return {
    from: previous?.kind === "running" ? previous.version.label : undefined,
    to: version.label,
  };
}

/** A stage's slot on the chip: a deploy's own name, else the branch it follows, else its commit. */
function stageVersion(stop: GroupFlowStop): string | undefined {
  const source = stop.source === "—" ? undefined : stop.source;
  return stop.version?.name ?? source ?? stop.version?.label;
}

/** One stage as the stage chip reads it: its name under the heading, its stop, how it serves. */
export interface StageInput {
  readonly name: string;
  readonly stop: GroupFlowStop;
  readonly serving: StopServing;
}

/**
 * One stage, as a chip of its own would say it — what the stages' chip is
 * made of, and what its menu says of each: down or stopped at once, from the
 * platform; unknown while its last deploy or how it serves is unread; then
 * where its last deploy stands.
 */
export function stageStopChip(input: {
  readonly stop: GroupFlowStop;
  readonly serving: StopServing;
  readonly releases: ReleasesAnswer;
}): ChipView {
  const { stop, serving } = input;
  const version = stageVersion(stop);
  if (serving.kind === "down") return chipOf("stage", "down", { version });
  if (serving.kind === "stopped") return chipOf("stage", "stopped", { version });
  if (serving.kind === "unknown" && stop.readFailed !== true) return UNKNOWN;
  if (stop.state === "checking")
    return chipOf("stage", "unverified", { readLine: stop.readLine ?? "Checking what runs here…" });
  const state = stop.state;
  const chip = (): ChipView => {
    switch (state) {
      case "deploying":
        return chipOf("stage", "releasing", { version });
      case "failed":
        return chipOf("stage", "failed", { version });
      case "empty":
        return chipOf("stage", "empty");
      case "deployed":
        return chipOf("stage", "ok", { version });
    }
  };
  return asReleasesStand(chip(), input.releases);
}

/**
 * Several stages as one chip, in the worst state any of them is in: down,
 * then a failed deploy, then one deploying. Stopped or empty only where every
 * one is; one stopped beside another that serves is nothing wrong.
 */
function severalStages(
  stages: ReadonlyArray<{ readonly name: string; readonly chip: ProductionChip }>,
): ProductionChip {
  const states = stages.map(({ chip }) => chip.state);
  const state: ChipState = states.includes("down")
    ? "down"
    : states.includes("unverified")
      ? "unverified"
      : states.includes("failed")
        ? "failed"
        : states.includes("releasing")
          ? "releasing"
          : states.every((each) => each === "stopped")
            ? "stopped"
            : states.every((each) => each === "empty")
              ? "empty"
              : "ok";
  return {
    label: "stage",
    state,
    stages: stages.map(({ name, chip }) => ({ name, state: chip.state })),
  };
}

/**
 * The stages' one chip: a stage as it stands (`stageStopChip`); several in
 * the worst state of any of them, each named (`severalStages`) — red at once
 * where one is down, whatever of the others is still unread; being set up
 * where the first is on its way; no chip where the project has none.
 */
export function stageChip(input: {
  readonly stages: ReadonlyArray<StageInput>;
  /** A stage is being created that the listing does not hold yet. */
  readonly beingCreated: boolean;
  readonly releases: ReleasesAnswer;
}): ChipView {
  const views = input.stages.map((stage) => ({
    name: stage.name,
    view: stageStopChip({ stop: stage.stop, serving: stage.serving, releases: input.releases }),
  }));
  const [first] = views;
  if (first === undefined) return input.beingCreated ? chipOf("stage", "creating") : NONE;
  if (views.length === 1) return first.view;
  const read = views.flatMap(({ name, view }) =>
    view.kind === "chip" ? [{ name, chip: view.chip }] : [],
  );
  if (read.length === views.length) return chipView(severalStages(read));
  if (read.some(({ chip }) => chip.state === "down")) return chipView(severalStages(read));
  const drawn = views.flatMap(({ name, view }) =>
    view.kind === "chip"
      ? [{ name, chip: view.chip }]
      : view.kind === "unknown" && view.partial !== undefined
        ? [{ name, chip: view.partial }]
        : [],
  );
  return drawn.length === views.length
    ? { kind: "unknown", partial: severalStages(drawn) }
    : UNKNOWN;
}

/** Both chips a project's heading wears, each only where the project has it. */
export function projectChips(input: {
  readonly production: GroupFlowProduction;
  readonly building:
    | { readonly from: string | undefined; readonly to: string | undefined }
    | undefined;
  /** Changes merged and not live (`GroupFlowMain.notLive`). */
  readonly waiting: number;
  /** Whether that is only how many at least (`GroupFlowMain.notLiveAtLeast`). */
  readonly waitingAtLeast: boolean;
  /** Production's services whose commit cannot be told (`ZeropsReleaseOffer.untold`). */
  readonly untold: ReadonlyArray<string>;
  /** How production serves. */
  readonly serving: StopServing;
  readonly stages: ReadonlyArray<StageInput>;
  readonly stagesBeingCreated: boolean;
  readonly releases: ReleasesAnswer;
}): { readonly prod: ChipView; readonly stage: ChipView } {
  return {
    prod: productionChip(input),
    stage: stageChip({
      stages: input.stages,
      beingCreated: input.stagesBeingCreated,
      releases: input.releases,
    }),
  };
}

/** The chip a menu draws: the one read, or — while unknown — what the platform alone says. */
export function drawnChip(view: ChipView): ProductionChip | undefined {
  if (view.kind === "chip") return view.chip;
  return view.kind === "unknown" ? view.partial : undefined;
}

/** A stop's dot in the chip's menu and the jump box: a colour for a state, hollow for a stop on purpose, a spinner while moving. */
export type ChipDot = "ok" | "attention" | "failed" | "off" | "hollow" | "spinner";

/**
 * The chip's whole ground and ink: neutral while nothing is wrong or nothing
 * is known, amber while the last release or deploy did not go through and
 * the old one still serves, red while it is down (S3) — and hollow while it
 * is stopped on purpose, which is off rather than wrong.
 */
export type ChipTone = "neutral" | "off" | "dash" | "amber" | "red";

/** The chip as it is drawn: its word, and its tone — its menu says the rest. */
export interface ChipFace {
  readonly tone: ChipTone;
  /** The one word on it. */
  readonly label: ChipLabel;
  /** The whole state in a sentence: its accessible name. */
  readonly words: string;
}

const TONE: Record<ChipState, ChipTone> = {
  unverified: "neutral",
  ok: "neutral",
  waiting: "neutral",
  releasing: "neutral",
  creating: "neutral",
  empty: "dash",
  failed: "amber",
  down: "red",
  stopped: "off",
};

const TIER_WORD: Record<ChipLabel, string> = { prod: "Production", stage: "Stage" };

/** What else is true of a stop down or stopped: a release on its way, else changes waiting. */
function alongside(chip: ProductionChip): string | undefined {
  if (chip.next !== undefined) return `releasing ${chip.next}`;
  if (chip.waiting !== undefined) {
    return `${changesCountWords(chip.waiting, chip.waitingAtLeast === true)} waiting`;
  }
  return undefined;
}

/** One of several stages, in words: "qa is down", "qa's last deploy failed". */
function stagePhrase({ name, state }: { readonly name: string; readonly state: ChipState }) {
  switch (state) {
    case "unverified":
      return `${name}: runtime not verified`;
    case "ok":
    case "waiting":
      return `${name} is healthy`;
    case "releasing":
      return `${name} is deploying`;
    case "failed":
      return `${name}'s last deploy failed`;
    case "down":
      return `${name} is down`;
    case "stopped":
      return `${name} is stopped`;
    case "creating":
      return `${name} is being set up`;
    case "empty":
      return `nothing is deployed to ${name} yet`;
  }
}

/** Healthy, unless what a service runs cannot be told: then that, never healthy. */
function healthyWord(chip: ProductionChip): string {
  if (chip.untold === undefined) return "healthy";
  const words = cannotTellWhatRuns(chip.untold);
  return `${words.charAt(0).toLowerCase()}${words.slice(1)}`;
}

/** The whole state in a sentence, what the chip no longer draws included. */
function chipWords(chip: ProductionChip): string {
  if (chip.stages !== undefined && chip.stages.length > 1) {
    return `Stages: ${chip.stages.map(stagePhrase).join(", ")}`;
  }
  const tier = TIER_WORD[chip.label];
  const named = (rest: string) =>
    chip.version === undefined ? `${tier}, ${rest}` : `${tier} ${chip.version}, ${rest}`;
  switch (chip.state) {
    case "unverified":
      return named(chip.readLine ?? "runtime not verified");
    case "ok":
      return named(healthyWord(chip));
    // What waits is the release's, said once on the heading's line: the place is healthy.
    case "waiting":
      return named(healthyWord(chip));
    case "releasing":
      return named(chip.next === undefined ? "deploying" : `releasing ${chip.next}`);
    // The release that did not go out is the line's; production still serves the one before.
    case "failed":
      return named(chip.label === "prod" ? healthyWord(chip) : "the last deploy failed");
    case "down":
    case "stopped": {
      const also = alongside(chip);
      return also === undefined ? `${tier} is ${chip.state}` : `${tier} is ${chip.state}, ${also}`;
    }
    case "creating":
      return `${tier} is being set up`;
    case "empty": {
      return `${tier}, nothing ${chip.label === "prod" ? "released" : "deployed"} yet`;
    }
  }
}

/**
 * The pill as D draws it: whether the place serves. A release that did not go out leaves
 * production serving the one before it, so production's pill stays neutral and the amber is the
 * release's own, on the heading's line (`headingLine`); a stage's failed deploy has no line and
 * keeps its amber.
 */
export function chipFace(chip: ProductionChip): ChipFace {
  const tone = chip.label === "prod" && chip.state === "failed" ? "neutral" : TONE[chip.state];
  return { tone, label: chip.label, words: chipWords(chip) };
}

/** "40 min ago", "3 h ago": how long ago, as the chip's menu says a deploy's age. */
export function deployedAgo(at: string, nowMs: number): string | undefined {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return undefined;
  const minutes = Math.floor((nowMs - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)} h ago`;
  return `${String(Math.floor(hours / 24))} days ago`;
}

/** The words that join names: "app", "app and api", "app, api and web". */
function joined(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * One stop in a chip's menu, a group of its own: its row — its name, what it
 * runs and where it stands in words — then what went wrong, the fix while it
 * is broken (S6), and its public links, each led by its service.
 */
export interface ChipMenuStop {
  /** Its Zerops project, for its page and *Open in Zerops*; none while it is being set up. */
  readonly projectId: string | undefined;
  readonly name: string;
  readonly version: string | undefined;
  readonly dot: ChipDot;
  readonly word: string;
  readonly tone: "muted" | "amber" | "red";
  /** What went wrong, when something did. */
  readonly note: string | undefined;
  /** What "Ask <your Mate> to fix it" writes, while it is broken. */
  readonly fix: FixProblem | undefined;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
}

export interface ChipMenuModel {
  /** Production alone on production's menu; each stage on the stages'. */
  readonly stops: ReadonlyArray<ChipMenuStop>;
}

const MAIN_DOT: Record<ChipState, ChipDot> = {
  unverified: "off",
  ok: "ok",
  waiting: "ok",
  releasing: "spinner",
  failed: "attention",
  down: "failed",
  stopped: "hollow",
  creating: "spinner",
  empty: "off",
};

/** A stop's dot, by the state its chip says: in its menu's row and in the jump box. */
export function chipDot(chip: ProductionChip): ChipDot {
  // Serving what cannot be told is not known to be healthy.
  if (chip.untold !== undefined && (chip.state === "ok" || chip.state === "waiting")) return "off";
  return MAIN_DOT[chip.state];
}

const MENU_TONE: Record<ChipState, ChipMenuStop["tone"]> = {
  unverified: "muted",
  ok: "muted",
  waiting: "muted",
  releasing: "muted",
  creating: "muted",
  empty: "muted",
  stopped: "muted",
  failed: "amber",
  down: "red",
};

function mainWord(chip: ProductionChip): string {
  switch (chip.state) {
    case "unverified":
      return chip.readLine ?? "Runtime not verified";
    case "ok":
    case "waiting":
      return chip.untold === undefined ? "Healthy" : cannotTellWhatRuns(chip.untold);
    case "releasing":
      return chip.next === undefined ? "Deploying…" : `Releasing ${chip.next}`;
    case "failed":
      return chip.label === "prod" ? "Release failed" : "Deploy failed";
    case "down":
      return "Down";
    case "stopped":
      return "Stopped";
    case "creating":
      return "Setting up…";
    case "empty":
      return chip.label === "prod" ? "Not released yet" : "Not deployed yet";
  }
}

/** A listed stop's dot, by where its last deploy stands. */
export const STOP_DOT: Record<GroupFlowStop["state"], ChipDot> = {
  deployed: "ok",
  deploying: "spinner",
  failed: "attention",
  empty: "off",
  checking: "off",
};

/** A stage being set up, in the stages' menu: created and not listed yet, or its import running. */
const STAGE_SETTING_UP_WORD = "Setting up…";

function stopWord(stop: GroupFlowStop, deployedAt: string | undefined, nowMs: number): string {
  switch (stop.state) {
    case "deployed": {
      const ago = deployedAt === undefined ? undefined : deployedAgo(deployedAt, nowMs);
      return ago === undefined ? "Deployed" : `Deployed ${ago}`;
    }
    case "deploying":
      return "Deploying…";
    case "failed":
      return "Deploy failed";
    case "empty":
      // A first deploy asked for says where it stands, as the stage's cell does.
      return firstDeployLine(stop.firstDeploy) ?? "Not deployed yet";
    case "checking":
      return stop.readLine ?? "Checking what runs here…";
  }
}

/** "Release v0.1.57 failed 12 min ago: <HQ's words>." */
function failureSentence(failure: ReleaseFailure, nowMs: number): string {
  const ago = failure.at === undefined ? undefined : deployedAgo(failure.at, nowMs);
  const verb = failure.kind === "refused" ? "was refused" : "failed";
  const when = ago === undefined ? "" : ` ${ago}`;
  const why = failure.error === undefined ? "" : `: ${failure.error.replace(/\.$/u, "")}`;
  return `Release ${failure.tag} ${verb}${when}${why}.`;
}

/**
 * What went wrong, in sentences — every one that is true: production down or
 * stopped says as well that its last release failed, or that one is on its
 * way. `serving` is what the stop runs: production's release, a stage's
 * commit.
 */
function troubleNote(input: {
  readonly chip: ProductionChip;
  readonly failure: ReleaseFailure | undefined;
  readonly down: ReadonlyArray<string>;
  readonly serving: string | undefined;
  readonly nowMs: number;
}): string | undefined {
  const { chip, failure, serving } = input;
  const production = chip.label === "prod";
  const failed =
    production && failure !== undefined ? failureSentence(failure, input.nowMs) : undefined;
  const coming = chip.next === undefined ? undefined : `Releasing ${chip.next}.`;
  if (chip.state === "down" || chip.state === "stopped") {
    const down =
      chip.state === "down"
        ? `Down: ${input.down.length === 0 ? "its services" : joined(input.down)} failed on the platform.${
            production && serving !== undefined ? ` ${serving} was the last release.` : ""
          }`
        : undefined;
    const said = [down, failed, coming].filter((part) => part !== undefined);
    return said.length === 0 ? undefined : said.join(" ");
  }
  if (chip.state !== "failed") return undefined;
  const still =
    serving === undefined ? " Nothing is serving yet." : ` ${serving} is still serving.`;
  return failed === undefined ? `The last deploy failed.${still}` : `${failed}${still}`;
}

/** Production's menu: production's row, what went wrong and the fix, its links. What waits is the heading line's (D′). */
export function productionMenu(input: {
  readonly chip: ProductionChip;
  /** Production's Zerops project; none while it is being set up. */
  readonly projectId: string | undefined;
  readonly failure: ReleaseFailure | undefined;
  /** The services the platform marks failed, while down. */
  readonly down: ReadonlyArray<string>;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly nowMs: number;
}): ChipMenuModel {
  const { chip } = input;
  return {
    stops: [
      {
        projectId: input.projectId,
        name: "production",
        version: chip.version,
        dot: chipDot(chip),
        word: mainWord(chip),
        tone: MENU_TONE[chip.state],
        note: troubleNote({ ...input, serving: chip.version }),
        fix: fixProblemOf(input),
        routes: input.routes,
      },
    ],
  };
}

/**
 * The stages' menu: each stage as production's menu says production — its
 * row with what it runs and when it was deployed, what went wrong and the
 * fix, its links. What waits to go to production is the heading line's (D′).
 */
export function stageMenu(input: {
  readonly stages: ReadonlyArray<{
    readonly projectId: string;
    /** Its name under the heading. */
    readonly name: string;
    readonly stop: GroupFlowStop;
    /** As a chip of its own says it (`stageStopChip`); `undefined` while unread. */
    readonly chip: ProductionChip | undefined;
    readonly deployedAt: string | undefined;
    /** The services the platform marks failed, while down. */
    readonly down: ReadonlyArray<string>;
    readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  }>;
  /** Stages being created that the listing does not hold yet. */
  readonly creating: ReadonlyArray<{ readonly projectId: string; readonly name: string }>;
  readonly nowMs: number;
}): ChipMenuModel {
  const listed = input.stages.map((stage): ChipMenuStop => {
    const { chip, stop } = stage;
    const serving = stop.version?.label;
    const base = {
      projectId: stage.projectId,
      name: stage.name,
      version: serving,
      routes: stage.routes,
    };
    // Its own import still runs: said as the stages being created are, whatever runs there.
    if (stop.firstDeploy?.kind === "setting-up")
      return {
        ...base,
        dot: "spinner",
        word: STAGE_SETTING_UP_WORD,
        tone: "muted",
        note: undefined,
        fix: undefined,
      };
    if (chip === undefined) {
      return {
        ...base,
        dot: STOP_DOT[stop.state],
        word: stopWord(stop, stage.deployedAt, input.nowMs),
        tone: "muted",
        note: undefined,
        fix: undefined,
      };
    }
    const problem = { chip, failure: undefined, down: stage.down, serving };
    return {
      ...base,
      dot: chipDot(chip),
      word:
        chip.state === "ok" || (chip.state === "empty" && stop.state === "empty")
          ? stopWord(stop, stage.deployedAt, input.nowMs)
          : mainWord(chip),
      tone: MENU_TONE[chip.state],
      note: troubleNote({ ...problem, nowMs: input.nowMs }),
      fix: fixProblemOf({ ...problem, name: stage.name }),
    };
  });
  const coming = input.creating.map((stage): ChipMenuStop => ({
    projectId: undefined,
    name: stage.name,
    version: undefined,
    dot: "spinner",
    word: STAGE_SETTING_UP_WORD,
    tone: "muted",
    note: undefined,
    fix: undefined,
    routes: [],
  }));
  return { stops: [...listed, ...coming] };
}

/** How a release did not go through: "failed deploying app", "was refused". */
function failedHow(failure: ReleaseFailure): string {
  if (failure.kind === "refused") return "was refused";
  return failure.service === undefined ? "failed" : `failed deploying ${failure.service}`;
}

/**
 * What "Ask <your Mate> to fix it" writes into the Mate's composer (S6):
 * what failed, when, HQ's words, and the ask — for a release that
 * did not go through and for production down, both at once where both are
 * true; for a stage whose last deploy failed, or which is down, by its name.
 * Nothing to fix otherwise: a stop stopped on purpose is fine.
 */
export function fixProblemOf(input: {
  readonly chip: ProductionChip;
  readonly failure: ReleaseFailure | undefined;
  readonly down: ReadonlyArray<string>;
  /** A stage's name under the heading. */
  readonly name?: string | undefined;
  /** What the stop runs, where the chip's version says something else (a stage's branch). */
  readonly serving?: string | undefined;
}): FixProblem | undefined {
  const { chip } = input;
  const production = chip.label === "prod";
  const tier = production
    ? "Production"
    : input.name === undefined || input.name === "stage"
      ? "The stage"
      : `The ${input.name} stage`;
  const failure = production ? input.failure : undefined;
  const runs = input.serving ?? chip.version;
  if (chip.state === "down") {
    const which = input.down.length === 0 ? "its services" : joined(input.down);
    const last = production && runs !== undefined ? `${runs} was the last release. ` : "";
    if (failure !== undefined) {
      return {
        what: `${tier} is down: ${which} failed on the platform, and its release ${failure.tag} ${failedHow(failure)}`,
        at: failure.at,
        error: failure.error,
        ask: `${last}Find out why, bring it back, and release again.`,
      };
    }
    return {
      what: `${tier} is down: ${which} failed on the platform`,
      at: undefined,
      error: undefined,
      ask: `${last}Find out why and bring it back.`,
    };
  }
  if (chip.state === "stopped") {
    if (failure === undefined) return undefined;
    return {
      what: `Production's release ${failure.tag} ${failedHow(failure)}`,
      at: failure.at,
      error: failure.error,
      ask: "Production is stopped. Find out why, fix it, and release again.",
    };
  }
  if (chip.state !== "failed") return undefined;
  const serving = runs === undefined ? "" : `${runs} is still serving. `;
  if (!production) {
    return {
      what: `${tier}'s last deploy failed`,
      at: undefined,
      error: undefined,
      ask: `${serving}Find out why and fix it.`,
    };
  }
  if (failure === undefined) {
    return {
      what: "Production's last deploy failed",
      at: undefined,
      error: undefined,
      ask: `${serving}Find out why, fix it, and release again.`,
    };
  }
  return {
    what: `Production's release ${failure.tag} ${failedHow(failure)}`,
    at: failure.at,
    error: failure.error,
    ask: `${serving}Find out why, fix it, and release again.`,
  };
}

/** One part of a fix request's preview: words, or a log's lines in a code box. */
export type DraftPart =
  | { readonly kind: "words"; readonly text: string }
  | { readonly kind: "code"; readonly text: string };

/**
 * The fix request (`fixRequestPrompt`) as its preview draws it before it is
 * written into the Mate's composer: its paragraphs, and a fenced log as the
 * lines it holds.
 */
export function draftParts(prompt: string): ReadonlyArray<DraftPart> {
  const parts: DraftPart[] = [];
  for (const paragraph of prompt.split(/\n{2,}/u)) {
    const fence = paragraph.indexOf("```");
    if (fence === -1) {
      if (paragraph.trim().length > 0) parts.push({ kind: "words", text: paragraph.trim() });
      continue;
    }
    const head = paragraph.slice(0, fence).trim();
    if (head.length > 0) parts.push({ kind: "words", text: head });
    const body = paragraph
      .slice(fence + 3)
      .replace(/```\s*$/u, "")
      .replace(/^\n/u, "")
      .replace(/\n$/u, "");
    parts.push({ kind: "code", text: body });
  }
  return parts;
}
