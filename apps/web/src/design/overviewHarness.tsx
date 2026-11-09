/**
 * The overview: the project cards side by side, from made-up projects in the four states the
 * project-page board draws — (a) setting up, (b) needs you, (c) running, (d) release failed.
 * `?page=tea` (or `watchlist`, …) draws that project's own page: its header and its road.
 * A card's name, a place's line and a page's crumbs go where they go in the app — the overview, a
 * project's page, a place's page (its head only here) — so the way among the three can be walked.
 *
 * Served by the dev server at `/design-overview.html` (`?theme=dark`). It stands beside a blank
 * left menu at the owner's 435 px; open it at 1786 × 1000. A place's line opens its panel; a
 * lifted Mate's buttons say what they would do in `window.__overviewHarness.acted`.
 * `?arrival=developer|guest|admin` draws the first visit's welcome for someone just invited.
 *
 * Fixtures only. Nothing here ships — `design-overview.html` is not `index.html`, and no route
 * imports this module.
 */
import type {
  FlowPullRequest,
  GroupFlow,
  GroupFlowMate,
  GroupFlowProduction,
  GroupFlowStop,
  ZeropsGroup,
} from "@t3tools/client-runtime/zerops";
import { mateParts } from "@t3tools/client-runtime/zerops/mateParts";
import { MATE_SHAPE_OF_TINT, type MateMarkState, type MateTintId } from "@t3tools/shared/brand";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import type { AppRouter } from "~/router";
import { createRoot } from "react-dom/client";

import { ArrivalWelcome } from "~/components/zerops/projects/ArrivalWelcome";
import { PutLiveRow } from "~/components/zerops/ProductionRun";
import { MateFace } from "~/components/zerops/primitives";
import type { MateRowView } from "~/components/zerops/SidebarMateRow.logic";
import type { ProductionChip } from "~/components/zerops/SidebarProductionChip.logic";
import { MateAutomatedMark } from "~/components/zerops/MateAutomatedMark";
import { CardMateLiftActions } from "~/components/zerops/projects/ProjectCards";
import { MateRow, MateRowTime } from "~/components/zerops/system/MateRow";
import { PageHeader } from "~/components/zerops/system/PageHeader";
import { PlaceLine } from "~/components/zerops/system/PlaceLine";
import { usePageTrail } from "~/components/zerops/system/Crumbs";
import { placeLines } from "~/components/zerops/projects/projectCard.logic";
import { Skeleton } from "~/components/ui/skeleton";
import { pagesViewTransition } from "~/pageTransitions";
import {
  cardMateReading,
  cardReady,
  projectReleaseWait,
  projectWaits,
} from "~/components/zerops/projects/projectCard.logic";
import { OverviewFilters } from "~/components/zerops/projects/OverviewFilters";
import { SidebarChiefRow } from "~/components/zerops/chief/SidebarChiefRow";
import {
  ZeropsProjectsFlow,
  type ProjectsFlowGroup,
} from "~/components/zerops/projects/ZeropsProjectsFlow";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";
import { HarnessLineMine, harnessProjectPage } from "./projectPageFixtures";
import { ZeropsProjectMenu } from "~/components/zerops/ZeropsProjectMenu";
import { placeVaults, type PlaceVault } from "~/components/zerops/vault/placeVault.logic";
import { usePlaceVaultDrawer } from "~/components/zerops/vault/StopVault";
import { VaultPanelBody } from "~/components/zerops/vault/VaultPanel";
import { VAULT_FIXTURE, vaultFixtureImpact } from "~/components/zerops/vault/vaultFixture";
import type { WaitingItem } from "~/components/zerops/SidebarWaiting.logic";
import { overviewOrder } from "~/components/zerops/projects/projectsView.logic";
import { Button } from "~/components/ui/button";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const MENU_WIDTH = 435;
const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const acted: Array<string> = [];
Object.assign(window, { __overviewHarness: { acted } });

interface Person {
  readonly userId: string;
  readonly name: string;
  readonly initials: string;
}
const NOVA: Person = { userId: "nova-dev", name: "Nova Dev", initials: "ND" };
const INES: Person = { userId: "ines", name: "Ines", initials: "IN" };

/** A made-up Mate: what its menu row reads, and whose it is. */
interface Mate {
  readonly id: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly face: MateMarkState;
  readonly view: Pick<MateRowView, "state" | "ask" | "reply" | "dot">;
  readonly status: ThreadStatusKind;
  readonly time: string;
  readonly owner: Person;
  readonly automated?: boolean;
  readonly flow?: Partial<GroupFlowMate>;
  /** A question's options, answered in place. */
  readonly choices?: ReadonlyArray<string>;
}

const words = (text: string, tone: "muted" | "ink" | "failed" = "muted") =>
  ({ kind: "words", text, tone }) as const;

