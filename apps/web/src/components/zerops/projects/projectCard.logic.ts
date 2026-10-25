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
import { lacksOwnDomain, type PlaceAddresses } from "@t3tools/client-runtime/data";
import {
  addressComing,
  changeState,
  placeAddresses,
  PRODUCTION_DEPLOYING,
  type FlowPullRequest,
  type FlowReleaseRow,
  type GroupFlow,
  type GroupFlowAddress,
  type GroupFlowMate,
  type GroupFlowProduction,
  type GroupFlowStop,
} from "@t3tools/client-runtime/zerops";
import { UNREAD_ENVIRONMENT_LINE } from "@t3tools/client-runtime/zerops/hq";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";

import { domainFaceWords } from "../addresses/addresses.logic";
import type { ProductionChip } from "../SidebarProductionChip.logic";
import { MATE_DELETING_WORD } from "../ZeropsDeleteMateDialog.logic";
import {
  changeLineWords,
  changesInReview,
  type MateRowAskLine,
  type MateRowReply,
  type MateRowSecond,
  type MateRowView,
} from "../SidebarMateRow.logic";
import { NOT_IN_HQ_LINE } from "../ZeropsProjectRow.logic";
import { releaseOfLanding, type HistoryReleaseInput } from "./projectHistory.logic";

/** At most this many Mates stand on a card; past it the quiet ones fold. */
export const CARD_MATES_SHOWN = 4;

/** A place's dot: green running, amber failed, red down, blue releasing, hollow when none. */
export type PlaceDot = "running" | "failed" | "down" | "releasing" | "none" | "unknown";

