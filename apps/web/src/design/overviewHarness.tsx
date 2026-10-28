/**
 * The overview: the project cards side by side, from made-up projects in the four states the
 * project-page board draws — (a) setting up, (b) needs you, (c) running, (d) release failed.
 * `?page=tea` (or `watchlist`, …) draws that project's own page: its header and its road.
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
import type { AddressDomain, PlaceAddresses } from "@t3tools/client-runtime/data";
import { mateParts } from "@t3tools/client-runtime/zerops/mateParts";
import { EllipsisIcon } from "lucide-react";
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import type { AppRouter } from "~/router";
import { createRoot } from "react-dom/client";

import { ArrivalWelcome } from "~/components/zerops/projects/ArrivalWelcome";
import { PutLiveRow } from "~/components/zerops/ProductionRun";
import { MateFace, PersonAvatar } from "~/components/zerops/primitives";
import type { MateRowView } from "~/components/zerops/SidebarMateRow.logic";
import type { ProductionChip } from "~/components/zerops/SidebarProductionChip.logic";
import { PlacePanel, type PlacePanelModel } from "~/components/zerops/projects/PlacePanel";
import { MateAutomatedMark } from "~/components/zerops/MateAutomatedMark";
import {
  CardChanges,
  CardMate,
  CardMateLiftActions,
  CardMateTime,
} from "~/components/zerops/projects/ProjectCards";
import {
  CARD_CHANGES,
  cardChanges,
  cardMateReading,
  cardPeople,
  releaseLineOpens,
} from "~/components/zerops/projects/projectCard.logic";
import {
  ZeropsProjectsFlow,
  type ProjectsFlowGroup,
} from "~/components/zerops/projects/ZeropsProjectsFlow";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { placeAddresses, withPlaceAddresses } from "~/zerops/__fixtures__/placeAddresses";
import "../index.css";
import { ProjectPageAside, ProjectPagePeople } from "./projectPageFixtures";
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
  readonly panels: Partial<Record<"stage" | "production", Omit<PlacePanelModel, "line">>>;
  readonly actions: Partial<Record<"stage" | "production", ReadonlyArray<string>>>;
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
  readonly panels?: Project["panels"];
  readonly actions?: Project["actions"];
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
    panels: input.panels ?? {},
    actions: input.actions ?? {},
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

const panel = (over: Partial<Omit<PlacePanelModel, "line">>): Omit<PlacePanelModel, "line"> => ({
  version: undefined,
  note: undefined,
  brought: [],
  services: [],
  ...over,
});

/** A place's addresses as read: its own domains, and each service's zerops.app address. */
const readPlace = (
  domains: ReadonlyArray<AddressDomain>,
  services: ReadonlyArray<string>,
): PlaceAddresses => ({
  ...placeAddresses([]),
  domains,
  zerops: services.map((service) => ({
    serviceId: service,
    serviceName: service,
    on: true,
    hosts: [
      {
        port: 3000,
        url: `https://teashop-a1b2.prg1.zerops.app`,
        host: `teashop-a1b2.prg1.zerops.app`,
      },
    ],
    port: 3000,
  })),
});

/** Tea Shop's production has no domain of its own yet: Put it on your domain. */
const inAccount = withPlaceAddresses({ "tea-prod": readPlace([], ["app"]) });

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

