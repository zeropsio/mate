/**
 * What a project's card on the overview says (round 5, "Mate Clean Overview"): its Mates, two
 * lines each, what waits on the viewer lifted with its buttons; a release ready to go, lifted; and
 * at its foot production's one line — what runs there, since when, or what went wrong.
 *
 * The card says what the menu says: a Mate's words and time are its menu row's
 * (`mateRowView`), and production's state is its menu chip's (`productionChip`) where the page
 * has read one; without a chip the flow's own production reading (`groupFlow`) stands.
 *
 * Pure: no React, no clock of its own.
 */
import type {
  FlowPullRequest,
  FlowReleaseRow,
  GroupFlow,
  GroupFlowMate,
  GroupFlowProduction,
  GroupFlowStop,
} from "@t3tools/client-runtime/zerops";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";

import type { ProductionChip } from "../SidebarProductionChip.logic";
import type { MateRowView } from "../SidebarMateRow.logic";

/** At most this many Mates stand on a card; past it the quiet ones fold. */
export const CARD_MATES_SHOWN = 4;

/** A place's dot: grey running, amber failed, red down, blue releasing, hollow when none. */
export type PlaceDot = "running" | "failed" | "down" | "releasing" | "none" | "unknown";

/** One line at a card's foot: a place the code runs, in plain words. */
export interface PlaceLine {
  /** Its Zerops project, where it has one. */
  readonly projectId: string | undefined;
  readonly kind: "production" | "stage";
  readonly name: string;
  /** Its name is said: a stage standing in for a production the project lacks. */
  readonly named: boolean;
  readonly dot: PlaceDot;
  /** Said one after the other, `·` between. */
  readonly words: ReadonlyArray<string>;
  /** Something is wrong there or on its way: its panel says what, and what to do. */
  readonly trouble: boolean;
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const CLOCK = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "since 10:42" today, "since Tue" this week, "since Sep 18" before; nothing for a bad date. */
export function sinceWords(at: string | undefined, nowMs: number): string | undefined {
  if (at === undefined) return undefined;
  const then = Date.parse(at);
  if (Number.isNaN(then)) return undefined;
  const day = new Date(then);
  const today = new Date(nowMs);
  if (day.toDateString() === today.toDateString()) return `since ${CLOCK.format(day)}`;
  const days = (nowMs - then) / 86_400_000;
  if (days >= 0 && days < 6) return `since ${WEEKDAY.format(day)}`;
  return `since ${DAY.format(day)}`;
}

const joined = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

/** What production's line says from its chip, the menu's reading of it. */
function chipLine(
  chip: ProductionChip,
  facts: { readonly since: string | undefined; readonly down: ReadonlyArray<string> },
): Pick<PlaceLine, "dot" | "words" | "trouble"> {
  const runs = chip.version;
  switch (chip.state) {
    case "ok":
    case "waiting":
      return {
        dot: chip.lastKnown === true ? "unknown" : "running",
        words: ["Running", runs, facts.since].filter((word) => word !== undefined),
        trouble: false,
      };
    case "unverified":
      return { dot: "unknown", words: [chip.readLine ?? "Checking what runs…"], trouble: false };
    case "releasing":
      return {
        dot: "releasing",
        words: [chip.next === undefined ? "Deploying…" : `Releasing ${chip.next}`],
        trouble: false,
      };
    case "failed":
      return {
        dot: "failed",
        words: [
          chip.label === "prod" ? "Release failed" : "Deploy failed",
          ...(runs === undefined ? [] : [`still runs ${runs}`]),
        ],
        trouble: true,
      };
    case "down":
      return {
        dot: "down",
        words: [
          "Down",
          facts.down.length === 0 ? "its services failed" : `${joined(facts.down)} failed`,
        ],
        trouble: true,
      };
    case "stopped":
      return { dot: "none", words: ["Stopped"], trouble: false };
    case "creating":
      return { dot: "unknown", words: ["Setting up…"], trouble: false };
    case "empty":
      return {
        dot: "none",
        words: [chip.label === "prod" ? "Not released yet" : "Not deployed yet"],
        trouble: false,
      };
  }
}

/** What production's line says from the flow alone, where no chip was read. */
function flowLine(
  production: Exclude<GroupFlowProduction, { readonly kind: "absent" }>,
  since: string | undefined,
): Pick<PlaceLine, "dot" | "words" | "trouble"> {
  switch (production.kind) {
    case "creating":
      return { dot: "unknown", words: [production.line], trouble: false };
    case "checking":
      return {
        dot: "unknown",
        words: [production.stop.readLine ?? production.line],
        trouble: false,
      };
    case "empty":
      return { dot: "none", words: ["Not released yet"], trouble: false };
    case "deploying":
      return { dot: "releasing", words: ["Deploying…"], trouble: false };
    case "releasing":
      return { dot: "releasing", words: [`Releasing ${production.tag}`], trouble: false };
    case "deploy-failed": {
      const runs = production.stop.version?.label;
      return {
        dot: "failed",
        words: ["Release failed", ...(runs === undefined ? [] : [`still runs ${runs}`])],
        trouble: true,
      };
    }
    case "live":
    case "ready-to-release":
      return {
        dot: "running",
        words: ["Running", production.stop.version?.label, since].filter(
          (word) => word !== undefined,
        ),
        trouble: false,
      };
  }
}

/** A stage's line where it stands in for the production a project lacks: only while in trouble. */
function troubledStageLine(
  stop: GroupFlowStop,
  chip: ProductionChip | undefined,
  down: ReadonlyArray<string>,
): PlaceLine | undefined {
  const base = { projectId: stop.projectId, kind: "stage" as const, name: stop.name, named: true };
  if (chip !== undefined && (chip.state === "failed" || chip.state === "down"))
    return { ...base, ...chipLine(chip, { since: undefined, down }) };
  if (chip === undefined && stop.state === "failed")
    return { ...base, dot: "failed", words: ["Deploy failed"], trouble: true };
  return undefined;
}

/**
 * The card's foot: production's one line, or — where the project has no production — a stage in
 * trouble by its name, else "Not released yet". Every card ends the same way.
 */
export function placeLines(input: {
  readonly flow: Pick<GroupFlow, "production" | "stages">;
  /** Production's chip as the menu reads it; `undefined` where none was read. */
  readonly chip?: ProductionChip | undefined;
  /** Each stage's own chip, by its project. */
  readonly stageChips?: ReadonlyMap<string, ProductionChip | undefined> | undefined;
  /** When production took what it runs. */
  readonly since?: string | undefined;
  /** The services the platform marks failed, by place. */
  readonly down?: ReadonlyMap<string, ReadonlyArray<string>> | undefined;
  readonly nowMs: number;
}): ReadonlyArray<PlaceLine> {
  const { production, stages } = input.flow;
  const downOf = (projectId: string | undefined) =>
    (projectId === undefined ? undefined : input.down?.get(projectId)) ?? [];
  if (production.kind === "absent") {
    for (const stop of stages) {
      const line = troubledStageLine(
        stop,
        input.stageChips?.get(stop.projectId),
        downOf(stop.projectId),
      );
      if (line !== undefined) return [line];
    }
    return [
      {
        projectId: undefined,
        kind: "production",
        name: "production",
        named: false,
        dot: "none",
        words: ["Not released yet"],
        trouble: false,
      },
    ];
  }
  const projectId = production.kind === "creating" ? undefined : production.stop.projectId;
  const since = sinceWords(input.since, input.nowMs);
  const said =
    input.chip === undefined
      ? flowLine(production, since)
      : chipLine(input.chip, { since, down: downOf(projectId) });
  return [{ projectId, kind: "production", name: "production", named: false, ...said }];
}

/** The release a card offers: how many changes, where they were tested, what production runs. */
export interface CardReady {
  readonly count: number;
  readonly atLeast: boolean;
  /** The stage they were tested on; `undefined` where the project has none. */
  readonly stage: string | undefined;
  /** What production runs now; `undefined` where nothing is released yet. */
  readonly from: string | undefined;
  /** Production's last release failed: it still runs `from`. */
  readonly failed: boolean;
}

/**
 * A release ready to go, wherever the release gate offers one — beside a production whose last
 * release failed too (D28): releasing the fix is how it is mended. Never while one is on its way.
 */
export function cardReady(flow: Pick<GroupFlow, "production" | "stages" | "main">) {
  const { production } = flow;
  const offered =
    production.kind === "ready-to-release" ||
    (production.kind === "deploy-failed" && production.candidate !== undefined);
  if (!offered || production.candidate === undefined) return undefined;
  const stage = flow.stages.find((stop) => stop.state === "deployed") ?? flow.stages[0];
  return {
    count: production.candidate.waiting,
    atLeast: flow.main.notLiveAtLeast,
    stage: stage?.name,
    from: production.stop.version?.label,
    failed: production.kind === "deploy-failed",
  } satisfies CardReady;
}

/** "3 changes ready to release", "1 change ready to release". */
export function readyTitle(ready: CardReady): string {
  const count = `${ready.atLeast ? "At least " : ""}${String(ready.count)}`;
  return `${count} change${ready.count === 1 ? "" : "s"} ready to release`;
}

/** "On stage, tested. Production runs v2.3.1." */
export function readyLine(ready: CardReady): string {
  const where = ready.stage === undefined ? "Merged." : `On ${ready.stage}, tested.`;
  const runs = ready.failed
    ? ready.from === undefined
      ? "Production's last release failed."
      : `Production's last release failed; it still runs ${ready.from}.`
    : ready.from === undefined
      ? "Nothing is released yet."
      : `Production runs ${ready.from}.`;
  return `${where} ${runs}`;
}

/** What a Mate waiting on the viewer is lifted onto a card with, and its buttons. */
export type MateLift =
  /** Approve plan, and Change it… */
  | { readonly kind: "plan" }
  /** Answer… */
  | { readonly kind: "question" }
  /** Ask <Mate> to fix it */
  | { readonly kind: "fix" }
  /** Review change */
  | { readonly kind: "review"; readonly pull: FlowPullRequest };

/** A Mate nobody has asked anything, its conversations read: the menu row's words for it. */
export const NOTHING_ASKED_YET = "Nothing asked yet";

/** A Mate's two lines on a card: the menu row's words, and what lifts it. */
export interface CardMateReading {
  /** Its second line; `undefined` while words are on their way (the line keeps its place). */
  readonly text: string | undefined;
  readonly tone: "muted" | "ink" | "failed";
  readonly lift: MateLift | undefined;
}

/**
 * What a Mate's card row says: the words its menu row says (`mateRowView`), the question in ink
 * and an error in red; lifted with its buttons only where it waits on the viewer — its plan, its
 * question, its error, or its change waiting for their review.
 */
export function cardMateReading(input: {
  readonly view: Pick<MateRowView, "state" | "ask" | "reply">;
  /** The conversation's status kind (`ZeropsAgentActivity.kind`): a plan or a question. */
  readonly status: ThreadStatusKind | undefined;
  /** The viewer's own Mate: only then does what it waits on wait on them. */
  readonly mine: boolean;
  /** Its change waiting for the viewer's review (`changeShowsReview`). */
  readonly review: FlowPullRequest | undefined;
  /** Its conversations are read: none asked is then a fact the line says, as the menu's does. */
  readonly read?: boolean | undefined;
}): CardMateReading {
  const { view, mine } = input;
  const reply = view.reply;
  const said =
    reply?.kind === "words"
      ? { text: reply.text, tone: reply.tone }
      : reply?.kind === "live"
        ? { text: reply.words, tone: "muted" as const }
        : reply === undefined
          ? { text: view.ask, tone: "muted" as const }
          : { text: undefined, tone: "muted" as const };
  const text =
    said.text === undefined && reply === undefined && view.ask === undefined && input.read === true
      ? NOTHING_ASKED_YET
      : said.text;
  const tone = said.tone === "failed" ? "failed" : said.tone === "ink" ? "ink" : "muted";
  const lift: MateLift | undefined = !mine
    ? undefined
    : input.review !== undefined && view.state !== "working"
      ? { kind: "review", pull: input.review }
      : view.state === "needs"
        ? input.status === "planReady"
          ? { kind: "plan" }
          : { kind: "question" }
        : view.state === "failed"
          ? { kind: "fix" }
          : undefined;
  return {
    text,
    tone: lift !== undefined && tone === "muted" ? "ink" : tone,
    lift,
  };
}

/**
 * The change of a Mate's that waits for review, by the rule the menu reads (`changeShowsReview`,
 * the flow's `review`): none while it works.
 */
export function mateChangeForReview(
  flow: Pick<GroupFlow, "pullRequests">,
  mateProjectId: string,
): FlowPullRequest | undefined {
  return flow.pullRequests.find(
    (entry) => entry.review && entry.pull.mateProjectId === mateProjectId,
  )?.pull;
}

/** A Mate with something to show stays out of the fold: at work, failed, asking, or a change. */
export function mateIsLoud(mate: GroupFlowMate, flow: Pick<GroupFlow, "pullRequests">): boolean {
  return (
    mate.working === true ||
    mate.failed === true ||
    mate.waiting ||
    mate.coming !== undefined ||
    mateChangeForReview(flow, mate.projectId) !== undefined
  );
}

/** Keep the person's order; past `max`, the quiet ones fold. */
export function foldMates<M>(
  mates: ReadonlyArray<M>,
  loud: (mate: M) => boolean,
  max: number = CARD_MATES_SHOWN,
): { readonly shown: ReadonlyArray<M>; readonly folded: ReadonlyArray<M> } {
  if (mates.length <= max) return { shown: mates, folded: [] };
  const keep = new Set(mates.filter(loud));
  for (const mate of mates) {
    if (keep.size >= max) break;
    keep.add(mate);
  }
  return {
    shown: mates.filter((mate) => keep.has(mate)),
    folded: mates.filter((mate) => !keep.has(mate)),
  };
}

/** "2 more Mates", "1 more Mate". */
export function foldWords(count: number): string {
  return `${String(count)} more Mate${count === 1 ? "" : "s"}`;
}

/** Production's address as a person reads it: no scheme, no trailing slash. */
export function siteOf(route: string | undefined): string | undefined {
  if (route === undefined) return undefined;
  const host = route.replace(/^[a-z]+:\/\//iu, "").replace(/\/+$/u, "");
  return host.length === 0 ? undefined : host;
}

/** The people on a project, once each, in order; drawn only when more than one. */
export function cardPeople<P extends { readonly userId: string }>(
  owners: ReadonlyArray<P | null | undefined>,
): ReadonlyArray<P> {
  const seen = new Set<string>();
  const people: P[] = [];
  for (const owner of owners) {
    if (owner == null || seen.has(owner.userId)) continue;
    seen.add(owner.userId);
    people.push(owner);
  }
  return people.length > 1 ? people : [];
}

/** A release as production's panel reads it: newest first, as the flow lists them. */
type PanelRelease = Pick<FlowReleaseRow, "tag" | "taggedAt" | "standing" | "rollBack">;

/** The changes the release production runs brought: merged after the one before it was made. */
export function broughtBy(
  merged: ReadonlyArray<FlowPullRequest>,
  releases: ReadonlyArray<PanelRelease>,
): ReadonlyArray<FlowPullRequest> {
  const at = releases.findIndex((release) => release.standing === "live");
  const live = releases[at];
  if (live === undefined) return [];
  const before = releases[at + 1];
  return merged.filter(
    (pull) =>
      pull.mergedAt !== undefined &&
      pull.mergedAt <= live.taggedAt &&
      (before === undefined || pull.mergedAt > before.taggedAt),
  );
}

/** The release production goes back to: the newest one before what it runs that may be rolled back to. */
export function rollBackTarget(releases: ReadonlyArray<PanelRelease>): string | undefined {
  const at = releases.findIndex((release) => release.standing === "live");
  if (at === -1) return undefined;
  return releases.slice(at + 1).find((release) => release.rollBack)?.tag;
}