/** A Mate's parts as the one reader reads them: a dev pool and its stage per part, the runner's unrouted. */
function partsOf(names: ReadonlyArray<string>, host: string): Partial<GroupFlowMate> {
  const { parts } = mateParts({
    services: names.flatMap((name) => [{ hostname: `${name}pool` }, { hostname: `${name}stage` }]),
    routes: names
      .filter((name) => name !== "runner")
      .map((name) => ({ service: `${name}stage`, url: `https://${host}-${name}.prg1.zerops.app` })),
    pools: names.map((name) => `${name}pool`),
  });
  return { parts };
}

function mate(
  id: string,
  name: string,
  tint: MateTintId,
  over: Partial<Omit<Mate, "id" | "name" | "tint">> = {},
): Mate {
  return {
    id,
    name,
    tint,
    face: "idle",
    view: { state: "idle", ask: undefined, reply: words("Done."), dot: undefined },
    status: "idle",
    time: "3h",
    owner: NOVA,
    ...over,
  };
}

const working = (id: string, name: string, tint: MateTintId, line: string, time: string) =>
  mate(id, name, tint, {
    face: "working",
    status: "working",
    time,
    view: { state: "working", ask: line, reply: { kind: "live", words: line }, dot: undefined },
  });

const version = (label: string) => ({
  name: label,
  commit: undefined,
  sha: undefined,
  taggedBy: undefined,
  label,
});

function stop(projectId: string, name: string, over: Partial<GroupFlowStop> = {}): GroupFlowStop {
  return {
    projectId,
    name,
    state: "deployed",
    version: undefined,
    source: name === "production" ? "release" : "main",
    addresses: [],
    ...over,
  };
}

/** A project as the harness draws it: its group, its flow, its Mates, its places as the menu reads them. */
interface Project {
  readonly entry: ProjectsFlowGroup<Mate>;
  readonly chip?: ProductionChip;
  readonly since?: string;
  /** This tab's run began releasing then (wall ms). */
  readonly releaseSince?: number;
  readonly canPutLive: boolean;
  readonly merged?: { readonly by: Mate; readonly title: string; readonly at: string };
}

function project(input: {
  readonly id: string;
  readonly name: string;
  readonly mates: ReadonlyArray<Mate>;
  readonly coming?: ReadonlyArray<GroupFlowMate>;
  readonly production: GroupFlowProduction;
  readonly stages?: ReadonlyArray<GroupFlowStop>;
  readonly pullRequests?: GroupFlow["pullRequests"];
  readonly notLive?: number;
  readonly chip?: ProductionChip;
  readonly since?: string;
  readonly releaseSince?: number;
  readonly canPutLive?: boolean;
  readonly merged?: Project["merged"];
}): Project {
  const group: ZeropsGroup = {
    groupId: input.id,
    name: input.name,
    nameSource: "hq",
    environments: [],
    pending: [],
    production: undefined,
  } as unknown as ZeropsGroup;
  const flow: GroupFlow = {
    groupId: input.id,
    mates: [
      ...input.mates.map((entry) => ({
        projectId: entry.id,
        name: entry.name,
        previews: [],
        waiting: entry.view.state === "needs",
        failed: entry.view.state === "failed",
        talked: true,
        working: entry.view.state === "working",
        ...entry.flow,
      })),
      ...(input.coming ?? []),
    ],
    pullRequests: input.pullRequests ?? [],
    main: {
      head: undefined,
      hasCode: true,
      notLive: input.notLive ?? 0,
      notLiveAtLeast: false,
    },
    stages: input.stages ?? [],
    creatingStages: [],
    unreadStages: [],
    production: input.production,
    nextStep: { kind: "none", text: "", verb: undefined, target: undefined },
  };
  return {
    entry: {
      group,
      flow,
      activities: [],
      awaiting: false,
      changesAwaiting: false,
      mates: new Map(input.mates.map((entry) => [entry.id, entry])),
      stops: new Map(),
      others: [],
      lastMerged: undefined,
      line: undefined,
      placeholder: false,
    },
    ...(input.chip === undefined ? {} : { chip: input.chip }),
    ...(input.since === undefined ? {} : { since: input.since }),
    ...(input.releaseSince === undefined ? {} : { releaseSince: input.releaseSince }),
    ...(input.merged === undefined ? {} : { merged: input.merged }),
    canPutLive: input.canPutLive ?? false,
  };
}

const change = (number: number, title: string, mateProjectId: string): FlowPullRequest => ({
  repository: "app",
  number,
  title,
  kind: "code",
  mateProjectId,
  url: undefined,
  mergeability: "mergeable",
  behind: false,
  merged: false,
  mergedAt: undefined,
  headSha: "abc",
  baseBranch: "main",
  line: `app #${String(number)}`,
  updatedAt: undefined,
});