/** Acme Store's production: six services, one of them storage. */
const STORE_SERVICES: ReadonlyArray<readonly [string, string, string]> = [
  ["app", "Node.js 22", "nodejs@22"],
  ["api", "Node.js 22", "nodejs@22"],
  ["worker", "Node.js 22", "nodejs@22"],
  ["db", "PostgreSQL 16", "postgresql@16"],
  ["cache", "Valkey 7", "valkey@7.2"],
  ["files", "Object storage", "objectstorage"],
];

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
  // (b) Needs you: Juno asks, Raya works, Vera is free; merged work waits for production.
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
      mate("vera", "Vera", "violet", { owner: INES, time: "1h" }),
    ],
    production: { kind: "absent" },
    notLive: 4,
    canPutLive: true,
    merged: {
      by: mate("vera", "Vera", "violet"),
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
        ...working("vera-t", "Vera", "amber", "Tea of the month email", "11m"),
        flow: partsOf(["api", "edge", "embedder", "geo", "runner", "site", "web"], "vera-tea"),
      },
      {
        ...working("odo", "Odo", "slate", "#42 Prices round wrong in the cart", "12m"),
        automated: true,
      },
      { ...mate("tess", "Tess", "rose", { owner: INES }), automated: true },
    ],
    pullRequests: [
      inReview(51, "Gift cards at checkout", "raya-t"),
      inReview(52, "Tea of the month banner", "vera-t"),
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
    merged: { by: mate("vera-t", "Vera", "amber"), title: "Prices per 100 g", at: ago(25) },
    panels: {
      stage: panel({
        services: [
          { hostname: "app", state: "up" },
          { hostname: "db", state: "up" },
        ],
      }),
      production: panel({
        version: "v0.1.3",
        services: [
          { hostname: "app", state: "up" },
          { hostname: "db", state: "up" },
        ],
      }),
    },
    actions: { production: ["Roll back to v0.1.2"] },
  }),
  // (e) Many places: production runs six services, three stages each follow their own source.
  project({
    id: "acme-store",
    name: "Acme Store",
    mates: [
      { ...JUNO_ASKS, id: "juno-s", view: { ...JUNO_ASKS.view, ask: "Checkout" } },
      mate("mira-s", "Mira", "amber", { time: "2h" }),
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
    pullRequests: [inReview(71, "One-page checkout", "juno-s")],
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
      by: mate("mira-s", "Mira", "amber"),
      title: "Gift cards at checkout",
      at: ago(60 * 5),
    },
    panels: {
      stage: panel({
        services: [
          { hostname: "app", state: "up" },
          { hostname: "db", state: "up" },
        ],
      }),
      production: panel({
        version: "v0.1.59",
        services: STORE_SERVICES.map(([hostname]) => ({ hostname, state: "up" as const })),
      }),
    },
    actions: { production: ["Roll back to v0.1.58"] },
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
    panels: {
      production: panel({ version: "v0.1.1", services: [{ hostname: "app", state: "up" }] }),
    },
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
    name: "Flip Studio",
    mates: [mate("filip", "Filip", "sky", { time: "12m" })],
    production: {
      kind: "empty",
      stop: stop("flip-prod", "production", { state: "empty" }),
      line: "",
    },
    stages: [stop("flip-stage", "stage", { state: "empty" })],
    chip: { label: "prod", state: "empty" },
    panels: {
      production: panel({
        services: [
          { hostname: "db", state: "up" },
          { hostname: "flip", state: "idle" },
        ],
      }),
      stage: panel({
        services: [
          { hostname: "db", state: "up" },
          { hostname: "flip", state: "idle" },
        ],
      }),
    },
    actions: { production: ["History"] },
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
    panels: {
      stage: panel({ services: [{ hostname: "app", state: "up" }] }),
      production: panel({
        version: "v0.1.2",
        note: {
          text: "v0.1.3 did not go live: the build stopped at npm run build. Production keeps running v0.1.2.",
          tone: "attention",
        },
        services: [{ hostname: "app", state: "up" }],
      }),
    },
    actions: { production: ["Ask Raya to fix it", "Open logs"] },
  }),
];

const byId = new Map(PROJECTS.map((entry) => [entry.entry.group.groupId, entry]));
const mineOf = (entry: Mate) => entry.owner === NOVA;

/** Who has just arrived, by `?arrival=`: their membership as Zerops stores it. */
const ARRIVAL =
  (
    {
      developer: { roleCode: "NO_ACCESS", canCreateProjects: true },
      guest: { roleCode: "NO_ACCESS", canCreateProjects: false },
    } as Record<string, { roleCode: string; canCreateProjects: boolean }>
  )[params.get("arrival") ?? ""] ?? null;

/** `?page=tea` (or another project's id) draws that project's own page instead. */
const PAGE = params.get("page");

