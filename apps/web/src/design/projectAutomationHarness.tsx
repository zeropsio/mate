/**
 * A project's Board where the project is: the whole Board (the pool of its automated Mates, every
 * lane and its sources of tasks) as an Owner or Admin sets it up and as anyone else reads it; the
 * project page's short Board; the Board's own page with a task's panel open on each kind of task;
 * a source's form in its compact dialog, and a task's card as its chain in every state it moves
 * through.
 *
 * Served by the dev server at `/design-project-automation.html` (`?theme=dark`; `?state=<name>`
 * draws one of the states alone — a `page-…` state the Board's page beside a stand-in of the menu,
 * at its 435 px — `?width=871` at the page's main column instead of 700;
 * `?dialog=github|slack|discord|webhook|schedule` opens that source's form; `?merging=all`, or
 * one state's name, draws who can merge instead: `projectMergingFixtures.tsx`). Open it at the
 * owner's 1786 × 1000. The change's page with its pull request is `/design-change.html?review=page-pr`.
 *
 * Fixtures only. Nothing here ships — `design-project-automation.html` is not `index.html`, and no
 * route imports this module.
 */
import type { AppIntakeRead, TaskSourceSettingValue } from "@t3tools/client-runtime/data";
import { STRANDED_TAKE_WORDS } from "@t3tools/client-runtime/zerops";
import type { MateTaskSource } from "@t3tools/contracts";
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { MateTaskCardView, MateTaskStatusView } from "~/components/zerops/MateTaskCard";
import {
  ProjectAutomationView,
  SourceDialog,
  type AutomationControls,
  type PoolMate,
} from "~/components/zerops/projectAutomation/ProjectAutomation";
import type { BoardVerbs, BoardView } from "~/components/zerops/projectAutomation/boardView";
import { BoardPageView } from "~/components/zerops/projectAutomation/BoardPage";
import { Crumbs } from "~/components/zerops/system";
import { Page } from "~/components/ui/page";
import { boardOf, type BoardContext } from "~/components/zerops/projectAutomation/taskBoard.logic";
import { NewBoardTaskView } from "~/components/zerops/projectAutomation/NewBoardTask";
import { boardTaskOffer, type BoardTaskOffer } from "@t3tools/client-runtime/data";
import { boardTaskOf, type HqAppTask } from "@t3tools/shared/hqIntake";
import type { BoardMate, PermissionFacts } from "@t3tools/shared/zeropsPermissions";
import {
  connectionMissing,
  sourceRows,
  type SourceKind,
} from "~/components/zerops/projectAutomation/projectAutomation.logic";
import {
  AppChannelView,
  AppIntakeView,
  AppSchedulesView,
  AppWebhooksView,
} from "~/components/zerops/projectAutomation/sourceForms";

import type { TaskSession } from "~/zerops/taskSession.logic";
import type { BoardFace } from "~/zerops/useBoardTasks";
import { MergingHarness } from "./projectMergingFixtures";
import "../index.css";
import { Card } from "~/components/ui/card";
import { PAGE_GROUP } from "~/components/zerops/project/pageLayout";
import { SectionHeader } from "~/components/ui/section";

const params = new URLSearchParams(location.search);
const DIALOG = params.get("dialog") as SourceKind | null;
const MERGING = params.get("merging");
const STATE = params.get("state");
/** The section's width: the page's main column at the reference viewport is 871 px. */
const COLUMNS =
  params.get("width") === "871"
    ? "grid grid-cols-[minmax(0,871px)_minmax(0,1fr)] gap-10 bg-background p-8 text-foreground"
    : "grid grid-cols-[minmax(0,700px)_minmax(0,1fr)] gap-10 bg-background p-8 text-foreground";
const nothing = () => {};

const known = <T,>(held: T) => ({ state: "known", held, stale: false }) as const;
function controls(setting: unknown) {
  return {
    read: { setting, action: { kind: "idle" }, revealed: null } as TaskSourceSettingValue<never>,
    write: nothing,
    again: nothing,
  };
}

const ADMIN: AutomationControls = {
  onAddMate: nothing,
  sources: {
    onTakeFrom: nothing,
    onEdit: nothing,
    onReadAgain: nothing,
    onOpenSettings: nothing,
  },
};

/** A made-up plant shop and its four automated Mates. */
const SHOP = "fernhill/plant-shop";
const FREE = { task: null } as const;
const SOL: PoolMate = {
  projectId: "p-sol",
  name: "Sol",
  tint: "amber",
  shape: "pentagon",
  automation: FREE,
};
const PIM: PoolMate = {
  projectId: "p-pim",
  name: "Pim",
  tint: "olive",
  shape: "clover",
  automation: FREE,
};
const WREN: PoolMate = {
  projectId: "p-wren",
  name: "Wren",
  tint: "sky",
  shape: "pick",
  automation: FREE,
};
const BO: PoolMate = {
  projectId: "p-bo",
  name: "Bo",
  tint: "slate",
  shape: "squircle",
  automation: FREE,
};
const on = (mate: PoolMate, title: string, waiting = false): PoolMate => ({
  ...mate,
  automation: { task: waiting ? { title, waiting: true } : { title } },
});

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const HOUR = 60;
const DAY = 24 * HOUR;
const by = (mate: PoolMate) => ({ projectId: mate.projectId, name: mate.name });
const task = (
  patch: Partial<HqAppTask> & Pick<HqAppTask, "id" | "title" | "state">,
): HqAppTask => ({
  label: `${SHOP}#${patch.id}`,
  url: `https://github.com/${SHOP}/issues/${patch.id}`,
  mate: null,
  requestedBy: "mara",
  createdAt: ago(3 * HOUR),
  startedAt: null,
  endedAt: null,
  spentUsd: null,
  workedMs: null,
  detail: null,
  change: null,
  pullRequest: null,
  link: `https://mate.zerops.io/env-1/conversation-${patch.id}`,
  ...patch,
});
/** A task that ended: whose, how, how long ago, its cost, and its pull request where it has one. */
const ended = (
  id: string,
  title: string,
  mate: PoolMate,
  state: HqAppTask["state"],
  minutes: number,
  spentUsd: number,
  more: Partial<HqAppTask> = {},
): HqAppTask =>
  task({
    id,
    title,
    state,
    mate: by(mate),
    // Put on the Board an hour and a half before it ended, handed to its Mate an hour before.
    createdAt: ago(minutes + 90),
    startedAt: ago(minutes + 60),
    endedAt: ago(minutes),
    spentUsd,
    ...more,
  });