const inReview = (number: number, title: string, mateProjectId: string) => ({
  pull: change(number, title, mateProjectId),
  blocked: null,
  state: undefined,
  review: false,
});

const JUNO_ASKS = mate("juno", "Juno", "sky", {
  face: "needs",
  status: "input",
  time: "8m",
  choices: ["Email code", "Google"],
  view: {
    state: "needs",
    ask: "Sign-in",
    reply: words("Should players sign in with an email code, or with Google?", "ink"),
    dot: "attention",
  },
});

const PROJECTS: ReadonlyArray<Project> = [
  // (a) Setting up: its first Mate on its way, nothing runs.
  project({
    id: "acme",
    name: "Acme Docs",
    mates: [],
    coming: [
      {
        projectId: "juno-new",
        name: "Juno",
        previews: [],
        waiting: false,
        talked: false,
        coming: { face: { tint: "coral", shape: undefined } as never },
      },
    ],
    production: { kind: "absent" },
  }),
  // (b) Needs you: Juno asks, Raya works, Vale is free; merged work waits for production.
  project({
    id: "playwisely",
    name: "PlayWisely",
    mates: [
      JUNO_ASKS,
      working("raya", "Raya", "olive", "Building the weekly leaderboard", "2m"),
      mate("tess-p", "Tess", "rose", {
        face: "needs",
        status: "planReady",
        time: "20m",
        view: {
          state: "needs",
          ask: "Scores",
          reply: words("Plan: weekly scores reset on Monday. Go ahead?", "ink"),
          dot: "attention",
        },
      }),
      mate("vale", "Vale", "violet", { owner: INES, time: "1h" }),
    ],
    production: { kind: "absent" },
    // Not live yet, with a stage whose deploy failed: the card still lists it.
    stages: [stop("play-stage", "stage", { state: "failed" })],
    notLive: 4,
    canPutLive: true,
    merged: {
      by: mate("vale", "Vale", "violet"),
      title: "Share a score with a link",
      at: ago(60),
    },
  }),
  // (c) Running: two in review, three ready, production up six days; two automated Mates.
  project({
    id: "tea",
    name: "Tea Shop",
    mates: [
      {
        ...working("raya-t", "Raya", "olive", "Gift wrapping at checkout", "3m"),
        flow: partsOf(["app"], "raya-teashop"),
      },
      // Seven parts on dev pools, one with no public preview: they wrap inside the card.
      {
        ...working("vale-t", "Vale", "amber", "Tea of the month email", "11m"),
        flow: partsOf(["api", "edge", "embedder", "geo", "runner", "site", "web"], "vale-tea"),
      },
      {
        ...working("odo", "Odo", "slate", "#42 Prices round wrong in the cart", "12m"),
        automated: true,
      },
      { ...mate("tess", "Tess", "rose", { owner: INES }), automated: true },
    ],
    pullRequests: [
      inReview(51, "Gift cards at checkout", "raya-t"),
      inReview(52, "Tea of the month banner", "vale-t"),
    ],
    production: {
      kind: "ready-to-release",
      stop: stop("tea-prod", "production", {
        version: version("v0.1.3"),
        addresses: [{ service: "app", url: "https://teashop-a1b2.prg1.zerops.app" }],
      }),
      line: "",
      candidate: { tag: "v0.1.4", waiting: 3 },
    },
    stages: [stop("tea-stage", "stage", { version: version("main") })],
    notLive: 3,
    since: ago(60 * 24 * 6),
    merged: { by: mate("vale-t", "Vale", "amber"), title: "Prices per 100 g", at: ago(25) },
  }),
  // (e) Many places: production runs six services, three stages each follow their own source.
  project({
    id: "acme-store",
    name: "Acme Store",
    mates: [
      { ...JUNO_ASKS, id: "juno-s", view: { ...JUNO_ASKS.view, ask: "Checkout" } },
      mate("toby-s", "Toby", "amber", { time: "2h" }),
      mate("ines-s", "Ines", "olive", { owner: INES, time: "1d" }),
      {
        ...working("odo-s", "Odo", "slate", "#42 Prices round wrong in the cart", "12m"),
        automated: true,
      },
      {
        ...mate("tess-s", "Tess", "rose", {
          time: "5h",
          view: {
            state: "idle",
            ask: undefined,
            reply: words("#39 Prices no longer round down in the cart · merged"),
            dot: undefined,
          },
        }),
        automated: true,
      },
    ],
    pullRequests: [
      inReview(71, "One-page checkout", "juno-s"),
      // A setup change Core held for a person: its merge would change production.
      {
        ...inReview(3, "Add object storage to the setup", "juno-s"),
        pull: {
          ...change(3, "Add object storage to the setup", "juno-s"),
          repository: "group",
          kind: "recipe",
          line: "#3",
        },
      },
    ],
    production: {
      kind: "ready-to-release",
      stop: stop("store-prod", "production", {
        version: version("v0.1.59"),
        addresses: [
          { service: "app", url: "https://shop.acme.example" },
          { service: "api", url: "https://api-acme-e5f6.prg1.zerops.app" },
        ],
      }),
      line: "",
      candidate: { tag: "v0.1.60", waiting: 2 },
    },
    stages: [
      stop("store-stage", "stage", {
        addresses: [{ service: "app", url: "https://app-acme-stage.prg1.zerops.app" }],
      }),
      stop("store-checkout", "stage-checkout", {
        source: "checkout-redesign",
        addresses: [{ service: "app", url: "https://app-acme-checkout.prg1.zerops.app" }],
      }),
      stop("store-perf", "stage-perf", { state: "failed", source: "perf-budget" }),
    ],
    notLive: 2,
    since: ago(60 * 24 * 19),
    merged: {
      by: mate("toby-s", "Toby", "amber"),
      title: "Gift cards at checkout",
      at: ago(60 * 5),
    },
  }),
  // (g) A release on its way, sent by this tab's run: production's line says it once, with its
  // clock; the run draws no second line.
  project({
    id: "ines-bakery",
    name: "Ines Bakery",
    mates: [mate("ines-b", "Ines", "olive", { time: "5m" })],
    production: {
      kind: "releasing",
      stop: stop("bakery-prod", "production", { version: version("v0.1.1") }),
      line: "",
      tag: "v0.1.2",
    },
    stages: [stop("bakery-stage", "stage")],
    chip: { label: "prod", state: "releasing", version: "v0.1.1", next: "v0.1.2" },
    since: ago(60),
    releaseSince: NOW - 42_000,
  }),
  // (f) Nothing released yet, no stage: one Mate at work.
  project({
    id: "juno-notes",
    name: "Juno Notes",
    mates: [working("juno-n", "Juno", "sky", "Sorting notes by tag", "4m")],
    production: { kind: "absent" },
    notLive: 1,
    canPutLive: true,
  }),
  // (g) Production and a stage set up, nothing deployed to either (Larkspur, 2026-10-28): each
  // its title and its word, no services shown as up, no address doors.
  project({
    id: "larkspur",
    name: "Lark Studio",
    mates: [mate("fen", "Fen", "sky", { time: "12m" })],
    production: {
      kind: "empty",
      stop: stop("lark-prod", "production", { state: "empty" }),
      line: "",
    },
    stages: [stop("lark-stage", "stage", { state: "empty" })],
    chip: { label: "prod", state: "empty" },
  }),
  // (h) Production down, and a Mate asks: the most urgent card, first in the grid.
  project({
    id: "harbor",
    name: "Harbor Radio",
    mates: [
      mate("nell", "Nell", "amber", {
        face: "needs",
        status: "input",
        time: "21m",
        view: {
          state: "needs",
          ask: "Region",
          reply: words("Which region should the stream run in, Prague or Frankfurt?", "ink"),
          dot: "attention",
        },
      }),
      mate("pell", "Pell", "olive", { time: "2d" }),
      mate("pim", "Pim", "sky", { owner: INES, time: "3d" }),
    ],
    production: {
      kind: "live",
      stop: stop("harbor-prod", "production", {
        version: version("v2.4.0"),
        addresses: [{ service: "app", url: "https://radio.harbor.example" }],
      }),
      line: "",
    },
    stages: [
      stop("harbor-stage", "stage", {
        version: version("a41c9e2"),
        addresses: [{ service: "app", url: "https://app-harbor-stage.prg1.zerops.app" }],
      }),
    ],
    chip: { label: "prod", state: "down", version: "v2.4.0" },
    since: ago(60 * 24 * 3),
  }),
  // (d) Release failed: v0.1.3 did not go live, production still runs v0.1.2.
  project({
    id: "watchlist",
    name: "Watchlist",
    mates: [mate("raya-w", "Raya", "coral", { time: "40m" })],
    production: {
      kind: "deploy-failed",
      stop: stop("watch-prod", "production", { version: version("v0.1.2"), state: "failed" }),
      line: "",
      candidate: undefined,
    },
    stages: [stop("watch-stage", "stage", { version: version("main") })],
    chip: { label: "prod", state: "failed", version: "v0.1.2" },
    since: ago(60 * 24 * 9),
    merged: {
      by: mate("raya-w", "Raya", "coral"),
      title: "Remember where you stopped",
      at: ago(60),
    },
  }),
  // The line's states stand on their own pages (`?page=line-calm`), never among the cards.
  ...(params.get("page")?.startsWith("line-") === true ? lineProjects() : []),
];

