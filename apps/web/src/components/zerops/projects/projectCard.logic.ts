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
  addressComing,
  changeAsksForReview,
  changeInMateReview,
  changeState,
  ENVIRONMENT_NOT_ADDED,
  PRODUCTION_DEPLOYING,
  pullRequestBlocked,
  type FlowPullRequest,
  type FlowReleaseRow,
  type GroupFlow,
  type GroupFlowAddress,
  type GroupFlowMate,
  type GroupFlowProduction,
  type GroupFlowStop,
  type RecipeReach,
} from "@t3tools/client-runtime/zerops";
import { UNREAD_ENVIRONMENT_LINE } from "@t3tools/client-runtime/zerops/hq";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";

import { environmentTitle } from "../place/place.logic";
import {
  PLACE_RUNNING_WORD,
  placeStateWord,
  type ProductionChip,
} from "../SidebarProductionChip.logic";
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
import {
  WAITING_VERBS,
  type WaitingChange,
  type WaitingItem,
  type WaitingMate,
  type WaitingRelease,
  type WaitingVerb,
} from "../SidebarWaiting.logic";
import {
  mergedChangeWords,
  openChangeWords,
  releaseIsLive,
  type MergedChangeWhere,
} from "../system/ChangeRow.logic";
import { releaseOfLanding, type HistoryReleaseInput } from "./projectHistory.logic";

/**
 * One thing in a project that waits on the viewer, beside its release: a Mate of theirs that asks
 * (a question, a plan, a run stopped on an error, its agent's sign-in), or its changes waiting for
 * their review.
 */
export type ProjectWait =
  | {
      readonly kind: "ask";
      readonly key: string;
      readonly ask: "question" | "plan" | "failed" | "sign-in";
      readonly mate: WaitingMate;
    }
  | {
      readonly kind: "review";
      readonly key: string;
      readonly mate: WaitingMate;
      /** The newest of its changes waiting, which *Review* opens. */
      readonly change: WaitingChange | undefined;
    };

/**
 * What waits on the viewer in one project, read off the one list (`useViewerWaits`) so the menu,
 * the overview card and the project page say the same: its Mates' asks first, the most urgent,
 * then their changes to review. Its release is `projectReleaseWait`: production's next release,
 * said where production is.
 */
export function projectWaits(input: {
  readonly items: ReadonlyArray<WaitingItem>;
  /** The project's flow: its Mates. */
  readonly flow: Pick<GroupFlow, "mates">;
}): ReadonlyArray<ProjectWait> {
  const mates = new Set(input.flow.mates.map((mate) => mate.projectId));
  const asks: Array<ProjectWait> = [];
  const reviews: Array<ProjectWait> = [];
  for (const item of input.items) {
    if (item.kind === "release" || !mates.has(item.mate.projectId)) continue;
    if (item.kind === "change")
      reviews.push({ kind: "review", key: item.key, mate: item.mate, change: item.mate.change });
    else asks.push({ kind: "ask", key: item.key, ask: item.kind, mate: item.mate });
  }
  return [...asks, ...reviews];
}

/** A project's release, where the one list says it waits on the viewer (`releaseOffered`). */
export function projectReleaseWait(
  items: ReadonlyArray<WaitingItem>,
  groupId: string,
): WaitingRelease | undefined {
  for (const item of items)
    if (item.kind === "release" && item.release.groupId === groupId) return item.release;
  return undefined;
}

/** A project wait as the one list's item, for its words (`waitingPhrase`, `WAITING_VERBS`). */
function waitingItemOf(wait: ProjectWait): WaitingItem {
  return wait.kind === "review"
    ? { kind: "change", key: wait.key, mate: wait.mate }
    : { kind: wait.ask, key: wait.key, mate: wait.mate };
}

/**
 * A wait in words, beside its verb: what waits, said from the Mate — "Juno asks: …", "Tess has a
 * plan for you to approve". The menu leads with the verb ("Answer Juno") because its rows carry no
 * button; here the button says it (`WAITING_VERBS`, the one table), so the line does not repeat it.
 */