/** One line at a card's foot: a place the code runs, by its name, in plain words, and its door. */
export interface PlaceLine {
  readonly git?: import("@t3tools/client-runtime/zerops").GitDelivery;
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
  /** A wait it is in, whose clock counts from here (wall ms). */
  readonly clock?: { readonly since: number } | undefined;
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

/** A release on its way, as production's line says it: a roll back by the release it goes back to. */
function releasingWords(tag: string, rollsBackTo: string | undefined): string {
  return rollsBackTo === undefined ? `Releasing ${tag}` : `Rolling back to ${rollsBackTo}`;
}

/**
 * What production's line opens while it says a release on its way: that release's review, or a
 * roll back's by the release it goes back to — the door the card's "Putting v2.4.0 live" block
 * had. Nothing while none is on its way, or while the line says production's trouble instead.
 */
export function releaseLineOpens(
  line: PlaceLine,
  production: GroupFlowProduction,
  rollsBackTo: string | undefined,
): { readonly kind: "release" } | { readonly kind: "rollback"; readonly tag: string } | undefined {
  if (line.kind !== "production" || line.dot !== "releasing" || production.kind !== "releasing")
    return undefined;
  return rollsBackTo === undefined ? { kind: "release" } : { kind: "rollback", tag: rollsBackTo };
}

/** What production's line says from its chip, the menu's reading of it. */
function chipLine(
  chip: ProductionChip,
  facts: {
    readonly since: string | undefined;
    readonly down: ReadonlyArray<string>;
    readonly rollsBackTo?: string | undefined;
  },
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
        words: [
          chip.next === undefined ? "Deploying…" : releasingWords(chip.next, facts.rollsBackTo),
        ],
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
  production: Exclude<GroupFlowProduction, { readonly kind: "absent" | "unread" }>,
  since: string | undefined,
  rollsBackTo: string | undefined,
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
    case "pushed":
      return { dot: "none", words: [production.line], trouble: false };
    case "deploying":
      return { dot: "releasing", words: ["Deploying…"], trouble: false };
    case "releasing":
      return {
        dot: "releasing",
        words: [releasingWords(production.tag, rollsBackTo)],
        trouble: false,
      };
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
      // A release offered does not make production run anything: a new one runs nothing until its
      // first release (the onboarding run read "Running" for a minute there).
      if (production.stop.state === "empty")
        return { dot: "none", words: ["Not released yet"], trouble: false };
      if (production.stop.state === "deploying")
        return { dot: "releasing", words: [PRODUCTION_DEPLOYING], trouble: false };
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
  /** It serves a port its public address would open; `undefined` while its services are unread. */
  offered: boolean | undefined,
): PlaceLine {
  const base = {
    projectId: stop.projectId,
    kind: "stage" as const,
    name: stop.name,
    addresses: stop.addresses,
  };
  if (stop.git !== undefined)
    return {
      ...base,
      git: stop.git,
      dot: stop.git.standing === "pushing" ? "releasing" : stop.git.blocked ? "failed" : "none",
      words: [stop.git.line],
      trouble: stop.git.blocked,
    };
  const told =
    chip !== undefined ? chipLine(chip, { since: undefined, down }) : flowStageLine(stop);
  // What it runs is named by a release's tag only: the branch it follows and a commit are no
  // version a person knows (the run's stage read "Running · main").
  const unnamed = [stop.source, stop.version?.branch, stop.version?.commit].filter(
    (word) => word !== undefined && word !== stop.version?.name,
  );
  const said = {
    ...told,
    words: told.words.filter((word) =>
      unnamed.every((name) => word !== name && word !== `still runs ${name}`),
    ),
  };
  // HQ brings a stage up until its first deploy's address is on (`EnvironmentBirth`): running
  // with nowhere to open is still coming up, as the menu's heading says (`stopComing`). HQ ends
  // its bringing up as that deploy ends, and the address comes in the platform's next read: one
  // it brought up that serves a port its address opens runs once that address is there, and one
  // serving none runs as it is.
  const turningOn = addressComing({
    birth: stop.birth,
    addresses: stop.addresses.length,
    offered,
  });
  if (said.dot === "running" && turningOn)
    return { ...base, dot: "unknown", words: ["Turning its address on…"], trouble: false };
  return { ...base, ...said };
}

/** A stage's line from the flow alone, where no chip was read. */
function flowStageLine(stop: GroupFlowStop): Pick<PlaceLine, "dot" | "words" | "trouble"> {
  switch (stop.state) {
    case "failed":
      return { dot: "failed", words: ["Deploy failed"], trouble: true };
    case "deploying":
      return { dot: "releasing", words: ["Deploying…"], trouble: false };
    case "empty":
      return { dot: "none", words: ["Not deployed yet"], trouble: false };
    case "checking":
      return {
        dot: "unknown",
        words: [stop.readLine ?? "Checking what runs…"],
        trouble: false,
      };
    case "deployed":
      return {
        dot: "running",
        words: ["Running", stop.version?.name].filter((word) => word !== undefined),
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
  readonly flow: Pick<GroupFlow, "production" | "stages"> &
    Partial<Pick<GroupFlow, "unreadStages">>;
  /** Production's chip as the menu reads it; `undefined` where none was read. */
  readonly chip?: ProductionChip | undefined;
  /** Each stage's own chip, by its project. */
  readonly stageChips?: ReadonlyMap<string, ProductionChip | undefined> | undefined;
  /** When production took what it runs. */
  readonly since?: string | undefined;
  /** The services the platform marks failed, by place. */
  readonly down?: ReadonlyMap<string, ReadonlyArray<string>> | undefined;
  /**
   * Whether each stage serves a port its public address would open (`derivePublicRouteOffers`),
   * by its project; absent while its services are unread.
   */
  readonly addressOffered?: ReadonlyMap<string, boolean> | undefined;
  /** The release on its way to production rolls it back to this one (`FlowRelease.rollbackOf`). */
  readonly rollsBackTo?: string | undefined;
  readonly nowMs: number;
}): ReadonlyArray<PlaceLine> {
  const { production, stages } = input.flow;
  const downOf = (projectId: string | undefined) =>
    (projectId === undefined ? undefined : input.down?.get(projectId)) ?? [];
  const staged: ReadonlyArray<PlaceLine> = [
    ...stages.map((stop) =>
      stageLine(
        stop,
        input.stageChips?.get(stop.projectId),
        downOf(stop.projectId),
        input.addressOffered?.get(stop.projectId),
      ),
    ),
    ...(input.flow.unreadStages ?? []).map((name): PlaceLine => ({
      kind: "stage",
      name,
      projectId: undefined,
      addresses: [],
      dot: "unknown",
      words: [UNREAD_ENVIRONMENT_LINE],
      trouble: false,
    })),
  ];
  const prod = { kind: "production" as const, name: "prod" };
  if (production.kind === "unread")
    return [
      ...staged,
      {
        ...prod,
        projectId: undefined,
        addresses: [],
        dot: "unknown",
        words: [production.line],
        trouble: false,
      },
    ];
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
  if (stop?.git !== undefined)
    return [
      ...staged,
      {
        ...prod,
        projectId: stop.projectId,
        addresses: [],
        git: stop.git,
        dot:
          stop.git.standing === "pushing"
            ? "releasing"
            : stop.git.blocked || stop.git.standing === "partly"
              ? "failed"
              : "none",
        words: [stop.git.line],
        trouble: stop.git.blocked || stop.git.standing === "partly",
      },
    ];
  const since = sinceWords(input.since, input.nowMs);
  const said =
    input.chip === undefined
      ? flowLine(production, since, input.rollsBackTo)
      : chipLine(input.chip, {
          since,
          down: downOf(stop?.projectId),
          rollsBackTo: input.rollsBackTo,
        });
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
  // The stage main feeds is the one whose deploys `readyLine` judges (`mainStageOf`): name it.
  const stage =
    flow.stages.find((stop) => stop.source === "main") ??
    flow.stages.find((stop) => stop.state === "deployed") ??
    flow.stages[0];
  return {
    count: production.candidate.waiting,
    atLeast: flow.main.notLiveAtLeast,
    stage: stage?.name,
    from: production.stop.version?.label,
    failed: production.kind === "deploy-failed",
  } satisfies CardReady;
}

/**
 * Whether production's panel offers its history: once production runs a release. Before, there is
 * no history to open, and a first release on its way gets it with the rest of its result — it came
 * 6 s into the run's first release and pushed the domain's door 72 px aside.
 */
export function historyOffered(input: {
  readonly releases: number;
  readonly runs: boolean;
}): boolean {
  return input.releases > 0 && input.runs;
}

/**
 * The tag of the release production runs: one that has landed. A release on its way (`inFlight`)
 * has not, even once production's services name its commit; a first release on its way names none
 * and a second keeps the first.
 */
export function releaseProductionRuns(
  releases: ReadonlyArray<Pick<PanelRelease, "tag" | "standing">>,
  inFlight: string | undefined,
): string | undefined {
  return releases.find((release) => release.standing === "live" && release.tag !== inFlight)?.tag;
}

/**
 * Whether there is something for *Put it live* to put live: the app's code merged, or a change of
 * it open that its one press merges. A Mate's setup files are no app.
 */
export function putLiveHasChange(flow: Pick<GroupFlow, "main" | "pullRequests">): boolean {
  return (
    flow.main.hasCode === true || flow.pullRequests.some((entry) => entry.pull.kind === "code")
  );
}

/** "3 changes ready to release", "1 change ready to release". */
export function readyTitle(ready: CardReady): string {
  const count = `${ready.atLeast ? "At least " : ""}${String(ready.count)}`;
  return `${count} change${ready.count === 1 ? "" : "s"} ready to release`;
}

/**
 * "On stage. Production runs v2.3.1." — where the changes are as the stage's deploys say, never
 * that anyone tried them there: nothing a release offers says a test ran on the stage.
 */
export function readyLine(
  ready: CardReady,
  /** The stage runs every change the release carries; `undefined` while that is unread. */
  onStage: boolean | undefined,
): string | undefined {
  const where =
    ready.stage === undefined || onStage === undefined
      ? "Merged."
      : onStage
        ? `On ${ready.stage}.`
        : `Not on ${ready.stage} yet.`;
  // Nothing released is production's own line ("Not released yet"), and merged is the title's:
  // with no stage there is nothing more to say (a stage's line keeps its place while it is read).
  if (!ready.failed && ready.from === undefined)
    return ready.stage === undefined ? undefined : where;
  const runs = ready.failed
    ? ready.from === undefined
      ? "Production's last release failed."
      : `Production's last release failed; it still runs ${ready.from}.`
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
  /** Review */
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
  /** How many of its changes wait for review, where several do: the lift says how many. */
  readonly reviews?: number | undefined;
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
  if (lift?.kind === "review")
    return {
      text: (input.reviews ?? 1) > 1 ? changesInReview(input.reviews ?? 1) : lift.pull.title,
      tone: "ink",
      lift,
    };
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
      return {
        text: second.task === undefined || text === undefined ? text : `${second.task} · ${text}`,
        tone,
      };
    }
    case "waits-on":
      return muted(second.text);
    case "paused":
      return muted(`Paused until ${input.pausedUntil(second.until)}`);
    case "change":
      return second.mine
        ? { text: changeLineWords(second), tone: "ink" }
        : muted(changeLineWords(second));
    case "task":
      return second.on ? { text: second.text, tone: "ink" } : muted(second.text);
    case "ask":
      if (askLine === undefined || askLine.kind === "sign-in") return muted(undefined);
      if (askLine.kind === "nothing-asked") return muted(NOTHING_ASKED_YET);
      if (askLine.kind === "draft") return muted(`Draft: ${askLine.text}`);
      return muted(askLine.by === undefined ? askLine.text : `${askLine.by}: ${askLine.text}`);
  }
}