/** A change waiting for the viewer's review, as the flow lists it. */
function toReview(number: number, title: string, mateProjectId: string) {
  return { ...inReview(number, title, mateProjectId), review: true };
}

/** A change that no longer merges cleanly: its Mate's to fix. */
function conflicting(number: number, title: string, mateProjectId: string) {
  const pull: FlowPullRequest = {
    ...change(number, title, mateProjectId),
    mergeability: "conflicting",
  };
  return { ...inReview(number, title, mateProjectId), pull };
}

/**
 * The line's states: (calm) a stage and a production, one change ready; (stuck) a release that did
 * not go live; (busy) ten times the activity and three more places; (notlive) no production yet;
 * (nostage) live without a stage. `line-mine` draws the busy one compact, for one Mate.
 */
function lineProjects(): ReadonlyArray<Project> {
  const busy = project({
    id: "line-busy",
    name: "Tea House",
    mates: [
      mate("wren-b", "Wren", "amber"),
      mate("odo-b", "Odo", "slate"),
      mate("raya-b", "Raya", "olive"),
      mate("tess-b", "Tess", "rose"),
      mate("vale-b", "Vale", "sky"),
      mate("juno-b", "Juno", "violet"),
      mate("fen-b", "Fen", "coral"),
      mate("ines-b", "Ines", "sand"),
      mate("mira-b", "Mira", "olive"),
    ],
    pullRequests: [
      toReview(61, "Sold-out switch remembered across visits", "wren-b"),
      toReview(58, "Gift wrap at checkout", "wren-b"),
      toReview(57, "Tea of the month on the home page", "fen-b"),
      conflicting(55, "A tea quiz for new visitors", "tess-b"),
      conflicting(52, "Prices in three currencies", "juno-b"),
      inReview(60, "A steeping timer on each tea", "odo-b"),
      inReview(59, "Reviews under every tea", "raya-b"),
      inReview(56, "Subscriptions for a monthly box", "vale-b"),
      inReview(54, "A map of where each tea grows", "ines-b"),
      inReview(53, "Stock counts from the warehouse", "mira-b"),
      inReview(51, "Pairings: what to eat with each tea", "odo-b"),
      inReview(50, "A darker look for the evening", "raya-b"),
      inReview(36, "Faster images on tea cards", "vale-b"),
      inReview(35, "Weights in grams and ounces", "ines-b"),
    ],
    notLive: 12,
    production: {
      kind: "ready-to-release",
      stop: stop("busy-prod", "production", {
        version: version("v2.4.0"),
        addresses: [{ service: "app", url: "https://teahouse.example" }],
      }),
      line: "",
      candidate: { tag: "v2.5.0", waiting: 12 },
    },
    stages: [
      stop("busy-stage", "stage", {
        state: "deploying",
        addresses: [{ service: "app", url: "https://app-teahouse-stage.prg1.zerops.app" }],
      }),
      stop("busy-perf", "stage-perf", { state: "failed" }),
      stop("busy-demo", "demo", { version: version("v2.3.1") }),
    ],
    chip: { label: "prod", state: "ok", version: "v2.4.0" },
    since: ago(60 * 24 * 3),
  });
  return [
    project({
      id: "line-calm",
      name: "Pear Studio",
      mates: [mate("milo-c", "Milo", "violet"), mate("kai-c", "Kai", "sky")],
      notLive: 1,
      production: {
        kind: "ready-to-release",
        stop: stop("calm-prod", "production", {
          version: version("v0.1.5"),
          addresses: [{ service: "app", url: "https://pear.studio.example" }],
        }),
        line: "",
        candidate: { tag: "v0.1.6", waiting: 1 },
      },
      stages: [
        stop("calm-stage", "stage", {
          // `&stage=empty` (or `deploying`, `checking`, `failed`): what its station says of it.
          state: (params.get("stage") ?? "deployed") as GroupFlowStop["state"],
          addresses: [{ service: "app", url: "https://app-pear-7c2e.prg1.zerops.app" }],
        }),
      ],
      chip: { label: "prod", state: "ok", version: "v0.1.5" },
      since: ago(60 * 24 * 2),
    }),
    project({
      id: "line-stuck",
      name: "Relay Bot",
      mates: [mate("pia-r", "Pia", "rose")],
      pullRequests: [
        inReview(36, "Answer in the thread it was asked in", "pia-r"),
        inReview(35, "Remember each person's last question", "pia-r"),
        inReview(34, "A daily digest of what was asked", "pia-r"),
        inReview(33, "Quiet hours for the whole team", "pia-r"),
      ],
      notLive: 3,
      production: {
        kind: "deploy-failed",
        stop: stop("stuck-prod", "production", {
          version: version("v0.1.3"),
          state: "failed",
          addresses: [{ service: "bot", url: "https://relay.acme.example" }],
        }),
        line: "",
        candidate: { tag: "v0.1.6", waiting: 3 },
      },
      chip: { label: "prod", state: "failed", version: "v0.1.3" },
      since: ago(60 * 24 * 8),
    }),
    busy,
    project({
      id: "line-notlive",
      name: "Swarm Lab",
      mates: [mate("kara-l", "Kara", "coral")],
      pullRequests: [toReview(5, "Agents hand work to each other", "kara-l")],
      production: { kind: "absent" },
      canPutLive: true,
    }),
    project({
      id: "line-nostage",
      name: "Field Notes",
      mates: [mate("ines-f", "Ines", "olive"), mate("toby-f", "Toby", "amber")],
      pullRequests: [
        conflicting(21, "Notes shared with a link", "toby-f"),
        inReview(20, "Voice notes, written out", "ines-f"),
      ],
      notLive: 2,
      production: {
        kind: "ready-to-release",
        stop: stop("field-prod", "production", {
          version: version("v1.2.0"),
          addresses: [{ service: "app", url: "https://fieldnotes.example" }],
        }),
        line: "",
        candidate: { tag: "v1.3.0", waiting: 2 },
      },
      chip: { label: "prod", state: "ok", version: "v1.2.0" },
      since: ago(60 * 24 * 4),
    }),
  ];
}

