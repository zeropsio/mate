/**
 * The pages' shared parts (`components/zerops/system`), each in each density and state, with
 * invented fixtures, on the surfaces they stand on: a card's column, a page's column, a panel.
 *
 * Served by the dev server at `/design-system-parts.html` (`?theme=dark` for dark). Fixtures
 * only: nothing here ships, and no route imports this module.
 */
import type { StopServiceRow } from "@t3tools/client-runtime/zerops/flow";
import type { ZeropsServiceRow } from "@t3tools/client-runtime/zerops/serviceMap";
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "~/components/ui/button";
import { MenuItem } from "~/components/ui/menu";
import { MateFace } from "~/components/zerops/primitives";
import { pull } from "~/components/zerops/projects/flowTestFixtures";
import type {
  CardReady,
  PlaceLine as PlaceLineData,
} from "~/components/zerops/projects/projectCard.logic";
import { placeServiceRows } from "~/components/zerops/place/place.logic";
import {
  ChangeList,
  ChangeRow,
  changeRowLine,
  MateRow,
  MateRowTime,
  NextBlock,
  NextRelease,
  PageHeader,
  PlaceLine,
  SectionAction,
  SectionLabel,
  ServiceList,
  ServiceRow,
  type Crumb,
} from "~/components/zerops/system";
import type { ReleaseOffer } from "~/components/zerops/ZeropsReleaseVerb";
import type { AppRouter } from "~/router";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const GROUP = "grp-acme";

const acted: Array<string> = [];
Object.assign(window, { __systemPartsHarness: { acted } });

// ---- places ------------------------------------------------------------------------------------

const place = (over: Partial<PlaceLineData>): PlaceLineData => ({
  projectId: "prj-prod",
  kind: "production",
  name: "prod",
  dot: "running",
  words: ["Running", "v0.1.3", "since Nov 1"],
  trouble: false,
  addresses: [{ service: "app", url: "https://teashop.example" }],
  ...over,
});

const PLACES: ReadonlyArray<{ readonly label: string; readonly line: PlaceLineData }> = [
  { label: "Running", line: place({}) },
  {
    label: "Release failed",
    line: place({ dot: "failed", words: ["Release failed", "still runs v0.1.3"], trouble: true }),
  },
  {
    label: "Down",
    line: place({ dot: "down", words: ["Down", "app and db failed"], trouble: true }),
  },
  {
    label: "Releasing",
    line: place({ dot: "releasing", words: ["Releasing v0.1.4"], clock: { since: NOW - 74_000 } }),
  },
  {
    label: "Not released yet",
    line: place({ dot: "none", words: ["Not released yet"], addresses: [], nothingDeployed: true }),
  },
  {
    label: "Stage, running",
    line: place({
      projectId: "prj-stage",
      kind: "stage",
      name: "stage",
      words: ["Running", "a41c9e2"],
      addresses: [{ service: "app", url: "https://teashop-stage-2ff9.prg1.zerops.app" }],
    }),
  },
  {
    label: "Stage, not added",
    line: place({
      projectId: undefined,
      kind: "stage",
      name: "stage",
      dot: "none",
      words: ["Not added"],
      addresses: [],
      nothingDeployed: true,
    }),
  },
];

// ---- releases ----------------------------------------------------------------------------------

const offer = (over: Partial<ReleaseOffer>): ReleaseOffer => ({
  offered: true,
  releasing: false,
  tag: "v0.1.4",
  reason: undefined,
  onReview: () => acted.push("review-release"),
  ...over,
});
const READY: CardReady = {
  count: 3,
  changeCount: 2,
  atLeast: false,
  stage: "Stage",
  from: "v0.1.3",
  failed: false,
};

// ---- changes -----------------------------------------------------------------------------------