const pr = (number: number) => ({
  change: { repo: "shop", number },
  pullRequest: { number, url: `https://github.com/${SHOP}/pull/${String(number)}` },
});

const SORT = ended("38", "Sort plants by light needs", PIM, "merged", 4 * HOUR, 0.31, pr(38));
const PRICE = ended("40", "Show each plant’s price per pot size", WREN, "done", 5 * HOUR, 0.27, {
  change: { repo: "shop", number: 40 },
});
const GUIDES = ended("37", "Translate the care guides", SOL, "closed", 11 * HOUR, 0.66, {
  change: { repo: "shop", number: 37 },
});
const CATALOGUE = ended("39", "Import the autumn catalogue", SOL, "failed", DAY, 2.02, {
  detail: "The catalogue file was not in the repository.",
});
const RENAME = ended("34", "Rename the care page", PIM, "stopped", 2 * DAY, 0.04, {
  detail: "Mara stopped it.",
});
const IMAGES = ended(
  "36",
  "Fix the watering guide’s broken images",
  PIM,
  "merged",
  2 * DAY,
  0.48,
  pr(36),
);
/** Fourteen that ended: what HQ answers of a project that has worked a while. */
const FOURTEEN: ReadonlyArray<HqAppTask> = [
  SORT,
  PRICE,
  GUIDES,
  CATALOGUE,
  IMAGES,
  RENAME,
  ended("35", "Add a low-stock badge", WREN, "merged", 3 * DAY, 0.35, pr(35)),
  ended("33", "Show pot sizes in centimetres", SOL, "merged", 3 * DAY, 0.22, pr(33)),
  ended("30", "Remember the last delivery address", PIM, "merged", 5 * DAY, 0.57, pr(30)),
  ended("29", "Fix the footer links on phones", WREN, "merged", 6 * DAY, 0.19, pr(29)),
  ended("28", "Add care reminders by email", BO, "closed", 6 * DAY, 0.91, {
    change: { repo: "shop", number: 28 },
  }),
  ended("27", "Group plants by room", SOL, "merged", 8 * DAY, 0.44, pr(27)),
  ended("26", "Update the delivery prices", PIM, "merged", 9 * DAY, 0.12, pr(26)),
  ended("24", "Cache the plant photos", BO, "merged", 10 * DAY, 1.12, pr(24)),
];

const DATES = task({
  brief:
    "Show the delivery date for each item in the cart, from the supplier's lead time.\n\nIt's done when the cart lists a date under every item and the checkout summary shows the latest one.",
  id: "42",
  title: "Show delivery dates in the cart",
  state: "working",
  mate: by(SOL),
  startedAt: ago(14),
  spentUsd: 0.42,
  workedMs: 12 * 60_000,
});
const ROUNDING = task({
  id: "43",
  title: "Round the cart total the same way everywhere",
  label: "#shop-requests on Slack",
  url: null,
  state: "waiting",
  detail: "Should the cart round each line, or only the total?",
  mate: by(PIM),
  startedAt: ago(20),
  spentUsd: 1.08,
  workedMs: 10 * 60_000,
});
const SEARCH = task({
  id: "31",
  title: "Speed up the plant search",
  state: "working",
  mate: by(BO),
  startedAt: ago(40),
  spentUsd: 0.96,
  workedMs: 31 * 60_000,
});
const QUEUE: ReadonlyArray<HqAppTask> = [
  task({
    id: "44",
    title: "Add gift notes at checkout",
    state: "queued",
    position: 1,
    createdAt: ago(4),
    link: null,
  }),
  task({
    id: "45",
    title: "Weekly dependency update",
    label: "Schedule",
    url: null,
    state: "queued",
    position: 2,
    createdAt: ago(1),
    link: null,
  }),
];
/** What navigation says of the tasks the pool is on: Pim's asks the person. */
const LIVE = new Map([
  ["43", { id: "43", title: ROUNDING.title, url: null, waiting: true as const }],
]);

/** The reader: an Owner of the organization, signed in as Mara, whose own Mates are Lark and Quill. */
const ME = "u-mara";
const RHEA = "u-rhea";
const PEOPLE: Readonly<Record<string, string>> = { [ME]: "Mara", [RHEA]: "Rhea", "u-ivo": "Ivo" };
const OWN_MATES: Readonly<Record<string, BoardFace>> = {
  "p-lark": { name: "Lark", tint: "violet", shape: "gem" },
  "p-quill": { name: "Quill", tint: "coral", shape: "flower" },
  "p-moss": { name: "Moss", tint: "rose", shape: "seal" },
};
const POOL_FACES = new Map([SOL, PIM, WREN, BO].map((mate) => [mate.projectId, mate] as const));
const faceOf = (projectId: string): BoardFace | undefined =>
  OWN_MATES[projectId] ?? POOL_FACES.get(projectId);
/**
 * Whose each Mate is, for Take: Mara's two (Quill on a server that reads no task put on the Board
 * directly), Rhea's one, and the pool.
 */