/**
 * The changes of a Mate's that wait for review, by the rule the menu reads (`changeShowsReview`,
 * the flow's `review`): none while it works. An automated Mate holds one per task, several at once.
 */
export function mateChangesForReview(
  flow: Pick<GroupFlow, "pullRequests">,
  mateProjectId: string,
): ReadonlyArray<FlowPullRequest> {
  return flow.pullRequests
    .filter((entry) => entry.review && entry.pull.mateProjectId === mateProjectId)
    .map((entry) => entry.pull);
}

/** The first of a Mate's changes waiting for review (`mateChangesForReview`): its Review opens it. */
export function mateChangeForReview(
  flow: Pick<GroupFlow, "pullRequests">,
  mateProjectId: string,
): FlowPullRequest | undefined {
  return mateChangesForReview(flow, mateProjectId)[0];
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

/** A domain of a place's own not answering yet, and how far it is, in the addresses sheet's words. */
export interface PanelPendingDomain {
  readonly name: string;
  readonly word: string;
  /** Attention where it waits on the person or went wrong; muted while it is on its way. */
  readonly tone: "muted" | "attention";
}

/** A place's addresses on its panel, as the addresses sheet and the globe's popover read them. */
export interface PanelAddresses {
  /** The address that stands for the place: its own domain where one answers, else its sole service's. */
  readonly head: { readonly host: string; readonly url: string } | undefined;
  /** Several services serving: a door each, by its service, at its own domain where it has one. */
  readonly doors: ReadonlyArray<GroupFlowAddress>;
  readonly pending: ReadonlyArray<PanelPendingDomain>;
  /**
   * The card's door into the addresses sheet: only once the place runs something and its addresses
   * are read and it has one — before, there is nothing to put on a domain, and a door read early
   * would change its words once they are (the run: "Manage addresses", then "Put it on your domain").
   */
  readonly door: boolean;
  /** That door is production's "Put it on your domain": it has none of its own (`lacksOwnDomain`). */
  readonly offerDomain: boolean;
}

/**
 * What a place's panel says of its addresses. Read from the place's addresses (the sheet's
 * projection) once read; until then — or outside an account — as its listing says them. A service
 * answering at a domain of the place's own is opened there, its zerops.app address otherwise; the
 * place's own domain heads the panel wherever one answers.
 */
export function panelAddresses(input: {
  readonly kind: PlaceLine["kind"];
  /** The place's listed doors (`PlaceLine.addresses`). */
  readonly listed: ReadonlyArray<GroupFlowAddress>;
  /** The place's addresses as read; `undefined` outside an account. */
  readonly place: PlaceAddresses | undefined;
  /** Something runs there: a release on production, a deploy on a stage. */
  readonly runs: boolean;
}): PanelAddresses {
  const { place } = input;
  if (place?.state !== "ready") {
    const host = soleSite(input.listed);
    const first = input.listed[0];
    return {
      head: host === undefined || first === undefined ? undefined : { host, url: first.url },
      doors: input.listed.length < 2 ? [] : input.listed,
      pending: [],
      door: false,
      offerDomain: false,
    };
  }
  const live = place.domains.filter((domain) => domain.face === "live");
  // Each service's own domains before its zerops.app address, services by name as the popover lists them.
  const routes = [
    ...live.flatMap((domain) =>
      domain.targets.map((target) => ({ service: target.serviceName, url: domain.url, own: true })),
    ),
    ...place.zerops.flatMap((address) =>
      address.hosts.map((host) => ({ service: address.serviceName, url: host.url, own: false })),
    ),
  ].toSorted((left, right) => left.service.localeCompare(right.service, "en"));
  const doors = placeAddresses(routes);
  const own = routes.find((route) => route.own);
  const headUrl = own?.url ?? (doors.length === 1 ? doors[0]?.url : undefined);
  const host = siteOf(headUrl);
  const seen = new Set<string>();
  const door = input.runs && routes.length > 0;
  return {
    head: host === undefined || headUrl === undefined ? undefined : { host, url: headUrl },
    doors: doors.length < 2 ? [] : doors,
    pending: place.domains.flatMap((domain): ReadonlyArray<PanelPendingDomain> => {
      if (domain.face === "live" || seen.has(domain.domainName)) return [];
      seen.add(domain.domainName);
      const { word, tone } = domainFaceWords(domain.face);
      return [{ name: domain.domainName, word, tone: tone === "warn" ? "attention" : "muted" }];
    }),
    door,
    offerDomain: door && input.kind === "production" && lacksOwnDomain(place),
  };
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
  /**
   * "Ready to merge", what stops it; "In v1.0.4", "On stage", "Deploying to stage…", "Not released
   * yet", "Merged"; "Setup files, not part of a release" for a Mate's recipe proposal.
   */
  readonly words: string;
  /** Its words' tone: the change state's for an open one; quiet for a merged one. */
  readonly tone: NonNullable<ReturnType<typeof changeState>>["tone"];
  /** When it last moved: updated while open, merged once landed. */
  readonly at: string | undefined;
}

const newestFirst = (left: string | undefined, right: string | undefined) =>
  (right ?? "").localeCompare(left ?? "");

/**
 * What the stage that follows `main` runs, as HQ's deploys say it (`stageStandings`): the commits
 * its services run and the ones being deployed there, whole; and each repository's `main` head.
 */
export interface CardStage {
  readonly runs: ReadonlyArray<string>;
  readonly deploying: ReadonlyArray<string>;
  readonly mainHeads: ReadonlyMap<string, string>;
}

const sameSha = (left: string, right: string | undefined) =>
  right !== undefined && left.toLowerCase() === right.toLowerCase();

/**
 * Whether a stage commit `sha` holds the merged change `pull`: its repository's `main` head, or the
 * squash of a change of it merged at or after it — squashes land on `main` one after the other.
 */
function holds(
  sha: string,
  pull: FlowPullRequest,
  merged: ReadonlyArray<FlowPullRequest>,
  mainHeads: ReadonlyMap<string, string>,
): boolean {
  if (sameSha(sha, mainHeads.get(pull.repository))) return true;
  return merged.some(
    (other) =>
      other.repository === pull.repository &&
      sameSha(sha, other.mergeCommitSha) &&
      other.mergedAt !== undefined &&
      pull.mergedAt !== undefined &&
      other.mergedAt >= pull.mergedAt,
  );
}

/**
 * A card's latest changes (the owner, 2026-10-11: "quick history of latest PRs"): the open ones
 * first, each with what stops it, then the merged ones, each with where it went — in the oldest
 * release made after it landed, else on stage where the stage runs it, deploying to it where it is
 * being deployed there, else not released yet where production runs a release, else merged —
 * newest first, `limit` at most. While production runs no release at all its own line says so,
 * once (the onboarding run said "Not released yet" on production, the release and the change). A
 * Mate's recipe proposal is its setup files, which go to no place and no release (the onboarding
 * run read them "On stage" beside the reviewed change). Merged ones are known only while the
 * project's detail is read.
 */
export function cardChanges(input: {
  readonly open: ReadonlyArray<FlowPullRequest>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
  /** Newest first, as the flow lists them. */
  readonly releases: ReadonlyArray<HistoryReleaseInput>;
  /** What the stage a merged change goes to first runs; `undefined` where the project has none. */
  readonly stage: CardStage | undefined;
  /** The project has a production, where a merged change is released. */
  readonly production: boolean;
  readonly limit: number;
  /**
   * Only what no release put live yet: on the project's page its History says the released ones,
   * each in its release (`historyReleases`), so the card does not say them twice.
   */
  readonly unreleased?: boolean | undefined;
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
    .filter(
      (pull) =>
        pull.mergedAt !== undefined &&
        (input.unreleased !== true ||
          pull.kind === "recipe" ||
          releaseOfLanding(pull.mergedAt, input.releases) === undefined),
    )
    .toSorted((left, right) => newestFirst(left.mergedAt, right.mergedAt))
    .map((pull, _index, landed): CardChange => {
      const took = releaseOfLanding(pull.mergedAt, input.releases);
      const stage = input.stage;
      const on = (shas: ReadonlyArray<string> | undefined) =>
        stage !== undefined &&
        (shas ?? []).some((sha) => holds(sha, pull, landed, stage.mainHeads));
      return {
        pull,
        open: false,
        // Every change to the setup repository, as `broughtBy` leaves them out of a release.
        words:
          pull.kind === "recipe"
            ? "Setup files, not part of a release"
            : took !== undefined
              ? `In ${took.tag}`
              : on(stage?.runs)
                ? "On stage"
                : on(stage?.deploying)
                  ? "Deploying to stage…"
                  : input.production && input.releases.length > 0
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

/**
 * The changes the release production runs brought: the app's own, merged after the one before it
 * was made. The group's setup (its import files) is no change a release ships.
 */
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
      pull.kind === "code" &&
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
