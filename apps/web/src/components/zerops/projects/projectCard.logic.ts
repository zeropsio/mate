/**
 * What a project's card on the overview says: its Mates, what each was asked over its answer, what
 * waits on the viewer lifted with its buttons; a release ready to go, lifted; and at its foot its
 * places — previews, stages, production — each what runs there, since when, or what went wrong.
 *
 * The card says what the menu says: a Mate's words and time are its menu row's
 * (`mateRowView`), and a place's state is its menu chip's (`productionChip`) where the page has
 * read one; without a chip the flow's own reading (`groupFlow`) stands.
 *
 * Pure: no React, no clock of its own.
 */
import {
  changeState,
  type FlowPullRequest,
  type FlowReleaseRow,
  type GroupFlow,
  type GroupFlowAddress,
  type GroupFlowMate,
  type GroupFlowProduction,
  type GroupFlowStop,
} from "@t3tools/client-runtime/zerops";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";

import type { ProductionChip } from "../SidebarProductionChip.logic";
import { MATE_DELETING_WORD } from "../ZeropsDeleteMateDialog.logic";
import type {
  MateRowAskLine,
  MateRowReply,
  MateRowSecond,
  MateRowView,
} from "../SidebarMateRow.logic";
import { NOT_IN_HQ_LINE } from "../ZeropsProjectRow.logic";

/** At most this many Mates stand on a card; past it the quiet ones fold. */
export const CARD_MATES_SHOWN = 4;

/** A place's dot: grey running, amber failed, red down, blue releasing, hollow when none. */
export type PlaceDot = "running" | "failed" | "down" | "releasing" | "none" | "unknown";