const byId = new Map(PROJECTS.map((entry) => [entry.entry.group.groupId, entry]));
const mineOf = (entry: Mate) => entry.owner === NOVA;

/**
 * What waits on the viewer in a project, as the menu's Waiting on you list holds it: each of their
 * Mates that asks, and each with a change in review.
 */
function waitingOf(entry: ProjectsFlowGroup<Mate>): ReadonlyArray<WaitingItem> {
  return [...entry.mates.values()].filter(mineOf).flatMap((each): ReadonlyArray<WaitingItem> => {
    const waiting = {
      projectId: each.id,
      name: each.name,
      tint: each.tint,
      shape: MATE_SHAPE_OF_TINT[each.tint],
      face: each.face,
    };
    const asks = each.view.state === "needs";
    const pull = entry.flow.pullRequests.find((open) => open.pull.mateProjectId === each.id)?.pull;
    if (asks)
      return [
        {
          kind: each.status === "planReady" ? "plan" : "question",
          key: `m:${each.id}`,
          mate: {
            ...waiting,
            kind: each.status === "planReady" ? "plan" : "question",
            ...(each.view.reply?.kind === "words" ? { text: each.view.reply.text } : {}),
          },
        },
      ];
    if (pull === undefined) return [];
    const change = {
      groupId: entry.group.groupId,
      repository: pull.repository,
      number: pull.number,
      title: pull.title,
    };
    return [{ kind: "change", key: `m:${each.id}`, mate: { ...waiting, kind: "change", change } }];
  });
}