const MATES: ReadonlyArray<BoardMate> = [
  { projectId: "p-lark", ownerUserId: ME, automated: false, boardProtocol: 2 },
  { projectId: "p-quill", ownerUserId: ME, automated: false, boardProtocol: 1 },
  { projectId: "p-moss", ownerUserId: RHEA, automated: false, boardProtocol: 2 },
  ...[SOL, PIM, WREN, BO].map((mate) => ({
    projectId: mate.projectId,
    ownerUserId: undefined,
    automated: true,
    boardProtocol: 2,
  })),
];
const facts = (roleCode: string): PermissionFacts => ({
  member: { userId: ME, roleCode, canCreateProjects: true },
  project: () => ({}),
});
/** Each task's verbs as the rules offer them to Mara in `roleCode`, her Mates `mates`. */
function offers(
  tasks: ReadonlyArray<HqAppTask>,
  roleCode: string,
  mates: ReadonlyArray<BoardMate> = MATES,
) {
  const byId = new Map(tasks.map((each) => [each.id, boardTaskOf(each)] as const));
  const who = facts(roleCode);
  return (taskId: string): BoardTaskOffer | undefined => {
    const board = byId.get(taskId);
    return board === undefined ? undefined : boardTaskOffer(who, board, mates);
  };
}
const VERBS: BoardVerbs = {
  offerOf: () => undefined,
  mateName: (projectId) => OWN_MATES[projectId]?.name ?? "Your Mate",
  pressOf: () => ({ kind: "idle" }),
  strandedOf: () => false,
  onOpenTaken: nothing,
  onAsk: nothing,
  onKeep: nothing,
  onStop: nothing,
  onTake: nothing,
  onRelease: nothing,
  onDone: nothing,
  answerOf: () => ({ kind: "idle" }),
  onAnswer: nothing,
  onDropNeed: nothing,
};
function board(
  tasks: ReadonlyArray<HqAppTask>,
  spend: string,
  more: {
    readonly pressOf?: BoardVerbs["pressOf"];
    readonly live?: BoardContext["live"];
    readonly held?: BoardContext["held"];
    /** Mara's role in the organization: what the rules offer her. */
    readonly role?: string;
    /** The application's Mates, whose each and what its server reads: where Mara's Take opens. */
    readonly mates?: ReadonlyArray<BoardMate>;
    /** Tasks Mara took whose conversation did not open. */
    readonly stranded?: ReadonlyArray<string>;
  } = {},
): BoardView {
  return {
    read: {
      state: "known",
      board: boardOf(tasks, NOW, {
        appId: "plant-shop",
        live: more.live ?? LIVE,
        ...(more.held === undefined ? {} : { held: more.held }),
        viewerId: ME,
        personName: (userId) => PEOPLE[userId],
        mateName: (projectId) => OWN_MATES[projectId]?.name,
      }),
    },
    spend: `${spend} this month`,
    onReadAgain: nothing,
    onOpen: nothing,
    onOpenConversation: nothing,
    faceOf,
    verbs: {
      ...VERBS,
      offerOf: offers(tasks, more.role ?? "OWNER", more.mates),
      pressOf: more.pressOf ?? VERBS.pressOf,
      strandedOf: (taskId) => more.stranded?.includes(taskId) === true,
    },
  };
}

/** Tasks people put on the Board from their conversations, and took for their own Mates. */
const putFrom = (putBy: string, mateProjectId: string, title: string) => ({
  label: "a conversation",
  url: null,
  source: {
    kind: "conversation" as const,
    putBy,
    mateProjectId,
    conversationId: `c-${mateProjectId}`,
    title,
  },
});
const GIFT_WRAP = task({
  brief:
    "Let a shopper add gift wrapping to any plant at checkout, for a flat fee of $4.\n\nIt's done when the option shows under each plant in the cart, the fee is in the order total, and the packing slip marks wrapped plants.",
  id: "50",
  title: "Offer gift wrapping at checkout",
  state: "queued",
  position: 1,
  createdAt: ago(25),
  link: null,
  ...putFrom(RHEA, "p-moss", "Offer gift wrapping at checkout"),
  taker: null,
});
const REPOT = task({
  brief: "Every plant page gets a short repotting guide: when, which pot size up, and which soil.",
  id: "51",
  title: "Add a repotting guide to every plant page",
  state: "taken",
  createdAt: ago(3 * DAY),
  link: null,
  ...putFrom(RHEA, "p-moss", "Add a repotting guide to every plant page"),
  taker: { kind: "person", userId: ME, mateProjectId: "p-lark" },
  takenAt: ago(2 * HOUR),
});
const STALE = task({
  id: "52",
  title: "Move the newsletter sign-up to the footer",
  state: "taken",
  createdAt: ago(9 * DAY),
  link: null,
  ...putFrom(ME, "p-quill", "Move the newsletter sign-up to the footer"),
  taker: { kind: "person", userId: RHEA, mateProjectId: "p-moss" },
  takenAt: ago(6 * DAY),
});
const FERTILISER = task({
  brief:
    "Add a line to each plant page saying which fertiliser suits it and how often, from the care sheet.",
  id: "53",
  title: "Explain which fertiliser suits each plant",
  state: "waiting",
  mate: by(WREN),
  startedAt: ago(30),
  spentUsd: 0.64,
  workedMs: 18 * 60_000,
  detail: "Should I name brands, or only the kind of fertiliser?",
  ...putFrom(ME, "p-lark", "Explain which fertiliser suits each plant"),
  taker: { kind: "pool", mateProjectId: WREN.projectId },
});
const WISHLIST = task({
  id: "54",
  title: "Let people keep a wishlist",
  state: "taken",
  createdAt: ago(4 * DAY),
  link: null,
  ...putFrom(ME, "p-quill", "Let people keep a wishlist"),
  taker: { kind: "person", userId: ME, mateProjectId: "p-quill" },
  takenAt: ago(DAY),
  changes: [{ repo: "shop", number: 47 }],
});
/** Tasks people put on the Board itself (New task): who put them, and no conversation behind. */
const putOnBoard = (putBy: string, title: string) => ({
  label: "the Board",
  url: null,
  requestedBy: null,
  source: { kind: "board" as const, putBy, title },
});
const LABELS = task({
  id: "60",
  title: "Print care labels for every pot",
  state: "queued",
  position: 1,
  createdAt: ago(6),
  link: null,
  ...putOnBoard(RHEA, "Print care labels for every pot"),
  taker: null,
});
const PICKUP = task({
  brief:
    "Let a shopper choose pick-up at the greenhouse at checkout, with no delivery fee.\n\nIt's done when the choice shows under the delivery options, the order confirmation names the greenhouse's address and opening hours, and the order export marks pick-up orders.",
  id: "61",
  title: "Let people pick their order up at the greenhouse",
  state: "waiting",
  mate: by(SOL),
  startedAt: ago(26),
  spentUsd: 0.38,
  workedMs: 9 * 60_000,
  detail: "Should pick-up orders be paid at checkout, or at the greenhouse?",
  history: [
    {
      kind: "asked",
      at: ago(20),
      question:
        "The greenhouse has two addresses in the shop's settings, the old one on Mill Lane and the new one on the ring road: which one should the confirmation name?",
    },
    { kind: "answered", at: ago(18) },
    {
      kind: "asked",
      at: ago(4),
      question: "Should pick-up orders be paid at checkout, or at the greenhouse?",
    },
  ],
  ...putOnBoard(ME, "Let people pick their order up at the greenhouse"),
  taker: { kind: "pool", mateProjectId: SOL.projectId },
});
const RETURNS = task({
  id: "62",
  title: "Explain the returns policy on the checkout page",
  state: "taken",
  createdAt: ago(2 * DAY),
  link: null,
  ...putOnBoard(ME, "Explain the returns policy on the checkout page"),
  taker: { kind: "person", userId: RHEA, mateProjectId: "p-moss" },
  takenAt: ago(5 * HOUR),
});
/** A Board holding tasks put on it directly beside one put from a conversation. */
const DIRECT_TASKS: ReadonlyArray<HqAppTask> = [
  LABELS,
  { ...GIFT_WRAP, position: 2 },
  RETURNS,
  PICKUP,
  PRICE,
];
const DIRECT_LIVE = new Map([
  ["61", { id: "61", title: PICKUP.title, url: null, waiting: true as const }],
]);

