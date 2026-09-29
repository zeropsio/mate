/**
 * A project's production as one chip on its heading (M2, D1), and the chip's
 * menu.
 *
 * What a person needs of production, by moment: always, at a glance, that
 * there is one, which release it serves, and that it is fine; when something
 * waits, that it does; when it is in trouble, at once and loudest, even with
 * the project folded; when they act, its links, what waits, what failed and
 * where to look. So the chip carries the four facts and never leaves the
 * heading, and its menu holds the rest — the note that says what went wrong,
 * the fix to ask a Mate for (S6), the links, the stages, what waits for a
 * release, and the way to Zerops.
 *
 * Stage is the chip only where there is no production; otherwise it lives in
 * the chip's menu, since the Mates' runs report the stage themselves.
 *
 * Every fact comes from what the menu already reads — `groupFlow`'s stops, the
 * platform's services, Gitea's releases — and a chip is drawn only once what
 * decides it is read: until then it is unknown, and the menu draws the chip it
 * remembers, or nothing (`menuMemory.ts`). A reload never paints a chip it
 * then takes back.
 *
 * Pure: no React, no clock, no store.
 */
import {
  deployedCommit,
  deployStatusContext,
  type FlowReleaseRow,
  type GiteaCommitStatus,
  type GroupEnvironmentRowInput,
  type GroupFlowProduction,
  type GroupFlowStop,
} from "@t3tools/client-runtime/zerops";

import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

import type { FixProblem } from "~/zerops/fixRequest";

/** How a stop's services stand on the platform. */
export type StopServing =
  | { readonly kind: "serving" }
  /** Somebody stopped it: the project, or one of its services. */
  | { readonly kind: "stopped" }
  /** The platform marks these services failed: nothing is served through them. */
  | { readonly kind: "down"; readonly services: ReadonlyArray<string> }
  /** Not read, or in a state that says neither. */
  | { readonly kind: "unknown" };

const SERVICE_STATUS_PREFIX = "SERVICE_";

/**
 * How a stop stands, from its project's status and its own services' — the
 * developer's services, the platform's core and the Mate's container left
 * out. A status with FAIL in it is bad news whatever the platform calls it
 * next (as `serviceStatusTone` reads it).
 */
export function stopServing(input: {
  readonly projectStatus: string | undefined;
  readonly services:
    | ReadonlyArray<{ readonly hostname: string; readonly status: string }>
    | undefined;
}): StopServing {
  if (input.projectStatus === "STOPPED") return { kind: "stopped" };
  if (input.projectStatus !== undefined && input.projectStatus !== "ACTIVE") {
    return { kind: "unknown" };
  }
  const { services } = input;
  if (services === undefined || services.length === 0) return { kind: "unknown" };
  const failed = services
    .filter((service) => /FAIL/u.test(service.status))
    .map((service) => service.hostname);
  if (failed.length > 0) return { kind: "down", services: failed };
  const stopped = services.some(
    (service) =>
      (service.status.startsWith(SERVICE_STATUS_PREFIX)
        ? service.status.slice(SERVICE_STATUS_PREFIX.length)
        : service.status) === "STOPPED",
  );
  return stopped ? { kind: "stopped" } : { kind: "serving" };
}

/** A release that did not go through, newer than what production serves. */
export interface ReleaseFailure {
  readonly tag: string;
  /** Its production deploy failed, or the broker refused the tag. */
  readonly kind: "deploy-failed" | "refused";
  /** When: the failed deploy's status, or the refused tag's; `undefined` where nothing read says. */
  readonly at: string | undefined;
  /** The broker's words: the failed deploy's status description, or the refusal's reason. */
  readonly error: string | undefined;
  /** The service whose deploy failed. */
  readonly service: string | undefined;
}