/** One line at a card's foot: a place the code runs, by its name, in plain words, and its door. */
export interface PlaceLine {
  /** Its Zerops project, where it has one. */
  readonly projectId: string | undefined;
  readonly kind: "production" | "stage";
  /** What its row calls it: a stage by its own name, production "prod", as the menu's road does. */
  readonly name: string;
  readonly dot: PlaceDot;
  /** Said one after the other, `·` between. */
  readonly words: ReadonlyArray<string>;
  /** Something is wrong there or on its way: its panel says what, and what to do. */
  readonly trouble: boolean;
  /** Its public addresses, one per service it serves, opened beside the page; none where none. */
  readonly addresses: ReadonlyArray<GroupFlowAddress>;
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

/** A stage's line: its chip's words where the menu read one, else what the flow says it runs. */
function stageLine(
  stop: GroupFlowStop,
  chip: ProductionChip | undefined,
  down: ReadonlyArray<string>,
): PlaceLine {
  const base = {
    projectId: stop.projectId,
    kind: "stage" as const,
    name: stop.name,
    addresses: stop.addresses,
  };
  if (chip !== undefined) return { ...base, ...chipLine(chip, { since: undefined, down }) };
  switch (stop.state) {
    case "failed":
      return { ...base, dot: "failed", words: ["Deploy failed"], trouble: true };
    case "deploying":
      return { ...base, dot: "releasing", words: ["Deploying…"], trouble: false };
    case "empty":
      return { ...base, dot: "none", words: ["Not deployed yet"], trouble: false };
    case "checking":
      return {
        ...base,
        dot: "unknown",
        words: [stop.readLine ?? "Checking what runs…"],
        trouble: false,
      };
    case "deployed":
      return {
        ...base,
        dot: "running",
        words: ["Running", stop.version?.label].filter((word) => word !== undefined),
        trouble: false,
      };
  }
}

/**
 * A card's places in the order the code travels: every stage by its name, then production — each
 * how it is and where it is (the owner, 2026-10-11: the overview showed production alone, and
 * everything else was a click or more away). Production is always said, "Not released yet" where
 * nothing runs there, so every card ends on it.
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
  const staged = stages.map((stop) =>
    stageLine(stop, input.stageChips?.get(stop.projectId), downOf(stop.projectId)),
  );
  const prod = { kind: "production" as const, name: "prod" };
  if (production.kind === "absent")
    return [
      ...staged,
      {
        ...prod,
        projectId: undefined,
        addresses: [],
        dot: "none",
        words: ["Not released yet"],
        trouble: false,
      },
    ];
  const stop = production.kind === "creating" ? undefined : production.stop;
  const since = sinceWords(input.since, input.nowMs);
  const said =
    input.chip === undefined
      ? flowLine(production, since)
      : chipLine(input.chip, { since, down: downOf(stop?.projectId) });
  return [
    ...staged,
    { ...prod, projectId: stop?.projectId, addresses: stop?.addresses ?? [], ...said },
  ];
}

/** What a place is called on its card: production in full, a stage by its own name, capitalised. */
export function placeLabel(line: Pick<PlaceLine, "kind" | "name">): string {
  if (line.kind === "production") return "Production";
  return line.name.charAt(0).toLocaleUpperCase() + line.name.slice(1);
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
  /** The menu row's line 2 for it (`cardSecondWords`): said wherever nothing lifts it. */
  readonly line?: { readonly text: string | undefined; readonly tone: CardMateReading["tone"] };
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
  if (lift === undefined && input.line !== undefined)
    return { text: input.line.text, tone: input.line.tone, lift };
  // A change lifted for review is named by its title, as its menu row names it: the Mate's last
  // words may be of another moment (a limit it hit).
  if (lift?.kind === "review") return { text: lift.pull.title, tone: "ink", lift };
  return {
    text,
    tone: lift !== undefined && tone === "muted" ? "ink" : tone,
    lift,
  };
}

/**
 * The menu row's line 2 (`mateRowSecond`) in words, as a card draws it: the same words in the
 * same ink, so a Mate says the same in both places.
 */
export function cardSecondWords(input: {
  readonly second: MateRowSecond;
  readonly reply: MateRowReply;
  readonly askLine: MateRowAskLine;
  /** When a paused Mate picks up again, as the person reads a time. */
  readonly pausedUntil: (at: string) => string;
}): { readonly text: string | undefined; readonly tone: CardMateReading["tone"] } {
  const { second, reply, askLine } = input;
  const muted = (text: string | undefined) => ({ text, tone: "muted" as const });
  switch (second.kind) {
    case "coming":
    case "finishing":
    case "none":
      return muted(undefined);
    case "deleting":
      return muted(MATE_DELETING_WORD);
    case "outside":
      return muted(NOT_IN_HQ_LINE);
    case "sign-in":
      return askLine?.kind === "sign-in"
        ? { text: askLine.text, tone: askLine.waitsOnViewer ? "ink" : "muted" }
        : muted(undefined);
    case "reply": {
      const text =
        reply?.kind === "words" ? reply.text : reply?.kind === "live" ? reply.words : undefined;
      const tone = second.tone === "failed" ? "failed" : second.tone === "ink" ? "ink" : "muted";
      return { text, tone };
    }
    case "waits-on":
      return muted(second.text);
    case "paused":
      return muted(`Paused until ${input.pausedUntil(second.until)}`);
    case "change":
      return second.mine
        ? { text: second.title, tone: "ink" }
        : muted(`${second.title} · in review`);
    case "ask":
      if (askLine === undefined || askLine.kind === "sign-in") return muted(undefined);
      if (askLine.kind === "nothing-asked") return muted(NOTHING_ASKED_YET);
      if (askLine.kind === "draft") return muted(`Draft: ${askLine.text}`);
      return muted(askLine.by === undefined ? askLine.text : `${askLine.by}: ${askLine.text}`);
  }
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

/** The one address a place answers at, as a person reads it; none where several services serve. */
export function soleSite(addresses: ReadonlyArray<GroupFlowAddress>): string | undefined {
  return addresses.length === 1 ? siteOf(addresses[0]?.url) : undefined;
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

/** How many of its latest changes a card shows. */
export const CARD_CHANGES = 5;

/** One of a card's latest changes: open, with what stops it; or merged, with where it went. */
export interface CardChange {
  readonly pull: FlowPullRequest;
  readonly open: boolean;
  /** "Ready to merge", what stops it; "In v1.0.4", "On stage", "Not released yet", "Merged". */
  readonly words: string;
  /** Its words' tone: the change state's for an open one; quiet for a merged one. */
  readonly tone: NonNullable<ReturnType<typeof changeState>>["tone"];
  /** When it last moved: updated while open, merged once landed. */
  readonly at: string | undefined;
}

const newestFirst = (left: string | undefined, right: string | undefined) =>
  (right ?? "").localeCompare(left ?? "");

/**
 * A card's latest changes (the owner, 2026-10-11: "quick history of latest PRs"): the open ones
 * first, each with what stops it, then the merged ones, each with where it went — in the oldest
 * release made after it landed, else on stage, else not released yet where the project has a
 * production, else merged — newest first, `limit` at most. Merged ones are known only while the
 * project's detail is read.
 */
export function cardChanges(input: {
  readonly open: ReadonlyArray<FlowPullRequest>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
  /** Newest first, as the flow lists them. */
  readonly releases: ReadonlyArray<Pick<FlowReleaseRow, "tag" | "taggedAt">>;
  /** The project has a stage, where a merged change goes first. */
  readonly stage: boolean;
  /** The project has a production, where a merged change is released. */
  readonly production: boolean;
  readonly limit: number;
}): ReadonlyArray<CardChange> {
  const open = input.open
    .toSorted((left, right) => newestFirst(left.updatedAt, right.updatedAt))
    .map((pull): CardChange => {
      const state = changeState(pull);
      return {
        pull,
        open: true,
        words: state?.word ?? "Open",
        tone: state?.tone ?? "off",
        at: pull.updatedAt,
      };
    });
  const merged = input.merged
    .filter((pull) => pull.mergedAt !== undefined)
    .toSorted((left, right) => newestFirst(left.mergedAt, right.mergedAt))
    .map((pull): CardChange => {
      const took = input.releases.findLast(
        (release) => pull.mergedAt !== undefined && release.taggedAt >= pull.mergedAt,
      );
      return {
        pull,
        open: false,
        words:
          took !== undefined
            ? `In ${took.tag}`
            : input.stage
              ? "On stage"
              : input.production
                ? "Not released yet"
                : "Merged",
        tone: "off",
        at: pull.mergedAt,
      };
    });
  return [...open, ...merged].slice(0, input.limit);
}

/** A row of a card's changes: a change, or a release cut among them. */
export type CardChangeRow =
  | { readonly kind: "change"; readonly change: CardChange }
  | { readonly kind: "release"; readonly tag: string; readonly live: boolean };

/**
 * A card's changes with the releases cut among them (the owner, 2026-10-12: the changes "should
 * show where tags were marked, where the prod is"): the open ones first, on no release yet; each
 * release over the merged changes it took, newest first — one that took none of them left out —
 * and production's always, closing the list where it is older than every change shown.
 */
export function cardChangeRows(
  changes: ReadonlyArray<CardChange>,
  /** Newest first, as the flow lists them. */
  releases: ReadonlyArray<{
    readonly tag: string;
    readonly taggedAt: string;
    readonly live: boolean;
  }>,
): ReadonlyArray<CardChangeRow> {
  const rows: CardChangeRow[] = [];
  let next = 0;
  for (const change of changes) {
    const mergedAt = change.open ? undefined : change.at;
    if (mergedAt !== undefined) {
      const cut: Array<(typeof releases)[number]> = [];
      while (next < releases.length && releases[next]!.taggedAt >= mergedAt) {
        cut.push(releases[next]!);
        next += 1;
      }
      // The oldest of them took this change; one that took none shown is noise, but production's.
      for (const [index, release] of cut.entries())
        if (release.live || index === cut.length - 1)
          rows.push({ kind: "release", tag: release.tag, live: release.live });
    }
    rows.push({ kind: "change", change });
  }
  const live = releases.slice(next).find((release) => release.live);
  if (live !== undefined) rows.push({ kind: "release", tag: live.tag, live: true });
  return rows;
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