/** The whole Board: a task in every lane, put from conversations and taken by people. */
const BOARD_TASKS: ReadonlyArray<HqAppTask> = [
  GIFT_WRAP,
  ...QUEUE.map((each) => ({ ...each, position: (each.position ?? 0) + 1 })),
  REPOT,
  STALE,
  DATES,
  FERTILISER,
  ROUNDING,
  WISHLIST,
  PRICE,
  SORT,
  CATALOGUE,
  GUIDES,
];
const BOARD_LIVE = new Map([
  ...LIVE,
  ["53", { id: "53", title: FERTILISER.title, url: null, waiting: true as const }],
]);

/**
 * A plan Mara put from Lark's chat, in the order it goes: gift cards modelled first (at work), then
 * sold and emailed (each held on what comes before); beside it a task whose need broke (the card
 * balances it needed were stopped) and one whose need was met (queued since its need merged).
 */
const CARDS = task({
  brief: "Store gift cards with a code, an amount and a balance.",
  id: "60",
  title: "Model gift cards in the database",
  state: "working",
  mate: by(SOL),
  startedAt: ago(25),
  spentUsd: 0.31,
  workedMs: 9 * 60_000,
  ...putFrom(ME, "p-lark", "Model gift cards in the database"),
  taker: { kind: "pool", mateProjectId: SOL.projectId },
});
const SELL = task({
  id: "61",
  title: "Sell gift cards at checkout",
  state: "held",
  createdAt: ago(30),
  link: null,
  ...putFrom(ME, "p-lark", "Sell gift cards at checkout"),
  taker: null,
  needs: [{ taskId: CARDS.id, state: "waiting" }],
});
const EMAIL = task({
  brief: "Email each gift card to the address the buyer gives, with the card's code and amount.",
  id: "62",
  title: "Email each gift card to its recipient",
  state: "held",
  createdAt: ago(30),
  link: null,
  ...putFrom(ME, "p-lark", "Email each gift card to its recipient"),
  taker: null,
  needs: [
    { taskId: CARDS.id, state: "waiting" },
    { taskId: SELL.id, state: "waiting" },
  ],
});
const BALANCES = ended("58", "Store each card's balance", BO, "stopped", 2 * HOUR, 0.27, {});
const REDEEM = task({
  brief: "Let a shopper pay with a gift card's code at checkout, down to its balance.",
  id: "63",
  title: "Redeem a gift card at checkout",
  state: "held",
  createdAt: ago(3 * HOUR),
  link: null,
  ...putFrom(ME, "p-quill", "Redeem a gift card at checkout"),
  taker: null,
  needs: [{ taskId: BALANCES.id, state: "broken" }],
});
const TAGS = ended("57", "Tag plants by light they need", WREN, "merged", HOUR, 0.4, pr(57));
const FILTER = task({
  id: "64",
  title: "Filter plants by light",
  state: "queued",
  position: 1,
  createdAt: ago(2 * HOUR),
  link: null,
  ...putFrom(RHEA, "p-moss", "Filter plants by light"),
  taker: null,
  needs: [{ taskId: TAGS.id, state: "met" }],
});
/** The Board with needs: held, broken and ready, the tasks they wait on among them. */
const NEEDS_TASKS: ReadonlyArray<HqAppTask> = [FILTER, SELL, EMAIL, CARDS, REDEEM, TAGS, BALANCES];

const SCHEDULE = {
  id: "s1",
  name: "Weekly dependency update",
  brief: "Update the dependencies, check the build, and open a change.",
  rule: { every: "week" as const, day: 1, at: "09:00", timeZone: "Europe/Prague" },
  nextAt: "2026-10-19T07:00:00.000Z",
};
const NO_SOURCES = { rows: [], reading: false, withheld: false } as const;
const SOURCES = (waiting: number) =>
  sourceRows({
    intake: { repo: SHOP, label: "mate", waiting },
    slack: known({ channel: { appId: "plant-shop", channelId: "C042", channel: "shop-requests" } }),
    discord: known({ channel: null }),
    webhooks: known([]),
    schedules: known([]),
    slackConnected: true,
    discordConnected: true,
  });
/** Seven sources, Discord not connected to the organization. */
const SEVEN = sourceRows({
  intake: { repo: SHOP, label: "mate", waiting: 1 },
  slack: known({ channel: { appId: "plant-shop", channelId: "C042", channel: "shop-requests" } }),
  discord: known({ channel: { appId: "plant-shop", channelId: "D7", channel: "greenhouse" } }),
  webhooks: known([{ id: "w1" }, { id: "w2" }]),
  schedules: known([
    SCHEDULE,
    {
      ...SCHEDULE,
      id: "s2",
      name: "Check for broken links",
      rule: { every: "day" as const, at: "06:30", timeZone: "Europe/Prague" },
    },
    {
      ...SCHEDULE,
      id: "s3",
      name: "Tidy the plant photos",
      rule: { every: "week" as const, day: 5, at: "16:00", timeZone: "Europe/Prague" },
    },
  ]),
  slackConnected: true,
  discordConnected: false,
});
const DISCONNECTED = sourceRows({
  intake: null,
  slack: known({ channel: { appId: "plant-shop", channelId: "C042", channel: "shop-requests" } }),
  discord: known({ channel: null }),
  webhooks: known([]),
  schedules: { state: "failed", words: "HQ is not answering right now." },
  slackConnected: false,
  discordConnected: false,
});