/** Who has just arrived, by `?arrival=`: their membership as Zerops stores it. */
const ARRIVAL =
  (
    {
      developer: { roleCode: "NO_ACCESS", canCreateProjects: true },
      guest: { roleCode: "NO_ACCESS", canCreateProjects: false },
    } as Record<string, { roleCode: string; canCreateProjects: boolean }>
  )[params.get("arrival") ?? ""] ?? null;

/**
 * Everything that waits on the viewer, the one list both the menu's count and the overview's tab
 * read: their Mates' asks and changes, then each release a project offers.
 */
const ALL_WAITS: ReadonlyArray<WaitingItem> = [
  ...PROJECTS.flatMap(({ entry }) => waitingOf(entry)),
  ...PROJECTS.flatMap(({ entry }) =>
    cardReady(entry.flow) === undefined
      ? []
      : [
          {
            kind: "release" as const,
            key: `r:${entry.group.groupId}`,
            release: {
              groupId: entry.group.groupId,
              name: entry.group.name,
              ahead: cardReady(entry.flow)?.count,
            },
          },
        ],
  ),
];

/** `?page=tea` (or another project's id) opens on that project's own page instead. */
const FIRST_PAGE = params.get("page");

/**
 * Which of the three pages the harness's router is on: the page its matches hold, which the
 * router commits inside the pages' transition as the app's routes are (its location moves first).
 */
function useHarnessPage(): { readonly project: string | null; readonly place: string | null } {
  const pathname = useRouterState({
    select: (state) => state.matches.at(-1)?.pathname ?? "/zerops",
  });
  const [, at, groupId, last] = pathname.split("/");
  if (at !== "group" || groupId === undefined || last === undefined) {
    return { project: null, place: null };
  }
  return { project: groupId, place: last === "flow" ? null : last };
}

