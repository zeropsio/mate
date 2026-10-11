/**
 * The overview (round 5, "Mate Clean Overview"): the project cards side by side, from made-up
 * projects in the six states the board draws — quiet, waiting on you, trouble, releasing, busy and
 * new — then the projects without a Mate as lines and HQ's quiet line.
 *
 * Served by the dev server at `/design-overview.html` (`?theme=dark`). It stands beside a blank
 * left menu at the owner's 435 px; open it at 1786 × 1000. A place's line opens its panel; a
 * lifted Mate's buttons say what they would do in `window.__overviewHarness.acted`.
 *
 * Fixtures only. Nothing here ships — `design-overview.html` is not `index.html`, and no route
 * imports this module.
 */
import type {
  FlowPullRequest,
  GroupFlow,
  GroupFlowAddress,
  GroupFlowMate,
  GroupFlowProduction,
  GroupFlowStop,
  ZeropsGroup,
} from "@t3tools/client-runtime/zerops";
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Avatar, MateFace } from "~/components/zerops/primitives";
import type { MateRowView } from "~/components/zerops/SidebarMateRow.logic";
import type { ProductionChip } from "~/components/zerops/SidebarProductionChip.logic";
import { PlacePanel, type PlacePanelModel } from "~/components/zerops/projects/PlacePanel";
import {
  CardMate,
  CardMateLiftActions,
  CardMateTime,
} from "~/components/zerops/projects/ProjectCards";
import { cardMateReading, cardPeople } from "~/components/zerops/projects/projectCard.logic";
import {
  ZeropsProjectsFlow,
  type ProjectsFlowGroup,
} from "~/components/zerops/projects/ZeropsProjectsFlow";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

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
const ADA: Person = { userId: "ada", name: "Ada", initials: "AL" };
const KAREL: Person = { userId: "karel", name: "Karel", initials: "KN" };
const JAN: Person = { userId: "jan", name: "Jan", initials: "JS" };

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
  readonly flow?: Partial<GroupFlowMate>;
  /** A question's options, answered in place. */
  readonly choices?: ReadonlyArray<string>;
}

const words = (text: string, tone: "muted" | "ink" | "failed" = "muted") =>
  ({ kind: "words", text, tone }) as const;

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
    owner: ADA,
    ...over,
  };
}

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
  readonly down?: ReadonlyArray<string>;
  readonly panel: Omit<PlacePanelModel, "line">;
  readonly actions: ReadonlyArray<string>;
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
  readonly down?: ReadonlyArray<string>;
  readonly panel?: Partial<Omit<PlacePanelModel, "line">>;
  readonly actions?: ReadonlyArray<string>;
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
    ...(input.down === undefined ? {} : { down: input.down }),
    panel: {
      version: undefined,
      note: undefined,
      brought: [],
      services: [],
      ...input.panel,
    },
    actions: input.actions ?? [],
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

const live = (
  projectId: string,
  label: string,
  addresses: ReadonlyArray<GroupFlowAddress> = [],
): GroupFlowProduction => ({
  kind: "live",
  stop: stop(projectId, "production", { version: version(label), addresses }),
  line: label,
});