export function projectWaitWords(wait: ProjectWait): {
  readonly text: string;
  readonly verb: WaitingVerb;
} {
  const item = waitingItemOf(wait);
  const { name, text } = wait.mate;
  const verb = WAITING_VERBS[item.kind];
  if (wait.kind === "review") {
    const count = wait.mate.changes ?? 1;
    return {
      text:
        count > 1
          ? `${String(count)} changes from ${name} to review`
          : wait.change === undefined
            ? `A change from ${name} to review`
            : `${name}'s change: ${wait.change.title}`,
      verb,
    };
  }
  switch (wait.ask) {
    case "question":
      return { text: text === undefined ? `${name} asks you` : `${name} asks: ${text}`, verb };
    case "plan":
      return { text: `${name} has a plan for you to approve`, verb };
    case "failed":
      return { text: `${name} stopped on an error`, verb };
    case "sign-in":
      return { text: `${name} waits for your sign-in`, verb };
  }
}

/** A wait's verb named for a screen reader: whose, and in which project. */
export function projectWaitLabel(wait: ProjectWait, project: string): string {
  const { name } = wait.mate;
  if (wait.kind === "review")
    return `Review ${name}'s ${(wait.mate.changes ?? 1) > 1 ? "changes" : "change"} in ${project}`;
  switch (wait.ask) {
    case "question":
      return `Answer ${name} in ${project}`;
    case "plan":
      return `See ${name}'s plan in ${project}`;
    case "failed":
      return `Ask ${name} to fix it in ${project}`;
    case "sign-in":
      return `Sign ${name} in, in ${project}`;
  }
}

/**
 * A broken place as what waits on the viewer: production down, its release or deploy failed — in
 * its own words, and the one verb: their Mate asked to fix it, or, with no Mate of theirs there,
 * the place's page, which says why.
 */
export function placeFixWords(
  line: Pick<PlaceLine, "kind" | "name" | "dot" | "words">,
  fixer: string | undefined,
  project: string,
): { readonly text: string; readonly verb: string; readonly label: string } {
  const place = placeLabel(line);
  const what = line.words[0];
  const text = line.dot === "down" || what === undefined ? `${place} is down` : `${place}: ${what}`;
  return fixer === undefined
    ? { text, verb: "See why", label: `See why in ${project}'s ${place.toLowerCase()}` }
    : {
        text,
        verb: `Ask ${fixer} to fix it`,
        label: `Ask ${fixer} to fix ${place.toLowerCase()} in ${project}`,
      };
}

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
  /**
   * It exists and nothing was deployed there yet, or it does not exist: its panel says its name and
   * its line alone — no services shown as up, no address doors (the live audit, 2026-10-28: an
   * empty production stood with green service dots and *Manage addresses*).
   */
  readonly nothingDeployed?: true | undefined;
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const CLOCK = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "since 10:42" today, "since Tue" this week, "since Sep 18" before; nothing for a bad date. */
/** How a place's since-when fact starts ("since Tue"): a compact place line leaves it out. */
export const SINCE_WORD = "since";

export function sinceWords(at: string | undefined, nowMs: number): string | undefined {
  if (at === undefined) return undefined;
  const then = Date.parse(at);
  if (Number.isNaN(then)) return undefined;
  const day = new Date(then);
  const today = new Date(nowMs);
  if (day.toDateString() === today.toDateString()) return `${SINCE_WORD} ${CLOCK.format(day)}`;
  const days = (nowMs - then) / 86_400_000;
  if (days >= 0 && days < 6) return `${SINCE_WORD} ${WEEKDAY.format(day)}`;
  return `${SINCE_WORD} ${DAY.format(day)}`;
}

const joined = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

/** A release on its way, as production's line says it: a roll back by the release it goes back to. */
function releasingWords(tag: string, rollsBackTo: string | undefined): string {
  return rollsBackTo === undefined ? `Releasing ${tag}` : `Rolling back to ${rollsBackTo}`;
}