/**
 * A place's page as far as its head — the trail, the title, its line — so the way there and back
 * can be walked; its body is `design-detail.html`'s.
 */
function HarnessPlacePage({
  groupId,
  projectId,
}: {
  readonly groupId: string;
  readonly projectId: string;
}) {
  const entry = PROJECTS.find((each) => each.entry.group.groupId === groupId)?.entry;
  const line =
    entry === undefined
      ? undefined
      : placeLines({ flow: entry.flow, nowMs: NOW }).find((each) => each.projectId === projectId);
  const title = line?.kind === "production" ? "Production" : (line?.name ?? "Stage");
  const trail = usePageTrail({ project: { groupId, name: entry?.group.name }, here: title });
  return (
    <>
      <PageHeader
        summary={line === undefined ? undefined : <PlaceLine density="header" line={line} />}
        title={title}
        trail={trail}
      />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
    </>
  );
}

/** A place's vault, its values the vault fixture's whichever place opened it. */
function harnessVault(place: PlaceVault) {
  return (
    <VaultPanelBody
      actor="environment"
      impactOf={(scope, write) => vaultFixtureImpact(VAULT_FIXTURE, scope, write)}
      onRestart={() => Promise.resolve()}
      onWrite={() => Promise.resolve({ ok: true })}
      pending={new Map()}
      restarting={new Set()}
      view={VAULT_FIXTURE}
      who={{ kind: "environment", name: place.name }}
    />
  );
}