const BUSY_POOL = [on(SOL, DATES.title), on(PIM, ROUNDING.title, true)];
const BUSY_TASKS = [...QUEUE, DATES, ROUNDING, SORT, IMAGES, GUIDES];
const working = (...mates: ReadonlyArray<PoolMate>) => {
  const ids = new Set(mates.map((mate) => mate.projectId));
  return (projectId: string) => ids.has(projectId);
};

/**
 * The section's states, by the name `?state=` draws one alone under: the six the design board
 * draws first, then what a read, a press and a refusal make of it.
 */
const STATES: ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly view: ReactNode;
}> = [
  {
    id: "project",
    title:
      "The project page's Board: what needs you, then what waits for review, at most six, and the way to the Board with the rest in its totals",
    view: (
      <ProjectBoard
        admin={{ onAddMate: nothing }}
        board={board(BOARD_TASKS, "$9.12 of $50", { live: BOARD_LIVE })}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "project-calm",
    title:
      "The project page's Board with nothing that needs you: one quiet line, and the way to the Board",
    view: (
      <ProjectBoard
        admin={{ onAddMate: nothing }}
        board={board([...QUEUE, SORT, IMAGES, GUIDES], "$6.44 of $50")}
        onOpenMate={nothing}
        pool={[SOL, PIM]}
        workingOf={working()}
      />
    ),
  },
  {
    id: "project-empty",
    title:
      "The project page's Board with no task and no automated Mate: New task, and the way to the Board",
    view: (
      <ProjectBoard
        admin={{ onAddMate: nothing }}
        board={board([], "$0.00 of $50")}
        onOpenMate={nothing}
        pool={[]}
        workingOf={working()}
      />
    ),
  },
  {
    id: "project-reading",
    title: "The project page's Board while it reads: the rows navigation says will land",
    view: (
      <ProjectBoard
        admin={{ onAddMate: nothing }}
        board={{
          ...board([], "$7.94 of $50"),
          read: {
            state: "reading",
            predicted: { queued: 2, progress: 1, waiting: 1, review: 0, done: 3 },
          },
        }}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        workingOf={working(SOL)}
      />
    ),
  },
  ...(["rest", "open", "putting", "refused"] as const).map((state) => ({
    id: state === "rest" ? "new-task" : `new-task-${state}`,
    title: {
      rest: "An empty Board: New task first, then the automated Mates and where tasks come from",
      open: "New task focused: its brief and Put on board opened in place",
      putting: "New task put: HQ asked, the field held until the Board holds the task",
      refused: "New task refused: said in place, the draft kept",
    }[state],
    view: (
      <Automation
        admin={ADMIN}
        board={board([], "$0.00 of $50")}
        newTask={<NewTask state={state} />}
        onOpenMate={nothing}
        pool={[]}
        sources={SOURCES(0)}
        workingOf={working()}
      />
    ),
  })),
  {
    id: "board",
    title: "The Board: put from conversations, taken by people, every lane (Mara, an Owner, reads)",
    view: (
      <Automation
        admin={ADMIN}
        board={board(BOARD_TASKS, "$9.12 of $50", { live: BOARD_LIVE })}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={SOURCES(2)}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "board-direct",
    title:
      "Tasks put on the Board itself: by whom, no way back; Take only into Lark, whose server reads them",
    view: (
      <Automation
        admin={ADMIN}
        board={board(DIRECT_TASKS, "$4.20 of $50", { live: DIRECT_LIVE })}
        onOpenMate={nothing}
        pool={[on(SOL, PICKUP.title, true), PIM]}
        sources={SOURCES(0)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "board-needs",
    title:
      "Needs: a plan's tasks held on the one at work, one whose need broke, one queued once its need merged",
    view: (
      <Automation
        admin={ADMIN}
        board={board(NEEDS_TASKS, "$9.12 of $50", { live: new Map() })}
        onOpenMate={nothing}
        pool={[on(SOL, CARDS.title), PIM, BO]}
        sources={SOURCES(1)}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "board-answer",
    title: "A direct put waiting on you: its question and your answer in its row",
    view: (
      <Automation
        admin={ADMIN}
        board={board([LABELS, PICKUP], "$4.20 of $50", { live: DIRECT_LIVE })}
        onOpenMate={nothing}
        pool={[on(SOL, PICKUP.title, true), PIM]}
        sources={SOURCES(0)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "board-needs-member",
    title:
      "Needs as a member reads them who put none of them: no Drop the need, no Take on a held task",
    view: (
      <Automation
        board={board(
          NEEDS_TASKS.map((each) =>
            each.source?.kind === "conversation"
              ? { ...each, source: { ...each.source, putBy: RHEA } }
              : each,
          ),
          "$9.12 of $50",
          {
            live: new Map(),
            role: "BASIC_USER",
            mates: MATES.filter((mate) => mate.projectId !== "p-quill"),
          },
        )}
        onOpenMate={nothing}
        pool={[on(SOL, CARDS.title), PIM, BO]}
        sources={{ rows: SOURCES(1).rows.slice(0, 1), reading: false, withheld: true }}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "board-member",
    title: "The Board as a member reads it: Take into her one Mate, Stop only on her own",
    view: (
      <Automation
        board={board(BOARD_TASKS, "$9.12 of $50", {
          live: BOARD_LIVE,
          role: "BASIC_USER",
          mates: MATES.filter((mate) => mate.projectId !== "p-quill"),
        })}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={{ rows: SOURCES(2).rows.slice(0, 1), reading: false, withheld: true }}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "board-presses",
    title: "Presses: a Take under way, a Take whose conversation did not open, a Stop asking",
    view: (
      <Automation
        admin={ADMIN}
        board={board(BOARD_TASKS, "$9.12 of $50", {
          live: BOARD_LIVE,
          pressOf: (id) =>
            id === GIFT_WRAP.id
              ? { kind: "working", words: "Taking it…" }
              : id === REPOT.id
                ? { kind: "refused", words: STRANDED_TAKE_WORDS }
                : id === STALE.id
                  ? { kind: "asking" }
                  : { kind: "idle" },
          stranded: [REPOT.id],
        })}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={SOURCES(2)}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "board-no-pool",
    title: "A Board with no automated Mates: people put and take its tasks",
    view: (
      <Automation
        board={board([GIFT_WRAP, REPOT, STALE, WISHLIST], "$0.00 of $50", {
          live: new Map(),
          role: "BASIC_USER",
        })}
        onOpenMate={nothing}
        pool={[]}
        sources={NO_SOURCES}
        workingOf={working()}
      />
    ),
  },
  {
    id: "idle",
    title: "Idle: nothing queued, a few finished",
    view: (
      <Automation
        admin={ADMIN}
        board={board([SORT, IMAGES, GUIDES], "$6.44 of $50")}
        onOpenMate={nothing}
        pool={[SOL, PIM]}
        sources={SOURCES(0)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "busy",
    title: "At work: one Mate working, one asking, two tasks queued",
    view: (
      <Automation
        admin={ADMIN}
        board={board(BUSY_TASKS, "$7.94 of $50")}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={SOURCES(1)}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "failed",
    title: "A failure: one task failed, one was stopped, one is up for review",
    view: (
      <Automation
        admin={ADMIN}
        board={board([SORT, CATALOGUE, PRICE, RENAME, GUIDES], "$9.74 of $50")}
        onOpenMate={nothing}
        pool={[SOL, PIM]}
        sources={SOURCES(0)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "long",
    title: "A long list: fourteen finished, five shown until the rest are opened",
    view: (
      <Automation
        admin={ADMIN}
        board={board([SEARCH, ...FOURTEEN], "$21.40 of $50")}
        onOpenMate={nothing}
        pool={[SOL, PIM, WREN, on(BO, SEARCH.title)]}
        sources={SOURCES(0)}
        workingOf={working(BO)}
      />
    ),
  },
  {
    id: "first",
    title: "First run: one Mate, no source yet",
    view: (
      <Automation
        admin={ADMIN}
        board={board([], "$0.00 of $50")}
        onOpenMate={nothing}
        pool={[PIM]}
        sources={NO_SOURCES}
        workingOf={working()}
      />
    ),
  },
  {
    id: "sources",
    title: "Several sources: seven, one not connected",
    view: (
      <Automation
        admin={ADMIN}
        board={board([SORT, IMAGES], "$6.44 of $50")}
        onOpenMate={nothing}
        pool={[SOL, PIM]}
        sources={SEVEN}
        workingOf={working()}
      />
    ),
  },
  {
    id: "asking",
    title: "Stop pressed: it asks in the row",
    view: (
      <Automation
        admin={ADMIN}
        board={board(BUSY_TASKS, "$7.94 of $50", {
          pressOf: (id) => (id === DATES.id ? { kind: "asking" } : { kind: "idle" }),
        })}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={SOURCES(1)}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "stopping",
    title: "A task stopping, a queued task's Stop refused",
    view: (
      <Automation
        admin={ADMIN}
        board={board(
          BUSY_TASKS.map((each) => (each === DATES ? { ...each, state: "stopping" } : each)),
          "$7.94 of $50",
          {
            pressOf: (id) =>
              id === "44"
                ? { kind: "refused", words: "Only an Owner or Admin can stop a task." }
                : { kind: "idle" },
          },
        )}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={SOURCES(1)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "held",
    title: "A Mate held by its change: HQ gives Wren no task until it is merged or closed",
    view: (
      <Automation
        admin={ADMIN}
        board={board([PRICE, SORT, GUIDES], "$6.71 of $50", {
          live: new Map([["40", { id: "40", title: PRICE.title, url: null, done: true as const }]]),
          held: (projectId) => projectId === WREN.projectId,
        })}
        onOpenMate={nothing}
        pool={[SOL, { ...WREN, automation: { task: { title: PRICE.title, done: true } } }]}
        sources={SOURCES(0)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "reading",
    title: "The board while it reads",
    view: (
      <Automation
        admin={ADMIN}
        board={{
          ...board([], "$7.94 of $50"),
          read: {
            state: "reading",
            predicted: { queued: 2, progress: 1, waiting: 1, review: 0, done: 3 },
          },
        }}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={SOURCES(1)}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "unread",
    title: "The board's read failed",
    view: (
      <Automation
        admin={ADMIN}
        board={{
          ...board([], "$7.94 of $50"),
          read: {
            state: "failed",
            words: "Couldn’t read its tasks: HQ is not answering right now.",
          },
        }}
        onOpenMate={nothing}
        pool={[SOL, PIM]}
        sources={SOURCES(0)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "empty",
    title: "Nothing set up yet",
    view: (
      <Automation
        admin={ADMIN}
        onOpenMate={nothing}
        pool={[]}
        sources={NO_SOURCES}
        workingOf={working()}
      />
    ),
  },
  {
    id: "disconnected",
    title: "Slack not connected, a source's read failed",
    view: (
      <Automation
        admin={ADMIN}
        onOpenMate={nothing}
        pool={[WREN, BO]}
        sources={DISCONNECTED}
        workingOf={working()}
      />
    ),
  },
  {
    id: "sources-reading",
    title: "Its sources still read",
    view: (
      <Automation
        admin={ADMIN}
        onOpenMate={nothing}
        pool={[SOL]}
        sources={{ rows: [], reading: true, withheld: false }}
        workingOf={working()}
      />
    ),
  },
  {
    id: "member",
    title: "A member reads it",
    view: (
      <Automation
        board={board(BUSY_TASKS, "$7.94 of $50", {
          role: "BASIC_USER",
          mates: MATES.filter((mate) => mate.ownerUserId !== ME),
        })}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={{ rows: SOURCES(1).rows.slice(0, 1), reading: false, withheld: true }}
        workingOf={working(SOL)}
      />
    ),
  },
];

/**
 * The Board's page live: every two seconds Rhea's gift wrapping moves on — taken by Sol, then
 * merged, then back in the queue — so its row's slide, a lane's arrival and the flash can be
 * watched.
 */
function LiveBoardPage() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setStep((at) => (at + 1) % 3);
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const moved: HqAppTask =
    step === 0
      ? GIFT_WRAP
      : step === 1
        ? {
            ...(({ position: _place, ...rest }) => rest)(GIFT_WRAP),
            state: "working",
            mate: by(SOL),
            taker: { kind: "pool", mateProjectId: SOL.projectId },
            startedAt: ago(1),
            spentUsd: 0.02,
            workedMs: 60_000,
          }
        : {
            ...GIFT_WRAP,
            state: "merged",
            mate: by(SOL),
            endedAt: ago(0),
            spentUsd: 0.36,
            ...pr(51),
          };
  return (
    <BoardPageAt
      admin={ADMIN}
      open={null}
      pool={BUSY_POOL}
      view={board(
        BOARD_TASKS.map((each) => (each.id === GIFT_WRAP.id ? moved : each)),
        "$9.12 of $50",
        { live: BOARD_LIVE },
      )}
      workingOf={working(SOL)}
    />
  );
}

/**
 * The Board's page, a task's panel open on each kind of task, by the name `?state=` draws it under:
 * what the reader answers here or in its conversation, Takes, works, reviews; what waits for others
 * or on a need that broke; what ended; a Stop asked; and as a member reads it.
 */
const PAGE_STATES: ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly view: ReactNode;
}> = [
  ...(
    [
      ["page", "nothing open", null],
      ["page-queued", "a queued task: Take", GIFT_WRAP.id],
      ["page-working", "a pool Mate at work", DATES.id],
      ["page-taken", "a task you took: Done, Release", REPOT.id],
      ["page-asks-chat", "a question answered in its conversation", FERTILISER.id],
      ["page-review", "a change up for review", WISHLIST.id],
      ["page-merged", "a merged task", SORT.id],
      ["page-failed", "a failed task", CATALOGUE.id],
    ] as const
  ).map(([id, what, open]) => ({
    id,
    title: `The Board's page, ${what}`,
    view: (
      <BoardPageAt
        admin={ADMIN}
        open={open}
        pool={BUSY_POOL}
        view={board(BOARD_TASKS, "$9.12 of $50", { live: BOARD_LIVE })}
        workingOf={working(SOL)}
      />
    ),
  })),
  {
    id: "page-asks",
    title: "The Board's page, a question put on the Board itself: answered in its panel",
    view: (
      <BoardPageAt
        admin={ADMIN}
        open={PICKUP.id}
        pool={[on(SOL, PICKUP.title, true), PIM]}
        view={board(DIRECT_TASKS, "$4.20 of $50", { live: DIRECT_LIVE })}
        workingOf={working()}
      />
    ),
  },
  ...(
    [
      ["page-held", "a task waiting for two others", EMAIL.id],
      ["page-broken", "a task whose need broke: Drop the need", REDEEM.id],
      ["page-needed", "a task two others wait on", CARDS.id],
    ] as const
  ).map(([id, what, open]) => ({
    id,
    title: `The Board's page, ${what}`,
    view: (
      <BoardPageAt
        admin={ADMIN}
        open={open}
        pool={[on(SOL, CARDS.title), PIM, BO]}
        view={board(NEEDS_TASKS, "$9.12 of $50", { live: new Map() })}
        workingOf={working(SOL)}
      />
    ),
  })),
  {
    id: "page-live",
    title: "The Board's page live: a task moving from lane to lane",
    view: <LiveBoardPage />,
  },
  {
    id: "page-stop",
    title: "The Board's page, Stop asked in the panel",
    view: (
      <BoardPageAt
        admin={ADMIN}
        open={DATES.id}
        pool={BUSY_POOL}
        view={board(BOARD_TASKS, "$9.12 of $50", {
          live: BOARD_LIVE,
          pressOf: (id) => (id === DATES.id ? { kind: "asking" } : { kind: "idle" }),
        })}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "page-member",
    title: "The Board's page as a member reads it, a queued task open: Take into her one Mate",
    view: (
      <BoardPageAt
        open={GIFT_WRAP.id}
        pool={BUSY_POOL}
        view={board(BOARD_TASKS, "$9.12 of $50", {
          live: BOARD_LIVE,
          role: "BASIC_USER",
          mates: MATES.filter((mate) => mate.projectId !== "p-quill"),
        })}
        workingOf={working(SOL)}
      />
    ),
  },
];

const ISSUE: MateTaskSource = {
  kind: "github-issue",
  repo: "acme/tea-shop",
  number: 1,
  url: "https://github.com/acme/tea-shop/issues/1",
  title: "Add a search box to the tea list",
  author: "nova-dev",
};
const PR = { number: 2, url: "https://github.com/acme/tea-shop/pull/2" };
const AT: TaskSession = {
  status: null,
  taskId: "task-1",
  stoppable: false,
  workedMs: null,
  spentUsd: null,
  change: null,
  pullRequest: null,
};
const SESSIONS: ReadonlyArray<readonly [string, TaskSession]> = [
  ["Not read yet", AT],
  ["Queued", { ...AT, status: "queued", stoppable: true, workedMs: 0, spentUsd: 0 }],
  ["Starting", { ...AT, status: "starting", stoppable: true, workedMs: 0, spentUsd: 0 }],
  ["Working", { ...AT, status: "working", stoppable: true, workedMs: 754_000, spentUsd: 0.42 }],
  [
    "Waiting for you",
    { ...AT, status: "waiting", stoppable: true, workedMs: 1_200_000, spentUsd: 1.37 },
  ],
  ["Stopping", { ...AT, status: "stopping", workedMs: 1_200_000, spentUsd: 1.37 }],
  [
    "Up for review, change in Mate",
    {
      ...AT,
      status: "review",
      workedMs: 1_200_000,
      spentUsd: 1.37,
      change: { repo: "web", number: 3 },
    },
  ],
  [
    "Up for review, PR open, checks passing",
    {
      ...AT,
      status: "review",
      workedMs: 1_200_000,
      spentUsd: 1.37,
      change: { repo: "web", number: 3 },
      pullRequest: { ...PR, state: "open", checks: "passing" },
    },
  ],
  [
    "Working on review comments",
    {
      ...AT,
      status: "working",
      stoppable: true,
      workedMs: 1_500_000,
      spentUsd: 2.05,
      pullRequest: { ...PR, state: "open", checks: "failing" },
    },
  ],
  [
    "Merged",
    {
      ...AT,
      status: "merged",
      workedMs: 3_840_000,
      spentUsd: 6.44,
      pullRequest: { ...PR, state: "merged" },
    },
  ],
  [
    "Closed",
    {
      ...AT,
      status: "closed",
      workedMs: 900_000,
      spentUsd: 0.66,
      change: { repo: "web", number: 1 },
    },
  ],
  ["Failed", { ...AT, status: "failed", workedMs: 3_600_000, spentUsd: 0.004 }],
  ["Stopped", { ...AT, status: "stopped", workedMs: 420_000, spentUsd: 0.18 }],
];

const INTAKE: AppIntakeRead = {
  intake: { repo: "acme/tea-shop", label: "mate", waiting: 1 },
  action: { kind: "idle" },
  answer: null,
};

function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="grid content-start gap-3">
      <h2 className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function DialogFor({ kind }: { readonly kind: SourceKind }) {
  const missing = connectionMissing(kind, { slack: true, discord: false });
  return (
    <SourceDialog kind={kind} onClose={nothing}>
      {missing !== null ? (
        <p className="text-body text-foreground">{missing}</p>
      ) : kind === "github" ? (
        <ul className="grid">
          <AppIntakeView
            appId="tea-shop"
            choices={["acme/tea-shop"]}
            name="Tea Shop"
            onSet={nothing}
            onStop={nothing}
            read={{ ...INTAKE, intake: null }}
            reposRead
          />
        </ul>
      ) : kind === "slack" ? (
        <AppChannelView
          choices={controls(
            known({
              bot: "mate",
              channels: [
                { id: "C0SUPPORT", name: "support" },
                { id: "C0ORDERS", name: "orders" },
              ],
            }),
          )}
          controls={controls(known({ channel: null }))}
          source="slack"
        />
      ) : kind === "webhook" ? (
        <AppWebhooksView
          controls={controls(
            known([
              {
                id: "w1",
                name: "Sentry",
                url: "https://hq-acme.zerops.app/api/intake/webhook/w1",
                createdAt: "2026-10-17T09:00:00.000Z",
              },
            ]),
          )}
          name="Tea Shop"
        />
      ) : (
        <AppSchedulesView controls={controls(known([SCHEDULE]))} name="Tea Shop" />
      )}
    </SourceDialog>
  );
}

/**
 * The whole Board as its page's list draws it: New task at rest leads it, unless a state draws its
 * own.
 */
function Automation(props: Omit<Parameters<typeof ProjectAutomationView>[0], "mode">) {
  return <ProjectAutomationView mode="page" newTask={<NewTask state="rest" />} {...props} />;
}

/** The project page's short Board: New task, the pool, what needs the reader, the way to the Board. */
function ProjectBoard(props: Omit<Parameters<typeof ProjectAutomationView>[0], "mode">) {
  return (
    <ProjectAutomationView
      boardHref="#board"
      mode="compact"
      newTask={<NewTask state="rest" />}
      onOpenBoard={nothing}
      {...props}
      board={props.board === undefined ? undefined : { ...props.board, onPick: nothing }}
    />
  );
}

/**
 * The Board's page as the product draws it beside the menu (a stand-in at its 435 px): its head,
 * the whole Board, and the task `open` in its panel; a row's press opens another, Esc or ✕ none.
 */
function BoardPageAt({
  view,
  open,
  pool,
  workingOf,
  admin,
}: {
  readonly view: BoardView;
  readonly open: string | null;
  readonly pool: ReadonlyArray<PoolMate>;
  readonly workingOf: (projectId: string) => boolean;
  readonly admin?: AutomationControls | undefined;
}) {
  const [selected, setSelected] = useState(open);
  const board: BoardView = { ...view, selected, onPick: setSelected };
  return (
    <div className="grid min-h-dvh grid-cols-[435px_minmax(0,1fr)] bg-background text-foreground max-md:grid-cols-[minmax(0,1fr)]">
      <div aria-hidden="true" className="bg-sidebar max-md:hidden" />
      <Page width="full">
        <BoardPageView
          board={board}
          list={
            <Automation
              admin={admin}
              board={board}
              onOpenMate={nothing}
              pool={pool}
              sources={SOURCES(2)}
              workingOf={workingOf}
            />
          }
          onClose={() => {
            setSelected(null);
          }}
          trail={
            <Crumbs
              trail={[
                { label: "Overview", onClick: nothing },
                { label: "Plant shop", onClick: nothing },
                { label: "Board" },
              ]}
            />
          }
        />
      </Page>
    </div>
  );
}

/** New task, the Board's first line, in each state it is looked at in. */
type NewTaskState = "rest" | "open" | "putting" | "refused";
function NewTask({ state }: { readonly state: NewTaskState }) {
  const drafted = state === "putting" || state === "refused";
  return (
    <NewBoardTaskView
      brief={
        drafted
          ? "Let a shopper choose pick-up at the greenhouse at checkout, with no delivery fee.\n\nIt's done when the choice shows under the delivery options, the order confirmation names the greenhouse's address and opening hours, and the order export marks pick-up orders."
          : ""
      }
      onBrief={nothing}
      onCancel={nothing}
      onLeave={nothing}
      onOpen={nothing}
      onPut={nothing}
      onTitle={nothing}
      open={state !== "rest"}
      put={
        state === "putting"
          ? { kind: "working", verb: "task-put" }
          : state === "refused"
            ? { kind: "failed", words: "HQ is not answering right now." }
            : { kind: "idle" }
      }
      title={state === "rest" ? "" : "Let people pick their order up at the greenhouse"}
    />
  );
}

/** The section as the project page holds it: under its label, flush on the page's card. */
function OnPage({ children }: { readonly children: ReactNode }) {
  return (
    <div className={PAGE_GROUP}>
      <SectionHeader size="panel" title="Board" />
      <Card>{children}</Card>
    </div>
  );
}

function Harness() {
  const page = PAGE_STATES.find((state) => state.id === STATE);
  if (page !== undefined) return page.view;
  const states = STATE === null ? STATES : STATES.filter((state) => state.id === STATE);
  return (
    <div className={COLUMNS}>
      <div className="grid content-start gap-8">
        {states.map((state) => (
          <div className="grid content-start gap-3" data-state={state.id} key={state.id}>
            <h2 className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
              {state.title}
            </h2>
            <OnPage>{state.view}</OnPage>
          </div>
        ))}
      </div>
      <Panel title="A task's session, in each state">
        <div className="grid max-w-3xl gap-3">
          {SESSIONS.map(([label, session]) => (
            <div className="grid gap-1" key={label}>
              <p className="text-caption text-muted-foreground">{label}</p>
              <MateTaskStatusView
                onStop={session.stoppable ? nothing : undefined}
                session={session}
                task={ISSUE}
              />
              <MateTaskCardView onOpenChange={nothing} session={session} task={ISSUE} />
            </div>
          ))}
        </div>
      </Panel>
      {DIALOG === null ? null : <DialogFor kind={DIALOG} />}
    </div>
  );
}

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>{MERGING === null ? <Harness /> : <MergingHarness show={MERGING} />}</StrictMode>,
  );
}