const face = (tint: MateTintId, size: 20 | 32 = 20, state: MateMarkState = "idle") => (
  <MateFace size={size} state={state} tint={tint} />
);
const OPEN = pull({ number: 32, title: "Steer a bot while it answers", updatedAt: ago(13 * 60) });
const MERGED = pull({
  number: 27,
  title: "Connect calendars and notes in one step",
  merged: true,
  mergedAt: ago(26 * 60),
});
const LIVE = pull({
  number: 21,
  title: "Every person has their own assistant",
  merged: true,
  mergedAt: ago(7 * 24 * 60),
});

// ---- services ----------------------------------------------------------------------------------

const day = (base: number, limit: number) =>
  Array.from({ length: 24 }, (_, hour) => ({
    at: new Date(NOW - (24 - hour) * 3_600_000).toISOString(),
    used: limit * Math.max(0.02, base + 0.12 * Math.sin(hour / 2.4)),
    limit,
  }));

/** A service as the platform's map reads it; cast, as a harness holds only what it draws. */
function platformRow(
  hostname: string,
  type: string,
  use: {
    readonly cores: string;
    readonly ram: string;
    readonly ramOf: string;
    readonly disk: string;
  },
  portLabel?: string,
): ZeropsServiceRow {
  return {
    isControlPlane: false,
    service: { serviceId: `svc-${hostname}`, hostname, type: "nodejs@24" },
    tone: "ok",
    statusLabel: "Running",
    statusNeedsWord: false,
    typeLabel: type,
    typeShort: type,
    title: hostname,
    ...(portLabel === undefined ? {} : { portLabel }),
    meta: [],
    dashboardUrl: `https://app.zerops.io/service-stack/svc-${hostname}`,
    metrics: [
      { id: "cores", label: "CPU", value: "2", used: use.cores },
      { id: "memory", label: "RAM", value: use.ramOf, used: use.ram, unit: "GB" },
      { id: "disk", label: "Disk", value: "5", used: use.disk, unit: "GB" },
    ],
    trends: { cores: day(0.06, 2), memory: day(0.3, 1), disk: day(0.2, 5) },
    routes: [],
    routesFolded: false,
    production: [],
  } as unknown as ZeropsServiceRow;
}
const PLATFORM = [
  platformRow("app", "Node.js 24", { cores: "0.09", ram: "0.19", ramOf: "2", disk: "0.9" }),
  platformRow(
    "box",
    "Workspace",
    { cores: "0.04", ram: "0.59", ramOf: "10", disk: "3.1" },
    ":8080, :8081",
  ),
  {
    ...platformRow("db", "PostgreSQL 17", { cores: "0.02", ram: "0.25", ramOf: "1", disk: "0.4" }),
    statusLabel: "Stopped",
    statusNeedsWord: true,
  },
];
const CODE = [
  {
    hostname: "app",
    repository: "teashop",
    status: "Deployed · 7d ago",
    tone: "good",
    word: "Deployed",
  } as unknown as StopServiceRow,
];
const SERVICE_ROWS = placeServiceRows(CODE, PLATFORM);

// ---- the page ----------------------------------------------------------------------------------