function HarnessPage() {
  const placeVault = usePlaceVaultDrawer("harness", harnessVault);
  const { project: PAGE, place } = useHarnessPage();
  const busy = FIRST_PAGE === "line-mine" ? byId.get("line-busy")?.entry : undefined;
  if (busy !== undefined)
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <HarnessLineMine
          entry={busy}
          mine="wren-b"
          tintOf={(projectId) => busy.mates.get(projectId)?.tint}
        />
      </div>
    );
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU_WIDTH }}>
        {/* The menu's top, its count of what waits on the viewer: the overview's tab counts the same. */}
        <SidebarChiefRow
          current={false}
          onOpen={() => {}}
          waiting={{ items: ALL_WAITS, verbs: { onOpenMate: () => {}, onAskToFix: () => {} } }}
        />
      </aside>
      {/* The page's content region, as the app's frame marks it (`SidebarInset`). */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-background" data-slot="sidebar-inset">
        <div className="flex w-full flex-col gap-6 px-6 pt-6 pb-12">
          {PAGE !== null && place !== null ? (
            <HarnessPlacePage groupId={PAGE} projectId={place} />
          ) : null}
          {PAGE === null ? (
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-medium text-foreground">Overview</h1>
              <Button variant="secondary">New project</Button>
            </div>
          ) : null}
          {PAGE === null ? (
            <OverviewFilters
              mine={PROJECTS.filter(({ entry }) => [...entry.mates.values()].some(mineOf)).length}
              onShow={() => {}}
              ownsMates
              show={undefined}
              waiting={ALL_WAITS.length}
            />
          ) : null}
          {ARRIVAL === null ? null : (
            <ArrivalWelcome
              apps={PROJECTS.slice(0, 1).map(({ entry }) => ({
                groupId: entry.group.groupId,
                name: entry.group.name,
                mine: false,
                addMate: ARRIVAL.canCreateProjects !== false,
              }))}
              onStart={() => {}}
              gateOf={() => null}
              orgId="harness"
              organizationName="Acme"
              painted
              settled
              viewer={ARRIVAL}
            />
          )}
          {place !== null ? null : (
            <ZeropsProjectsFlow<Mate>
              cardPlaces={(entry) => {
                const found = byId.get(entry.group.groupId);
                return {
                  chip: found?.chip,
                  since: found?.since,
                  releaseSince: found?.releaseSince,
                };
              }}
              getKey={(entry) => entry.id}
              groups={overviewOrder(
                PROJECTS.map((entry) => entry.entry),
                (entry) => ({
                  broken: ["down", "failed"].includes(
                    byId.get(entry.group.groupId)?.chip?.state ?? "",
                  ),
                  asks: waitingOf(entry).some((item) => item.kind !== "change"),
                  reviews:
                    waitingOf(entry).some((item) => item.kind === "change") ||
                    entry.flow.production.kind === "ready-to-release",
                }),
              )}
              hqCard={null}
              isMate={() => true}
              onRetryContainers={() => {}}
              openMate={() => () => {}}
              page={
                PAGE === null
                  ? undefined
                  : {
                      groupId: PAGE,
                      render: harnessProjectPage(PAGE, () => acted.push(`add-mate:${PAGE}`)),
                      unread: () => null,
                    }
              }
              renderProductionRun={(entry) =>
                entry.group.groupId === "tea" ? (
                  <PutLiveRow
                    address={undefined}
                    copied={false}
                    nowMs={NOW}
                    onAgain={() => acted.push("run-again")}
                    onCopy={() => {}}
                    onDismiss={() => acted.push("run-dismiss")}
                    onOpenProject={() => {}}
                    run={{
                      orgId: "harness",
                      groupId: "tea",
                      project: "Tea Shop",
                      phase: "releasing",
                      tag: "v0.1.4",
                      stepAt: NOW - 42_000,
                    }}
                  />
                ) : null
              }
              renderEnvironment={() => null}
              renderGroupMenu={(entry) => (
                // Its places' vaults, as the app's card menu offers them.
                <ZeropsProjectMenu
                  actions={placeVaults(entry.flow, NOW).map((vault) => ({
                    id: `vault:${vault.projectId}`,
                    label: `${vault.name} vault`,
                    onSelect: () => placeVault.open?.(vault),
                  }))}
                  label="Project menu"
                />
              )}
              renderMate={(entry, options) => {
                const read = cardMateReading({
                  view: entry.view,
                  status: entry.status,
                  mine: mineOf(entry),
                  review: options.review,
                });
                // On a card its wait stands in Waiting on you: the row is never lifted.
                const reading = options.quiet === true ? { ...read, lift: undefined } : read;
                return (
                  <MateRow
                    actions={
                      reading.lift === undefined ? null : (
                        <CardMateLiftActions
                          lift={reading.lift}
                          name={entry.name}
                          onApprove={() => acted.push(`approve:${entry.id}`)}
                          onFix={() => acted.push(`fix:${entry.id}`)}
                          onReply={(text) => acted.push(`reply:${entry.id}:${text}`)}
                          onReview={() => acted.push(`review:${entry.id}`)}
                          choices={(entry.choices ?? []).map((choice) => ({
                            label: choice,
                            primary: false,
                            onPick: () => acted.push(`pick:${entry.id}:${choice}`),
                          }))}
                        />
                      )
                    }
                    face={<MateFace size={32} state={entry.face} tint={entry.tint} />}
                    key={entry.id}
                    mark={entry.automated === true ? <MateAutomatedMark /> : undefined}
                    name={entry.name}
                    onOpen={() => acted.push(`open:${entry.id}`)}
                    parts={options.parts}
                    reading={reading}
                    time={<MateRowTime dot={entry.view.dot}>{entry.time}</MateRowTime>}
                  />
                );
              }}
              mateTint={(entry) => entry.tint}
              renderMateFace={(entry) => <MateFace size={16} state="idle" tint={entry.tint} />}
              renderReleaseVerb={(entry) =>
                projectReleaseWait(ALL_WAITS, entry.group.groupId) === undefined ? null : (
                  <Button size="sm">Review release</Button>
                )
              }
              // Harbor Radio's production is down and Nell, the viewer's, would fix it; Watchlist's
              // failed release has no Mate of theirs, so its wait opens the place.
              placeFix={(entry) => ({
                fixer: entry.group.groupId === "harbor" ? "Nell" : undefined,
                onVerb: () => acted.push(`fix-place:${entry.group.groupId}`),
              })}
              cardWaits={(entry) =>
                projectWaits({ items: waitingOf(entry), flow: entry.flow }).map((wait) => ({
                  wait,
                  face: <MateFace size={24} state={wait.mate.face} tint={wait.mate.tint} />,
                  onVerb: () => acted.push(`wait:${wait.key}`),
                }))
              }
              setUpProduction={(entry) =>
                byId.get(entry.group.groupId)?.canPutLive === true
                  ? () => acted.push(`put-live:${entry.group.groupId}`)
                  : undefined
              }
              addMate={(entry) => ({
                onAdd: () => acted.push(`add-mate:${entry.group.groupId}`),
                why: null,
              })}
              openPlaceVault={placeVault.open}
              ungrouped={[]}
            />
          )}
          {placeVault.drawer}
        </div>
      </main>
    </div>
  );
}

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
// A router of its own with the app's three pages, so a card's name, a place's line and a crumb go
// where they go in the app, by the app's own transition (`pagesViewTransition`).
const rootRoute = createRootRoute({ component: HarnessPage });
const router = createRouter({
  routeTree: rootRoute.addChildren(
    ["/zerops", "/group/$groupId/flow", "/group/$groupId/$projectId"].map((path) =>
      createRoute({ getParentRoute: () => rootRoute, path }),
    ),
  ),
  history: createMemoryHistory({
    initialEntries: [FIRST_PAGE === null ? "/zerops" : `/group/${FIRST_PAGE}/flow`],
  }),
  ...pagesViewTransition(),
}) as unknown as AppRouter;
Object.assign(window, { __overviewRouter: router });
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