/**
 * The newest release that failed or was refused, among the ones newer than
 * the release production runs (`stopFailedDeploy`'s rule): an older failure
 * is history. The broker's status on the failed commit carries its words and
 * its time, and it is read wherever that commit runs — the stage, which ran it
 * first, carries production's status too.
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
  const status =
    entry === undefined ? undefined : failedDeployStatus(input.environmentInputs, entry);
  return {
    tag: release.tag,
    kind: "deploy-failed",
    at: status?.created_at,
    error: wordsOf(status?.description),
    service: entry?.service,
  };
}

const wordsOf = (text: string | undefined): string | undefined => {
  const trimmed = text?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

/** The broker's failed production status for one service on one commit, wherever it is read. */
function failedDeployStatus(
  environments: ReadonlyArray<GroupEnvironmentRowInput>,
  entry: { readonly service: string; readonly commit: string },
): GiteaCommitStatus | undefined {
  const production = environments.find((environment) => environment.tier === "production");
  if (production === undefined) return undefined;
  const context = deployStatusContext(production.environment, entry.service);
  const commit = entry.commit.toLowerCase();
  for (const environment of environments) {
    for (const service of environment.services) {
      if (deployedCommit(service.appVersionName) !== commit) continue;
      // Newest first: only the newest of a context says how that deploy went.
      const status = (service.statuses ?? []).find((each) => each.context === context);
      if (status?.state === "failure" || status?.state === "error") return status;
    }
  }
  return undefined;
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
  | "empty";

/** What the chip says: its stop, its state and the facts that state names. */
export interface ProductionChip {
  readonly label: ChipLabel;
  readonly state: ChipState;
  /** What serves now: a release's tag, a hand-made name, a stage's branch. */
  readonly version?: string;
  /** What is on its way, while releasing. */
  readonly next?: string;
  /** Changes merged and not live, while they wait. */
  readonly waiting?: number;
}

export type ChipView =
  | { readonly kind: "none" }
  | { readonly kind: "unknown" }
  | { readonly kind: "chip"; readonly chip: ProductionChip };

/** What Gitea said of the group: answered (with the failed release it read), not yet, or never. */
export type GiteaAnswer =
  | { readonly kind: "answered"; readonly failure: ReleaseFailure | undefined }
  | { readonly kind: "waiting" }
  | { readonly kind: "absent" };

const NONE: ChipView = { kind: "none" };
const UNKNOWN: ChipView = { kind: "unknown" };

const chipView = (chip: ProductionChip): ChipView => ({ kind: "chip", chip });

/** Only the facts a state names, so two draws of one state are one chip. */
function chipOf(
  label: ChipLabel,
  state: ChipState,
  facts: {
    readonly version?: string | undefined;
    readonly next?: string | undefined;
    readonly waiting?: number | undefined;
  } = {},
): ChipView {
  return chipView({
    label,
    state,
    ...(facts.version === undefined ? {} : { version: facts.version }),
    ...(facts.next === undefined ? {} : { next: facts.next }),
    ...(facts.waiting === undefined ? {} : { waiting: facts.waiting }),
  });
}

/**
 * The chip, worst first: production being set up; down or stopped, from the
 * platform alone and at once; unknown while what runs, how its services stand
 * or — where it is coming — Gitea's answer is unread; a release on its way; a
 * release that failed (amber: the old one still serves); nothing released yet;
 * changes waiting (still green: nothing is wrong); healthy. With no
 * production, the first stage in the same words; with neither, no chip.
 */
export function productionChip(input: {
  readonly production: GroupFlowProduction;
  readonly stages: ReadonlyArray<GroupFlowStop>;
  readonly stageBeingCreated: boolean;
  /** A deploy running on production: what served before it, and what it builds. */
  readonly building:
    | { readonly from: string | undefined; readonly to: string | undefined }
    | undefined;
  /** Changes merged and not live (`GroupFlowMain.notLive`). */
  readonly waiting: number;
  readonly serving: { readonly production: StopServing; readonly stage: StopServing };
  readonly gitea: GiteaAnswer;
}): ChipView {
  const { production } = input;
  if (production.kind === "creating") return chipOf("prod", "creating");
  if (production.kind === "absent") return stageChip(input);
  const served =
    input.building === undefined ? production.stop.version?.label : input.building.from;
  const serving = input.serving.production;
  if (serving.kind === "down") return chipOf("prod", "down", { version: served });
  if (serving.kind === "stopped") return chipOf("prod", "stopped", { version: served });
  if (
    production.kind === "checking" ||
    serving.kind === "unknown" ||
    input.gitea.kind === "waiting"
  ) {
    return UNKNOWN;
  }
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
  if (
    (input.gitea.kind === "answered" && input.gitea.failure !== undefined) ||
    production.kind === "deploy-failed"
  ) {
    return chipOf("prod", "failed", { version: served });
  }
  const waiting = input.waiting > 0 ? input.waiting : undefined;
  if (served === undefined) return chipOf("prod", "empty", { waiting });
  if (waiting !== undefined) return chipOf("prod", "waiting", { version: served, waiting });
  return chipOf("prod", "ok", { version: served });
}

/**
 * A deploy running on a stop, as the platform pushed it: what served before it
 * (`undefined` where nothing did, or nothing says) and what it builds.
 */
export function buildingOf(
  deployment: Shown<Deployment> | undefined,
): { readonly from: string | undefined; readonly to: string | undefined } | undefined {
  if (deployment?.state !== "known" || deployment.value.kind !== "deploying") return undefined;
  const { previous, version } = deployment.value;
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

function stageChip(input: Parameters<typeof productionChip>[0]): ChipView {
  const stage = input.stages[0];
  if (stage === undefined) return input.stageBeingCreated ? chipOf("stage", "creating") : NONE;
  const version = stageVersion(stage);
  const serving = input.serving.stage;
  if (serving.kind === "down") return chipOf("stage", "down", { version });
  if (serving.kind === "stopped") return chipOf("stage", "stopped", { version });
  if (stage.state === "checking" || serving.kind === "unknown" || input.gitea.kind === "waiting") {
    return UNKNOWN;
  }
  switch (stage.state) {
    case "deploying":
      return chipOf("stage", "releasing", { version });
    case "failed":
      return chipOf("stage", "failed", { version });
    case "empty":
      return chipOf("stage", "empty");
    case "deployed":
      return chipOf("stage", "ok", { version });
  }
}

/** The chip a menu draws: the one read, or — while unknown — the one it remembers. */
export function drawnChip(
  view: ChipView,
  remembered: ProductionChip | undefined,
): ProductionChip | undefined {
  if (view.kind === "chip") return view.chip;
  return view.kind === "unknown" ? remembered : undefined;
}

/**
 * What the menu's memory keeps after a draw: the chip read, `null` to forget
 * one that no longer is, and `undefined` — nothing learned — while unknown.
 */
export function rememberedChipAfter(view: ChipView): ProductionChip | null | undefined {
  if (view.kind === "chip") return view.chip;
  return view.kind === "none" ? null : undefined;
}

/** The chip's dot: a colour for a state, hollow for a stop on purpose, a spinner while moving. */
export type ChipDot = "ok" | "attention" | "failed" | "off" | "hollow" | "spinner";

/** The chip as it is drawn. */
export interface ChipFace {
  /** Its ground: neutral, amber while a release did not go through, red while down. */
  readonly tone: "neutral" | "amber" | "red";
  readonly dot: ChipDot;
  readonly label: string;
  /** In mono: what serves, and what is on its way. */
  readonly version: string | undefined;
  /** The muted words after it. */
  readonly extra: string | undefined;
  /** The whole state in a sentence: its accessible name. */
  readonly words: string;
}

const TIER_WORD: Record<ChipLabel, string> = { prod: "Production", stage: "Stage" };

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

export function chipFace(chip: ProductionChip): ChipFace {
  const tier = TIER_WORD[chip.label];
  const named = (rest: string) =>
    chip.version === undefined ? `${tier}, ${rest}` : `${tier} ${chip.version}, ${rest}`;
  const face = (
    parts: Omit<ChipFace, "label" | "tone"> & Partial<Pick<ChipFace, "label" | "tone">>,
  ): ChipFace => ({ tone: "neutral", label: chip.label, ...parts });
  switch (chip.state) {
    case "ok":
      return face({ dot: "ok", version: chip.version, extra: undefined, words: named("healthy") });
    case "waiting": {
      const waiting = chip.waiting ?? 0;
      return face({
        dot: "ok",
        version: chip.version,
        extra: `· ${String(waiting)} waiting`,
        words: named(`${plural(waiting, "change", "changes")} waiting`),
      });
    }
    case "releasing": {
      const { version, next } = chip;
      return face({
        dot: "spinner",
        version:
          next === undefined
            ? version
            : version === undefined
              ? `→ ${next}`
              : `${version} → ${next}`,
        extra: next === undefined ? "· deploying" : undefined,
        words: named(next === undefined ? "deploying" : `releasing ${next}`),
      });
    }
    case "failed":
      return face({
        tone: "amber",
        dot: "attention",
        version: chip.version,
        extra: chip.label === "prod" ? "· release failed" : "· deploy failed",
        words: named(chip.label === "prod" ? "the last release failed" : "the last deploy failed"),
      });
    case "down":
      return face({
        tone: "red",
        dot: "failed",
        label: `${chip.label} down`,
        version: undefined,
        extra: undefined,
        words: `${tier} is down`,
      });
    case "stopped":
      return face({
        dot: "hollow",
        label: `${chip.label} stopped`,
        version: undefined,
        extra: undefined,
        words: `${tier} is stopped`,
      });
    case "creating":
      return face({
        dot: "spinner",
        version: undefined,
        extra: "· setting up",
        words: `${tier} is being set up`,
      });
    case "empty": {
      const { waiting } = chip;
      return face({
        dot: "off",
        version: undefined,
        extra:
          waiting !== undefined
            ? `· ${String(waiting)} waiting`
            : chip.label === "prod"
              ? "· not released"
              : "· not deployed",
        words:
          waiting !== undefined
            ? `${tier}, nothing released yet, ${plural(waiting, "change", "changes")} waiting`
            : `${tier}, nothing ${chip.label === "prod" ? "released" : "deployed"} yet`,
      });
    }
  }
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

/** One row of the chip's menu: a stop, what it runs, and the word for where it stands. */
export interface ChipMenuStop {
  readonly name: string;
  readonly version: string | undefined;
  readonly dot: ChipDot;
  readonly word: string;
}

export interface ChipMenuModel {
  /** The chip's own stop. */
  readonly main: {
    readonly name: "production" | "stage";
    readonly version: string | undefined;
    readonly dot: ChipDot;
    readonly word: string;
    readonly tone: "muted" | "amber" | "red";
  };
  /** What went wrong, when something did. */
  readonly note: string | undefined;
  /** Something is broken: the menu offers "Ask <your Mate> to fix it" (S6). */
  readonly trouble: boolean;
  /** The stages, under production. */
  readonly stages: ReadonlyArray<ChipMenuStop>;
  /** Changes waiting for production, with Review; none on a stage's menu. */
  readonly waiting: number;
}

const MAIN_DOT: Record<ChipState, ChipDot> = {
  ok: "ok",
  waiting: "ok",
  releasing: "spinner",
  failed: "attention",
  down: "failed",
  stopped: "hollow",
  creating: "spinner",
  empty: "off",
};

function mainWord(chip: ProductionChip): string {
  switch (chip.state) {
    case "ok":
    case "waiting":
      return "Healthy";
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
      return "Not deployed yet";
    case "checking":
      return "Checking…";
  }
}

function troubleNote(input: {
  readonly chip: ProductionChip;
  readonly failure: ReleaseFailure | undefined;
  readonly down: ReadonlyArray<string>;
  readonly nowMs: number;
}): string | undefined {
  const { chip, failure } = input;
  if (chip.state === "down") {
    const which = input.down.length === 0 ? "its services" : joined(input.down);
    const last =
      chip.label === "prod" && chip.version !== undefined
        ? ` ${chip.version} was the last release.`
        : "";
    return `Down: ${which} failed on the platform.${last}`;
  }
  if (chip.state !== "failed") return undefined;
  const serving =
    chip.version === undefined ? " Nothing is serving yet." : ` ${chip.version} is still serving.`;
  if (chip.label === "stage") return `The last deploy failed.${serving}`;
  if (failure === undefined) return `The last deploy failed.${serving}`;
  const ago = failure.at === undefined ? undefined : deployedAgo(failure.at, input.nowMs);
  const verb = failure.kind === "refused" ? "was refused" : "failed";
  const when = ago === undefined ? "" : ` ${ago}`;
  const why = failure.error === undefined ? "" : `: ${failure.error.replace(/\.$/u, "")}`;
  return `Release ${failure.tag} ${verb}${when}${why}.${serving}`;
}

/** What the chip's menu says, per state (`SidebarProductionChip`'s menu). */
export function chipMenu(input: {
  readonly chip: ProductionChip;
  readonly failure: ReleaseFailure | undefined;
  /** The services the platform marks failed, while down. */
  readonly down: ReadonlyArray<string>;
  /** The stages, each by its name under the heading, with when it was last deployed. */
  readonly stages: ReadonlyArray<{
    readonly name: string;
    readonly stop: GroupFlowStop;
    readonly deployedAt: string | undefined;
  }>;
  /** Changes merged and not live. */
  readonly waiting: number;
  readonly nowMs: number;
}): ChipMenuModel {
  const { chip } = input;
  const production = chip.label === "prod";
  return {
    main: {
      name: production ? "production" : "stage",
      version: chip.version,
      dot: MAIN_DOT[chip.state],
      word: mainWord(chip),
      tone: chip.state === "failed" ? "amber" : chip.state === "down" ? "red" : "muted",
    },
    note: troubleNote(input),
    trouble: chip.state === "failed" || chip.state === "down",
    stages: production
      ? input.stages.map(({ name, stop, deployedAt }) => ({
          name,
          version: stop.version?.label,
          dot: STOP_DOT[stop.state],
          word: stopWord(stop, deployedAt, input.nowMs),
        }))
      : [],
    waiting: production ? input.waiting : 0,
  };
}

/**
 * What "Ask <your Mate> to fix it" writes into the Mate's composer (S6):
 * what failed, when, the broker's words, and the ask — for a release that
 * did not go through and for production down. Nothing to fix otherwise.
 */
export function fixProblemOf(input: {
  readonly chip: ProductionChip;
  readonly failure: ReleaseFailure | undefined;
  readonly down: ReadonlyArray<string>;
}): FixProblem | undefined {
  const { chip, failure } = input;
  const tier = chip.label === "prod" ? "Production" : "The stage";
  if (chip.state === "down") {
    const which = input.down.length === 0 ? "its services" : joined(input.down);
    const last =
      chip.label === "prod" && chip.version !== undefined
        ? `${chip.version} was the last release. `
        : "";
    return {
      what: `${tier} is down: ${which} failed on the platform`,
      at: undefined,
      error: undefined,
      ask: `${last}Find out why and bring it back.`,
    };
  }
  if (chip.state !== "failed") return undefined;
  const serving = chip.version === undefined ? "" : `${chip.version} is still serving. `;
  if (chip.label === "stage") {
    return {
      what: "The stage's last deploy failed",
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
  const how =
    failure.kind === "refused"
      ? "was refused"
      : failure.service === undefined
        ? "failed"
        : `failed deploying ${failure.service}`;
  return {
    what: `Production's release ${failure.tag} ${how}`,
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