const PROJECTS: ReadonlyArray<Project> = [
  // Quiet: one Mate resting, one change ready to release, production running.
  project({
    id: "tea",
    name: "Tea Shop",
    mates: [
      mate("sage", "Sage", "amber", {
        view: {
          state: "idle",
          ask: "Save for later",
          reply: words("The cart page is live on stage."),
          dot: undefined,
        },
      }),
      mate("rhea", "Rhea", "rose", {
        face: "needs",
        status: "input",
        time: "1h",
        choices: ["Stripe", "Adyen"],
        view: {
          state: "needs",
          ask: "Payments",
          reply: words("Stripe or Adyen? Adyen needs a merchant account first.", "ink"),
          dot: "attention",
        },
      }),
    ],
    production: {
      kind: "ready-to-release",
      stop: stop("tea-prod", "production", {
        version: version("v2.4.0"),
        addresses: [{ service: "app", url: "https://shop.acme.com" }],
      }),
      line: "",
      candidate: { tag: "v2.5.0", waiting: 1 },
    },
    stages: [stop("tea-stage", "stage", { version: version("main 77ab0e1") })],
    notLive: 1,
    since: ago(60 * 24 * 2),
    panel: {
      version: "v2.4.0",
      brought: [{ key: "1", title: "#12 Gift cards at checkout", by: "Sage" }],
      services: [
        { hostname: "app", state: "up" },
        { hostname: "db", state: "up" },
      ],
    },
    actions: ["Roll back to v2.3.1", "History"],
  }),
  // Waiting on you: Wren's plan.
  project({
    id: "docs",
    name: "Docs Site",
    mates: [
      mate("wren", "Wren", "violet", {
        face: "needs",
        status: "planReady",
        time: "12m",
        view: {
          state: "needs",
          ask: "Faster search",
          reply: words("Plan: move search into its own service, in 4 steps. Go ahead?", "ink"),
          dot: "attention",
        },
      }),
    ],
    production: live("docs-prod", "v0.12.0", [{ service: "web", url: "https://docs.acme.com" }]),
    since: ago(60 * 24 * 3),
    panel: {
      version: "v0.12.0",
      services: [{ hostname: "web", state: "up" }],
    },
    actions: ["Roll back to v0.11.4", "History"],
  }),
  // Trouble: a release failed, production still runs the one before; Milo's change waits.
  project({
    id: "ledger",
    name: "Ledger API",
    mates: [
      mate("noibit", "Noibit", "olive", {
        face: "working",
        status: "working",
        time: "18:40",
        view: {
          state: "working",
          ask: "Nightly invoice export",
          reply: { kind: "live", words: "Ivy reviews the schema while Ash writes the job…" },
          dot: undefined,
        },
      }),
      mate("milo", "Milo", "sky", {
        owner: JAN,
        time: "6m",
        view: {
          state: "needs",
          ask: "Rate limit the public API",
          reply: words("Rate limiting is in. #30 is ready for review.", "ink"),
          dot: "unread",
        },
      }),
    ],
    pullRequests: [
      {
        pull: change(30, "Rate limit the public API", "milo"),
        blocked: null,
        state: undefined,
        review: true,
      },
    ],
    production: live("ledger-prod", "v1.8.2", [
      { service: "api", url: "https://api.acme.com" },
      { service: "web", url: "https://ledger.acme.com" },
    ]),
    chip: { label: "prod", state: "failed", version: "v1.8.2" },
    panel: {
      version: "v1.8.2",
      note: {
        text: "Release v1.9.0 failed 14 min ago: health check timed out. v1.8.2 is still serving.",
        tone: "attention",
      },
      services: [
        { hostname: "api", state: "up" },
        { hostname: "web", state: "up" },
        { hostname: "db", state: "up" },
        { hostname: "cache", state: "up" },
      ],
    },
    actions: ["Ask Noibit to fix it", "Open logs"],
  }),
  // Trouble without production: the stage is down, Fen's build failed.
  project({
    id: "mobile",
    name: "Mobile App",
    mates: [
      mate("fen", "Fen", "coral", {
        time: "25m",
        status: "failed",
        view: {
          state: "failed",
          ask: "Push builds",
          reply: words("The stage build failed: EXPO_TOKEN is missing.", "failed"),
          dot: "failed",
        },
      }),
    ],
    production: { kind: "absent" },
    stages: [stop("mobile-stage", "stage", { state: "failed" })],
    panel: { note: { text: "Down: app failed on the platform.", tone: "failed" } },
    actions: ["Ask Fen to fix it", "Open logs"],
  }),
  // Releasing: production's line runs until the new version is in.
  project({
    id: "guides",
    name: "Guides",
    mates: [
      mate("ivy", "Ivy", "rose", {
        time: "1d",
        view: {
          state: "idle",
          ask: "Search",
          reply: words("Search answers in 40 ms now."),
          dot: undefined,
        },
      }),
    ],
    production: {
      kind: "releasing",
      stop: stop("guides-prod", "production", {
        version: version("v0.13.2"),
        addresses: [{ service: "app", url: "https://guides.acme.com" }],
      }),
      line: "",
      tag: "v0.14.0",
    },
    panel: { version: "v0.13.2", note: undefined },
  }),
  // Busy: six Mates, the quiet ones fold past four; three people on it.
  project({
    id: "agency",
    name: "Agency Site",
    mates: [
      mate("ivo", "Ivo", "slate", {
        face: "working",
        status: "working",
        time: "12:40",
        view: {
          state: "working",
          ask: "Hero",
          reply: { kind: "live", words: "Building the hero section…" },
          dot: undefined,
        },
      }),
      mate("lena", "Lena", "sky", {
        owner: KAREL,
        time: "40m",
        status: "input",
        view: {
          state: "needs",
          ask: "Hero picture",
          reply: words("Waits on Karel · The red bike or the mountain one?"),
          dot: undefined,
        },
      }),
      mate("otto", "Otto", "olive", {
        time: "3h",
        view: {
          state: "idle",
          ask: "Sitemap",
          reply: words("The sitemap covers every client page now."),
          dot: undefined,
        },
      }),
      mate("rex", "Rex", "coral", {
        time: "8m",
        owner: JAN,
        view: {
          state: "needs",
          ask: "Banner",
          reply: words("The banner is done. #41 is ready for review.", "ink"),
          dot: "unread",
        },
      }),
      mate("uma", "Uma", "violet", { time: "2d" }),
      mate("kai", "Kai", "amber", { time: "5d" }),
    ],
    pullRequests: [
      { pull: change(41, "Spring banner", "rex"), blocked: null, state: undefined, review: true },
    ],
    production: live("agency-prod", "v4.2.0", [{ service: "app", url: "https://acme-agency.com" }]),
    since: "2026-09-28T09:00:00Z",
    panel: { version: "v4.2.0" },
    actions: ["Roll back to v4.1.3", "History"],
  }),
  // New: its first Mate on its way, nothing released yet.
  project({
    id: "booking",
    name: "Booking App",
    mates: [],
    coming: [
      {
        projectId: "vera",
        name: "Vera",
        previews: [],
        waiting: false,
        talked: false,
        coming: { face: { tint: "sand", shape: undefined } as never },
      },
    ],
    production: { kind: "absent" },
  }),
];