function HarnessPage() {
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU_WIDTH }} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-6 px-6 pt-6 pb-12">
          {PAGE === null ? (
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-medium text-foreground">Overview</h1>
              <Button variant="secondary">New project</Button>
            </div>
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
            groups={PROJECTS.map((entry) => entry.entry)}
            hqCard={null}
            isMate={() => true}
            onRetryContainers={() => {}}
            openMate={() => () => {}}
            page={
              PAGE === null
                ? undefined
                : {
                    groupId: PAGE,
                    aside: <ProjectPageAside groupId={PAGE} />,
                    people: <ProjectPagePeople />,
                    onAddMate: () => acted.push(`add-mate:${PAGE}`),
                    unread: null,
                  }
            }
            renderChanges={(entry) => {
              const found = byId.get(entry.group.groupId);
              const live =
                entry.flow.production.kind === "absent" ||
                entry.flow.production.kind === "unread" ||
                entry.flow.production.kind === "creating"
                  ? undefined
                  : entry.flow.production.stop.version?.label;
              const merged =
                found?.merged === undefined
                  ? []
                  : [
                      {
                        ...change(40, found.merged.title, found.merged.by.id),
                        merged: true,
                        mergedAt: found.merged.at,
                      },
                    ];
              return (
                <CardChanges
                  changes={cardChanges({
                    open: entry.flow.pullRequests.map((pull) => pull.pull),
                    merged,
                    releases: [],
                    stage: undefined,
                    production: live !== undefined,
                    limit: CARD_CHANGES,
                  })}
                  face={(projectId) => {
                    const owner = entry.mates.get(projectId);
                    return owner === undefined ? undefined : (
                      <MateFace size={16} state="idle" tint={owner.tint} />
                    );
                  }}
                  mateName={(projectId) => entry.mates.get(projectId)?.name}
                  onOpen={(opened) => acted.push(`change:${String(opened.pull.number)}`)}
                  releases={
                    // On its page the project's History says its releases.
                    live === undefined || PAGE !== null
                      ? []
                      : [{ tag: live, taggedAt: ago(60 * 24 * 6), live: true }]
                  }
                />
              );
            }}
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
            renderCardPeople={(entry) => {
              const people = cardPeople([...entry.mates.values()].map((value) => value.owner));
              return people.length === 0 ? null : (
                <span className="ov-card-people">
                  {people.map((person) => (
                    <PersonAvatar key={person.userId} name={person.name} size={20} />
                  ))}
                </span>
              );
            }}
            renderEnvironment={() => null}
            renderGroupMenu={() => (
              <Button aria-label="Project menu" size="icon-sm" variant="ghost">
                <EllipsisIcon />
              </Button>
            )}
            renderMate={(entry, options) => {
              const reading = cardMateReading({
                view: entry.view,
                status: entry.status,
                mine: mineOf(entry),
                review: options.review,
              });
              return (
                <CardMate
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
                  time={<CardMateTime dot={entry.view.dot}>{entry.time}</CardMateTime>}
                />
              );
            }}
            renderMateFace={(entry) => <MateFace size={16} state="idle" tint={entry.tint} />}
            renderPlacePanel={(entry, line) => {
              const found = byId.get(entry.group.groupId);
              const model = found?.panels[line.kind];
              if (found === undefined || model === undefined) return null;
              return inAccount(
                <PlacePanel
                  groupId={entry.group.groupId}
                  actions={(found.actions[line.kind] ?? []).map((label, index) => (
                    <Button
                      key={label}
                      size="sm"
                      variant={index === 0 && line.trouble ? "primary" : "secondary"}
                    >
                      {label}
                    </Button>
                  ))}
                  model={{ ...model, line }}
                  onOpenLine={
                    releaseLineOpens(line, entry.flow.production, undefined) === undefined
                      ? undefined
                      : () => acted.push(`open-release:${entry.group.groupId}`)
                  }
                  roomy={PAGE !== null}
                />,
              );
            }}
            renderReleaseVerb={() => <Button>Review release</Button>}
            setUpProduction={(entry) =>
              byId.get(entry.group.groupId)?.canPutLive === true
                ? () => acted.push(`put-live:${entry.group.groupId}`)
                : undefined
            }
            setUpStage={() => () => acted.push("add-stage")}
            addMate={(entry) => ({
              onAdd: () => acted.push(`add-mate:${entry.group.groupId}`),
              why: null,
            })}
            ungrouped={[]}
          />
        </div>
      </main>
    </div>
  );
}

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
// A router of its own, so a card's name opens its project's page as it does in the app.
const router = createRouter({
  routeTree: createRootRoute({ component: HarnessPage }),
  history: createMemoryHistory({ initialEntries: ["/"] }),
}) as unknown as AppRouter;
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
