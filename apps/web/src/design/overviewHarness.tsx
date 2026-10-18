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
import { ChevronRightIcon, EllipsisIcon } from "lucide-react";
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ArrivalWelcome } from "~/components/zerops/projects/ArrivalWelcome";
import { MateFace, PersonAvatar } from "~/components/zerops/primitives";
import type { MateRowView } from "~/components/zerops/SidebarMateRow.logic";
import type { ProductionChip } from "~/components/zerops/SidebarProductionChip.logic";
import { PlacePanel, type PlacePanelModel } from "~/components/zerops/projects/PlacePanel";
import { RoadPlace, ServiceTiles } from "~/components/zerops/projects/RoadPlace";
import type { ZeropsServiceRow } from "@t3tools/client-runtime/zerops/serviceMap";
import {
  CardActivity,
  CardMate,
  CardMateLiftActions,
  CardMateTime,
} from "~/components/zerops/projects/ProjectCards";
import {
  cardMateReading,
  cardPeople,
  releaseLineOpens,
  unlifted,
} from "~/components/zerops/projects/projectCard.logic";
import {
  ZeropsProjectsFlow,
  type ProjectsFlowGroup,
} from "~/components/zerops/projects/ZeropsProjectsFlow";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { placeAddresses, withPlaceAddresses } from "~/zerops/__fixtures__/placeAddresses";
import "../index.css";
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
  readonly stageSince?: string;
  readonly failedTag?: string;
  readonly waitsOnYou: boolean;
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
  readonly stageSince?: string;
  readonly failedTag?: string;
  readonly waitsOnYou?: boolean;
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
    ...(input.stageSince === undefined ? {} : { stageSince: input.stageSince }),
    ...(input.failedTag === undefined ? {} : { failedTag: input.failedTag }),
    ...(input.merged === undefined ? {} : { merged: input.merged }),
    waitsOnYou: input.waitsOnYou ?? false,
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

/** A service as the service map reads it, its use and its last day made up. */
const tileRow = (hostname: string, typeShort: string): ZeropsServiceRow => {
  const trend = Array.from({ length: 24 }, (_, hour) => ({
    at: ago((24 - hour) * 60),
    used: 0.2 + 0.15 * Math.sin(hour / 2.5) + (hour % 7 === 0 ? 0.2 : 0),
    limit: 1,
  }));
  return {
    isControlPlane: false,
    service: { serviceId: hostname, hostname } as ZeropsServiceRow["service"],
    tone: "ok",
    statusLabel: "Running",
    statusNeedsWord: false,
    typeLabel: typeShort,
    typeShort,
    title: hostname,
    portLabel: hostname === "db" ? ":5432" : ":3000",
    meta: [],
    dashboardUrl: "",
    metrics: [
      { id: "cores", label: "CPU", value: "1", used: "0.2", unit: "core", fraction: 0.2 },
      { id: "memory", label: "RAM", value: "1", used: "0.4", unit: "GB", fraction: 0.4 },
      { id: "disk", label: "Disk", value: "5", used: "1.1", unit: "GB", fraction: 0.22 },
    ],
    trends: { cores: trend, memory: trend, disk: trend },
  } as unknown as ZeropsServiceRow;
};

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
    waitsOnYou: true,
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
        flow: { previews: [{ service: "app", url: "https://raya-teashop-c3d4.prg1.zerops.app" }] },
      },
      working("vera-t", "Vera", "amber", "Tea of the month email", "11m"),
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
    stageSince: ago(25),
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
    stageSince: ago(60),
    failedTag: "v0.1.3",
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
              const stageId = entry.flow.stages[0]?.projectId;
              return {
                chip: found?.chip,
                since: found?.since,
                failedTag: found?.failedTag,
                stageSince:
                  stageId === undefined || found?.stageSince === undefined
                    ? undefined
                    : new Map([[stageId, found.stageSince]]),
              };
            }}
            getKey={(entry) => entry.id}
            groups={PROJECTS.map((entry) => entry.entry)}
            hqCard={null}
            isAutomated={(entry) => entry.automated === true}
            isMate={() => true}
            onRetryContainers={() => {}}
            openMate={() => () => {}}
            page={
              PAGE === null
                ? undefined
                : {
                    groupId: PAGE,
                    aside: null,
                    onAddMate: () => acted.push(`add-mate:${PAGE}`),
                    unread: null,
                  }
            }
            renderActivity={(entry) => {
              const merged = byId.get(entry.group.groupId)?.merged;
              return merged === undefined ? null : (
                <CardActivity
                  at={merged.at}
                  face={<MateFace size={16} state="idle" tint={merged.by.tint} />}
                  nowMs={NOW}
                  onOpen={() => acted.push(`activity:${entry.group.groupId}`)}
                  words={`${merged.by.name} merged “${merged.title}”`}
                />
              );
            }}
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
              const read = cardMateReading({
                view: entry.view,
                status: entry.status,
                mine: mineOf(entry),
                review: options.review,
              });
              const reading = options.lift === false ? unlifted(read) : read;
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
                  name={entry.name}
                  onOpen={() => acted.push(`open:${entry.id}`)}
                  previews={options.previews}
                  reading={reading}
                  time={<CardMateTime dot={entry.view.dot}>{entry.time}</CardMateTime>}
                />
              );
            }}
            renderMateFace={(entry) => <MateFace size={16} state="idle" tint={entry.tint} />}
            renderPlacePanel={(entry, line, look) => {
              const found = byId.get(entry.group.groupId);
              const model = found?.panels[line.kind];
              if (found === undefined || model === undefined) return null;
              if (look === "column" || look === "detail")
                return (
                  <RoadPlace
                    actions={(found.actions[line.kind] ?? []).map((label, index) => (
                      <Button
                        key={label}
                        size="sm"
                        variant={index === 0 && line.trouble ? "primary" : "secondary"}
                      >
                        {label}
                      </Button>
                    ))}
                    model={{
                      line,
                      version: line.kind === "production" ? model.version : undefined,
                      released:
                        line.kind === "production" ? "Released 6d ago by Nova Dev" : undefined,
                      up: line.kind === "production" ? "6d" : undefined,
                      services: model.services.length,
                      address:
                        line.kind === "production" && line.addresses[0] !== undefined
                          ? { host: "teashop-a1b2.prg1.zerops.app", url: line.addresses[0].url }
                          : undefined,
                      follows:
                        line.kind === "stage" ? "follows main · deployed 25m ago" : undefined,
                      note: line.trouble ? model.note : undefined,
                    }}
                    tiles={
                      <ServiceTiles
                        rows={model.services.map((service, index) =>
                          tileRow(service.hostname, index === 0 ? "Node.js 22" : "PostgreSQL 16"),
                        )}
                        usageRead
                      />
                    }
                  />
                );
              return inAccount(
                <PlacePanel
                  groupId={entry.group.groupId}
                  look={look}
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
            renderReleaseVerb={(_entry, chip) => (
              <Button size="sm" variant="secondary">
                {chip.label}
                <ChevronRightIcon aria-hidden="true" />
              </Button>
            )}
            setUpProduction={(entry) =>
              byId.get(entry.group.groupId)?.canPutLive === true
                ? () => acted.push(`put-live:${entry.group.groupId}`)
                : undefined
            }
            setUpStage={() => () => acted.push("add-stage")}
            waitsOnYou={(entry) => byId.get(entry.group.groupId)?.waitsOnYou === true}
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
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <HarnessPage />
  </StrictMode>,
);