function Part({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" data-harness-part={title}>
      <h2 className="m-0 font-mono text-caption text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** A surface a part stands on, at its product width. */
function Surface({
  width,
  label,
  children,
}: {
  readonly width: number;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-1.5" style={{ width }}>
      <figcaption className="text-caption text-muted-foreground">{label}</figcaption>
      <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
        {children}
      </div>
    </figure>
  );
}

const TRAIL: ReadonlyArray<Crumb> = [
  { label: "Overview", onClick: () => acted.push("crumb:overview") },
  { label: "Tea Shop", onClick: () => acted.push("crumb:project") },
  { label: "Production" },
];

function Harness() {
  return (
    <main
      className="flex min-h-screen flex-col gap-10 bg-background p-8 text-foreground"
      style={{ width: 1786 - 435 }}
    >
      <Part title="SectionLabel">
        <Surface label="page section" width={640}>
          <SectionLabel>Places</SectionLabel>
          <SectionLabel count={5}>Waiting on you</SectionLabel>
          <SectionLabel action={<SectionAction>All history</SectionAction>}>Changes</SectionLabel>
          <SectionLabel action={<SectionAction>Add a service</SectionAction>} count={2}>
            Services
          </SectionLabel>
          <SectionLabel count="v0.1.3, released by Dana K. 7d ago">Live now</SectionLabel>
        </Surface>
      </Part>

      <Part title="PageHeader + Crumbs">
        <Surface label="project page" width={1100}>
          <PageHeader
            actions={
              <>
                <Button size="sm" variant="secondary">
                  Add a Mate
                </Button>
                <Button size="sm" variant="secondary">
                  ···
                </Button>
              </>
            }
            summary={<span className="text-muted-foreground">teashop.example ↗</span>}
            title="Tea Shop"
            trail={TRAIL.slice(0, 1).concat({ label: "Tea Shop" })}
          />
        </Surface>
        <Surface label="place page (header PlaceLine as summary)" width={1100}>
          <PageHeader
            actions={
              <Button size="sm" variant="secondary">
                Vault
              </Button>
            }
            summary={
              <PlaceLine
                density="header"
                line={place({ words: ["Running", "v0.1.3", "released 7d ago"] })}
              />
            }
            title="Production"
            trail={TRAIL}
          />
        </Surface>
        <Surface label="title unread" width={1100}>
          <PageHeader title={undefined} trail={TRAIL.slice(0, 1)} />
        </Surface>
      </Part>

      <Part title="PlaceLine">
        <div className="flex flex-wrap items-start gap-6">
          <Surface label="compact (card, panel)" width={380}>
            {PLACES.map(({ label, line }) => (
              <PlaceLine groupId={GROUP} key={label} line={line} />
            ))}
          </Surface>
          <Surface label="row (project page)" width={720}>
            {PLACES.map(({ label, line }) => (
              <PlaceLine
                density="row"
                groupId={GROUP}
                key={label}
                line={line}
                trailing={
                  line.projectId === undefined ? (
                    <Button size="sm" variant="secondary">
                      Add stage
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </Surface>
          <Surface label="header (place page)" width={560}>
            {PLACES.slice(0, 5).map(({ label, line }) => (
              <PlaceLine density="header" key={label} line={line} />
            ))}
          </Surface>
        </div>
      </Part>

      <Part title="NextRelease">
        <div className="flex flex-wrap items-start gap-6">
          <Surface
            label="line: ready · releasing · didn't go live · nothing (draws nothing)"
            width={560}
          >
            <NextRelease onStage ready={READY} release={offer({})} />
            <NextRelease ready={READY} release={offer({ releasing: true })} />
            <NextRelease ready={{ ...READY, failed: true }} release={offer({})} />
            <NextRelease ready={undefined} release={offer({ offered: false })} />
          </Surface>
          <Surface label="block (place page) · NextBlock for Stage" width={720}>
            <SectionLabel>Next release</SectionLabel>
            <NextRelease
              density="block"
              ready={{ ...READY, changeCount: undefined, count: 2 }}
              release={offer({})}
            >
              <ChangeList>
                <ChangeRow
                  at={MERGED.mergedAt}
                  face={face("rose")}
                  line="Juno · Merged"
                  pull={MERGED}
                />
                <ChangeRow
                  at={ago(27 * 60)}
                  face={face("rose")}
                  line="Juno · Merged"
                  pull={{ ...MERGED, number: 26, title: "A hidden browser for web work" }}
                />
              </ChangeList>
            </NextRelease>
            <SectionLabel>Next on stage</SectionLabel>
            <NextBlock facts={["2 commits"]} title="2 changes to approve for Stage">
              <ChangeList>
                <ChangeRow
                  at={OPEN.updatedAt}
                  face={face("sky")}
                  line="Wren · Ready to merge"
                  onOpen={() => acted.push("review")}
                  open
                  pull={OPEN}
                />
              </ChangeList>
            </NextBlock>
          </Surface>
        </div>
      </Part>

      <Part title="ChangeRow">
        <Surface label="changes and work that is no change yet" width={640}>
          <ChangeList>
            <ChangeRow
              at={OPEN.updatedAt}
              face={face("rose")}
              line={changeRowLine("Juno", "Ready to merge")}
              onOpen={() => acted.push("review:32")}
              open
              pull={OPEN}
            />
            <ChangeRow
              at={MERGED.mergedAt}
              face={face("rose")}
              line={changeRowLine("Juno", "Merged · waits for production")}
              onOpen={() => acted.push("open:27")}
              pull={MERGED}
            />
            <ChangeRow
              at={ago(5)}
              face={face("sky")}
              line={changeRowLine("Wren", "On stage")}
              onOpen={() => acted.push("open:30")}
              pull={{ ...MERGED, number: 30, title: "Settings as a centred window" }}
            />
            <ChangeRow
              at={LIVE.mergedAt}
              face={face("rose")}
              line={changeRowLine("Juno", "Live in v0.1.3")}
              onOpen={() => acted.push("open:21")}
              pull={LIVE}
            />
            <ChangeRow
              face={face("olive")}
              line="1 file not committed yet"
              title="voice-call"
              verb={
                <Button size="sm" variant="secondary">
                  Ask Oak to commit
                </Button>
              }
            />
            <ChangeRow face={face("olive")} line="Nothing committed yet" title="main" />
            <ChangeRow
              line="HQ didn't answer"
              title="Could not read this repository"
              verb={
                <Button size="sm" variant="secondary">
                  Read again
                </Button>
              }
            />
          </ChangeList>
        </Surface>
      </Part>

      <Part title="MateRow">
        <Surface label="card · project page" width={380}>
          <div role="list" className="flex flex-col">
            <MateRow
              face={face("rose", 32, "working")}
              name="Juno"
              onOpen={() => acted.push("mate:pepa")}
              reading={{ text: "building the call line", tone: "muted", lift: undefined }}
              time={<MateRowTime dot={undefined}>12m</MateRowTime>}
            />
            <MateRow
              face={face("amber", 32, "needs")}
              name="Wren"
              onOpen={() => acted.push("mate:mira")}
              reading={{
                text: "Which region should the shop run in?",
                tone: "ink",
                lift: undefined,
              }}
              time={<MateRowTime dot="attention">21d</MateRowTime>}
            />
            <MateRow
              face={face("olive", 32)}
              name="Oak"
              onOpen={undefined}
              reading={{ text: undefined, tone: "muted", lift: undefined }}
              time={<MateRowTime dot={undefined}>22d</MateRowTime>}
            />
          </div>
        </Surface>
      </Part>

      <Part title="ServiceRow">
        <div className="flex flex-wrap items-start gap-6">
          <Surface label="table (place page)" width={1000}>
            <ServiceList label="Services">
              {SERVICE_ROWS.map((row) => (
                <ServiceRow key={row.hostname} row={row} usageRead />
              ))}
              <ServiceRow row={{ ...SERVICE_ROWS[0]!, hostname: "api" }} usageRead={false} />
            </ServiceList>
          </Surface>
          <Surface label="compact (Mate panel), with actions" width={420}>
            <ServiceList label="Juno's services">
              {SERVICE_ROWS.slice(0, 2).map((row) => (
                <ServiceRow
                  actions={
                    <Button size="sm" variant="ghost">
                      :3000 ↗
                    </Button>
                  }
                  density="compact"
                  key={row.hostname}
                  menuItems={<MenuItem onClick={() => acted.push("restart")}>Restart</MenuItem>}
                  row={row}
                  usageRead
                />
              ))}
            </ServiceList>
          </Surface>
        </div>
      </Part>
    </main>
  );
}

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
// A router of its own, so a place's name opens its page as it does in the app.
const router = createRouter({
  routeTree: createRootRoute({ component: Harness }),
  history: createMemoryHistory({ initialEntries: ["/"] }),
}) as unknown as AppRouter;
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