const OTHERS: ReadonlyArray<Project> = [
  project({
    id: "brand",
    name: "Brand Site",
    mates: [],
    production: live("brand-prod", "v1.2.0"),
    since: "2026-09-18T09:00:00Z",
  }),
  project({
    id: "tools",
    name: "Internal Tools",
    mates: [],
    production: {
      kind: "releasing",
      stop: stop("tools-prod", "production", { version: version("v0.4.9") }),
      line: "",
      tag: "v0.5.0",
    },
  }),
];

const byId = new Map([...PROJECTS, ...OTHERS].map((entry) => [entry.entry.group.groupId, entry]));
const mineOf = (entry: Mate) => entry.owner === ADA;

function HarnessPage() {
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU_WIDTH }} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-6 px-6 pt-6 pb-12">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-medium text-foreground">Overview</h1>
            <button className="ov-btn" type="button">
              New project
            </button>
          </div>
          <ZeropsProjectsFlow<Mate>
            cardPlaces={(entry) => {
              const found = byId.get(entry.group.groupId);
              const prodId =
                "stop" in entry.flow.production ? entry.flow.production.stop.projectId : "";
              return {
                chip: found?.chip,
                since: found?.since,
                down: new Map([[prodId, found?.down ?? ["app"]]]),
              };
            }}
            getKey={(entry) => entry.id}
            groups={[...PROJECTS, ...OTHERS].map((entry) => entry.entry)}
            hqCard={
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <i className="ov-dot" data-dot="running" />
                <b className="font-medium text-foreground">HQ</b>· Running · last backup 02:00 · 8
                Mates online · Up to date
              </p>
            }
            isMate={() => true}
            onRetryContainers={() => {}}
            openMate={() => () => {}}
            renderCardPeople={(entry) => {
              const people = cardPeople([...entry.mates.values()].map((value) => value.owner));
              return people.length === 0 ? null : (
                <span className="ov-card-people">
                  {people.map((person) => (
                    <Avatar
                      className="size-5 text-3xs"
                      initials={person.initials}
                      key={person.userId}
                      size="xs"
                    />
                  ))}
                </span>
              );
            }}
            renderEnvironment={() => null}
            renderGroupMenu={() => null}
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
                  face={
                    <MateFace className="size-8" size="md" state={entry.face} tint={entry.tint} />
                  }
                  key={entry.id}
                  name={entry.name}
                  onOpen={() => acted.push(`open:${entry.id}`)}
                  reading={reading}
                  time={<CardMateTime dot={entry.view.dot}>{entry.time}</CardMateTime>}
                />
              );
            }}
            renderMateFace={(entry) => (
              <MateFace className="size-4" size="sm" state="idle" tint={entry.tint} />
            )}
            renderPlacePanel={(entry, line) => {
              const found = byId.get(entry.group.groupId);
              if (found === undefined) return null;
              return (
                <PlacePanel
                  actions={found.actions.map((label, index) => (
                    <button
                      className="ov-btn"
                      data-main={index === 0 ? "true" : undefined}
                      key={label}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                  model={{ ...found.panel, line }}
                />
              );
            }}
            renderReleaseVerb={() => (
              <button className="ov-btn" data-main="true" type="button">
                Review release
              </button>
            )}
            ungrouped={[]}
          />
        </div>
      </main>
    </div>
  );
}

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <HarnessPage />
  </StrictMode>,
);