/** What production's line says from its chip, the menu's reading of it. */
function chipLine(
  chip: ProductionChip,
  facts: {
    readonly since: string | undefined;
    readonly down: ReadonlyArray<string>;
    readonly rollsBackTo?: string | undefined;
  },
): PlaceLineSaid {
  const runs = chip.version;
  const word = placeStateWord(chip.label, chip.state);
  switch (chip.state) {
    case "ok":
    case "waiting":
      return {
        dot: "running",
        words: [word, runs, facts.since].filter((each) => each !== undefined),
        trouble: false,
      };
    case "unverified":
      return { dot: "unknown", words: [chip.readLine ?? word], trouble: false };
    case "releasing":
      return {
        dot: "releasing",
        words: [chip.next === undefined ? word : releasingWords(chip.next, facts.rollsBackTo)],
        trouble: false,
      };
    case "failed":
      return {
        dot: "failed",
        words: [word, ...(runs === undefined ? [] : [`still runs ${runs}`])],
        trouble: true,
      };
    case "down":
      return {
        dot: "down",
        words: [
          word,
          facts.down.length === 0 ? "its services failed" : `${joined(facts.down)} failed`,
        ],
        trouble: true,
      };
    case "stopped":
      return { dot: "none", words: [word], trouble: false };
    case "creating":
      return { dot: "unknown", words: [word], trouble: false };
    case "empty":
      return { dot: "none", words: [word], trouble: false, nothingDeployed: true };
  }
}

/** What a place's line says of it, before its name and its doors. */
type PlaceLineSaid = Pick<PlaceLine, "dot" | "words" | "trouble" | "nothingDeployed">;

/** What production's line says from the flow alone, where no chip was read. */
function flowLine(
  production: Exclude<GroupFlowProduction, { readonly kind: "absent" | "unread" }>,
  since: string | undefined,
  rollsBackTo: string | undefined,
): PlaceLineSaid {
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
      return {
        dot: "none",
        words: [placeStateWord("prod", "empty")],
        trouble: false,
        nothingDeployed: true,
      };
    case "pushed":
      return { dot: "none", words: [production.line], trouble: false };
    case "deploying":
      return { dot: "releasing", words: [placeStateWord("prod", "releasing")], trouble: false };
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
        words: [
          placeStateWord("prod", "failed"),
          ...(runs === undefined ? [] : [`still runs ${runs}`]),
        ],
        trouble: true,
      };
    }
    case "live":
    case "ready-to-release":
      // A release offered does not make production run anything: a new one runs nothing until its
      // first release (the onboarding run read "Running" for a minute there).
      if (production.stop.state === "empty")
        return {
          dot: "none",
          words: [placeStateWord("prod", "empty")],
          trouble: false,
          nothingDeployed: true,
        };
      if (production.stop.state === "deploying")
        return { dot: "releasing", words: [PRODUCTION_DEPLOYING], trouble: false };
      return {
        dot: "running",
        words: [PLACE_RUNNING_WORD, production.stop.version?.label, since].filter(
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
  /** Its public-access projection holds a pending publication; `undefined` while unread. */
  pending: boolean | undefined,
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
  const turningOn = addressComing({
    addresses: stop.addresses.length,
    pending,
  });
  if (said.dot === "running" && turningOn)
    return { ...base, dot: "unknown", words: ["Turning its address on…"], trouble: false };
  if (said.dot === "running" && pending === false && stop.addresses.length === 0)
    return { ...base, ...said, words: ["No public address yet"] };
  return { ...base, ...said };
}

/** A stage's line from the flow alone, where no chip was read. */
function flowStageLine(stop: GroupFlowStop): PlaceLineSaid {
  switch (stop.state) {
    case "failed":
      return { dot: "failed", words: [placeStateWord("stage", "failed")], trouble: true };
    case "deploying":
      return { dot: "releasing", words: [placeStateWord("stage", "releasing")], trouble: false };
    case "empty":
      return {
        dot: "none",
        words: [placeStateWord("stage", "empty")],
        trouble: false,
        nothingDeployed: true,
      };
    case "checking":
      return {
        dot: "unknown",
        words: [stop.readLine ?? placeStateWord("stage", "unverified")],
        trouble: false,
      };
    case "deployed":
      return {
        dot: "running",
        words: [PLACE_RUNNING_WORD, stop.version?.name].filter((word) => word !== undefined),
        trouble: false,
      };
  }
}

/**
 * A card's places in the order the code travels: every stage by its name, then production — each
 * how it is and where it is (the owner, 2026-10-11: the overview showed production alone, and
 * everything else was a click or more away). Production is always said — "Not added" where there
 * is none, "Not released yet" where nothing runs in it — so every card ends on it.
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
   * Whether each stage has a publication in progress (`publicAccess.pending`),
   * by its project; absent while public access is unread.
   */
  readonly addressPending?: ReadonlyMap<string, boolean> | undefined;
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
        input.addressPending?.get(stop.projectId),
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
        words: [ENVIRONMENT_NOT_ADDED],
        trouble: false,
        nothingDeployed: true,
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
  return environmentTitle(line.kind, line.name);
}

/** The release a card offers: how many changes, where they were tested, what production runs. */
export interface CardReady {
  readonly changeCount?: number | undefined;
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
    ...(flow.main.changeCount === undefined ? {} : { changeCount: flow.main.changeCount }),
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
 * The platform's build as the card's chip reads it: only where the card's flow says production
 * deploys, so the chip's Releasing and the ready block's leaving are one answer, never a frame apart.
 */
export function productionBuilding<Building>(
  kind: GroupFlowProduction["kind"],
  building: Building | undefined,
): Building | undefined {
  return kind === "deploying" ? building : undefined;
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
 * Its code only (`changeInMateReview`): its recipe change is the project's setup, which the card
 * asks for once (`cardChanges`).
 */
export function mateChangesForReview(
  flow: Pick<GroupFlow, "pullRequests">,
  mateProjectId: string,
): ReadonlyArray<FlowPullRequest> {
  return flow.pullRequests
    .filter(
      (entry) =>
        entry.review &&
        entry.pull.mateProjectId === mateProjectId &&
        changeInMateReview(entry.pull),
    )
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
  /** Where a merged one went, which its `words` say (`mergedChangeWords`). */
  readonly where?: MergedChangeWhere | undefined;
  /**
   * A setup change waiting for a person: its row reads what it does from its review
   * (`setupChangeWords`), its `words` until then.
   */
  readonly setup?: true;
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
 * A recipe change that waits for a person: nothing stops its merge, so Core held it — its merge
 * would change an environment built from the recipe. Its Mate's Review leaves it out
 * (`changeInMateReview`); the project's card asks for it, here, once.
 */
function setupChangeWaits(pull: FlowPullRequest): boolean {
  return (
    pull.kind === "recipe" &&
    pull.mateGone !== true &&
    changeAsksForReview(pull) &&
    pullRequestBlocked(pull) === null
  );
}

/**
 * What a waiting setup change does, by what its review reads of it (`recipeReach`, from the files
 * HQ recorded): "Changes how Stage is built". Never guessed from which environments exist: until its
 * files are read, or where it changes none of them, it changes the project's setup.
 */
export function setupChangeWords(reach: RecipeReach | undefined): string {
  const stages = reach?.stages ?? 0;
  if (stages > 0 && reach?.production === true)
    return stages > 1
      ? "Changes how the stages and Production are built"
      : "Changes how Stage and Production are built";
  if (stages > 0)
    return stages > 1 ? "Changes how the stages are built" : "Changes how Stage is built";
  if (reach?.production === true) return "Changes how Production is built";
  return "Changes the project's setup";
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
      const state = openChangeWords(pull);
      return {
        pull,
        open: true,
        words: setupChangeWaits(pull) ? setupChangeWords(undefined) : state.words,
        tone: state.tone,
        at: pull.updatedAt,
        ...(setupChangeWaits(pull) ? { setup: true as const } : {}),
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
      // Every change to the setup repository, as `broughtBy` leaves them out of a release.
      const where: MergedChangeWhere =
        pull.kind === "recipe"
          ? { kind: "setup" }
          : took !== undefined
            ? { kind: "released", tag: took.tag, live: releaseIsLive(took.tag, input.releases) }
            : on(stage?.runs)
              ? { kind: "on-stage" }
              : on(stage?.deploying)
                ? { kind: "deploying-to-stage" }
                : input.production && input.releases.length > 0
                  ? { kind: "waits-for-production" }
                  : { kind: "merged" };
      return {
        pull,
        open: false,
        words: mergedChangeWords(where),
        tone: "off",
        at: pull.mergedAt,
        where,
      };
    });
  return [...open, ...merged].slice(0, input.limit);
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
