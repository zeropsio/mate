/**
 * A project's places on its row — the environment tag and the globe — and the popover they open,
 * in the states a project really reaches: production down with a fix to ask for, a release that
 * failed, a dev on three ports, a stage coming up, a big project with a dozen addresses (its
 * filter), a Mate on dev pools with no workspace running, and one with no address anywhere.
 *
 * Served by the dev server at `/design-sites.html` (`?theme=dark`). Open it at 1786 × 1000; the
 * menu is the owner's 435 px. Each row shows its hover actions, as a pointed-at row does.
 *
 * Fixtures only, invented names. Nothing here ships — `design-sites.html` is not `index.html`, and
 * no route imports this module.
 */
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { EnvironmentId } from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT, type MateTintId } from "@t3tools/shared/brand";
import { MoreHorizontalIcon } from "lucide-react";
import { StrictMode, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type { HeadingLineInput } from "~/components/zerops/SidebarHeadingLine.logic";
import type {
  ChipMenuModel,
  ChipMenuStop,
  ProductionChip,
} from "~/components/zerops/SidebarProductionChip.logic";
import {
  ProjectSites,
  type ProjectSitesInput,
  type SitesMate,
} from "~/components/zerops/SidebarProjectSites";
import { MateFace } from "~/components/zerops/primitives";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";

const route = (service: string, host: string, port = 80): ZeropsPublicRoute => ({
  service,
  port,
  host,
  url: `https://${host}`,
});

const stop = (over: Partial<ChipMenuStop> & Pick<ChipMenuStop, "name">): ChipMenuStop => ({
  projectId: `p-${over.name}`,
  version: undefined,
  dot: "ok",
  word: "Healthy",
  tone: "muted",
  note: undefined,
  fix: undefined,
  routes: [],
  ...over,
});

function mate(
  app: string,
  name: string,
  tint: MateTintId,
  over: {
    readonly owner?: string;
    readonly routes?: ReadonlyArray<ZeropsPublicRoute> | undefined;
    readonly hostnames?: ReadonlyArray<string>;
    readonly pools?: ReadonlyArray<string>;
  } = {},
): SitesMate {
  const id = `${app}-${name.toLowerCase()}`;
  return {
    candidate: {
      key: `${id}:zcp`,
      project: {
        id,
        name,
        status: "ACTIVE",
        tagList: ["mate"],
        hq: { appId: app, appName: app, kind: "mate", mate: { face: "" } },
      },
      group: "connected",
      environmentId: EnvironmentId.make(`env-${id}`),
      service: { id: "zcp", name: "zcp", status: "ACTIVE" },
      ...(over.routes === undefined ? {} : { routes: over.routes }),
      ...(over.hostnames === undefined
        ? {}
        : {
            services: {
              hostnames: over.hostnames,
              ...(over.pools === undefined ? {} : { pools: over.pools }),
            },
          }),
    },
    tint,
    shape: MATE_SHAPE_OF_TINT[tint],
    mine: over.owner === undefined,
    threadKey: undefined,
    name,
    owner:
      over.owner === undefined
        ? undefined
        : { name: over.owner, initials: over.owner.slice(0, 1), avatarUrl: null, isViewer: false },
  };
}

interface Fixture {
  readonly title: string;
  readonly input: ProjectSitesInput;
}

const base = (groupId: string, projectName: string): ProjectSitesInput => ({
  groupId,
  projectName,
  production: undefined,
  stages: undefined,
  mates: [],
  prodChip: undefined,
  stageChip: undefined,
  line: undefined,
  onAskToFix: () => {},
  onOpenStop: () => () => {},
});

const DOWN: ProductionChip = { label: "prod", state: "down", version: "v2.3.0" };
const HEALTHY_STAGE: ProductionChip = { label: "stage", state: "ok", version: "main" };

const FIXTURES: ReadonlyArray<Fixture> = [
  {
    title: "Production down, a fix to ask for",
    input: {
      ...base("quill", "Quillmark"),
      production: (): ChipMenuModel => ({
        stops: [
          stop({
            name: "production",
            version: "v2.3.0",
            dot: "failed",
            word: "Down",
            tone: "red",
            note: "Down: app failed on the platform. v2.3.0 was the last release.",
            fix: {
              what: "Production is down: app failed on the platform",
              at: undefined,
              error: undefined,
              ask: "Find out why and bring it back.",
            },
            routes: [
              route("app", "quillmark.example.com"),
              route("app", "www.quillmark.example.com"),
              route("api", "api.quillmark.example.com"),
            ],
          }),
        ],
      }),
      stages: (): ChipMenuModel => ({
        stops: [
          stop({
            name: "stage",
            version: "a41c09e",
            word: "Deployed 3 h ago",
            routes: [route("app", "app-1f3a.prg1.zerops.app")],
          }),
        ],
      }),
      mates: [
        mate("quill", "Nell", "sky", {
          routes: [
            route("appdev", "appdev-2b71-3000.prg1.zerops.app", 3000),
            route("appstage", "appstage-2b71.prg1.zerops.app"),
          ],
          hostnames: ["appdev", "appstage", "db"],
        }),
        mate("quill", "Odo", "violet", {
          owner: "Pia Lund",
          routes: [
            route("apidev", "apidev-77c0-3000.prg1.zerops.app", 3000),
            route("apidev", "apidev-77c0-9000.prg1.zerops.app", 9000),
          ],
        }),
        mate("quill", "Rue", "amber", { owner: "Tomas Berg", routes: undefined }),
        mate("quill", "Sef", "olive", { routes: [] }),
      ],
      prodChip: DOWN,
      stageChip: HEALTHY_STAGE,
      line: {
        production: { projectId: "p-production", chip: DOWN, coming: undefined, building: false },
        stages: [
          { projectId: "p-stage", name: "stage", coming: undefined, serves: true, building: false },
        ],
      },
    },
  },
  {
    title: "A release that failed; production still serves",
    input: {
      ...base("lumen", "Lumen Docs"),
      production: () => ({
        stops: [
          stop({
            name: "production",
            version: "v0.9.4",
            dot: "attention",
            word: "Release failed",
            tone: "amber",
            note: "Release v0.9.5 failed deploying web: the build step exited with code 2. v0.9.4 is still serving.",
            routes: [route("web", "docs.lumen.example.org")],
          }),
        ],
      }),
      mates: [
        mate("lumen", "Ivo", "coral", {
          routes: [route("webdev", "webdev-4c2e.prg1.zerops.app")],
        }),
      ],
      prodChip: { label: "prod", state: "failed", version: "v0.9.4" },
    },
  },
  {
    title: "A dev on three ports",
    input: {
      ...base("flip", "Flipbook"),
      mates: [
        mate("flip", "Filip", "sky", {
          routes: [
            route("flipdev", "flipdev-3a9c-5196.prg1.zerops.app", 5196),
            route("flipdev", "flipdev-3a9c-5193.prg1.zerops.app", 5193),
            route("flipdev", "flipdev-3a9c-5195.prg1.zerops.app", 5195),
            route("flipstage", "flipstage-3a9c.prg1.zerops.app"),
          ],
          hostnames: ["flipdev", "flipstage", "db"],
        }),
      ],
    },
  },
  {
    title: "A stage coming up",
    input: {
      ...base("harbor", "Harbor"),
      stages: () => ({
        stops: [stop({ name: "stage", projectId: undefined, dot: "spinner", word: "Setting up" })],
      }),
      mates: [
        mate("harbor", "Juno", "rose", {
          routes: [route("appdev", "appdev-9e10.prg1.zerops.app")],
        }),
      ],
      line: {
        production: undefined,
        stages: [
          {
            projectId: "p-hstage",
            name: "stage",
            coming: { kind: "coming", step: "build" },
            serves: false,
            building: false,
          },
        ],
      } satisfies HeadingLineInput,
    },
  },
  {
    title: "A big project: a filter over its addresses",
    input: {
      ...base("atlas", "Atlas Commerce"),
      production: () => ({
        stops: [
          stop({
            name: "production",
            version: "v4.12.0",
            routes: [
              route("storefront", "shop.atlas.example.com"),
              route("storefront", "www.atlas.example.com"),
              route("admin", "admin.atlas.example.com"),
              route("api", "api.atlas.example.com"),
              route("media", "media.atlas.example.com"),
            ],
          }),
        ],
      }),
      stages: () => ({
        stops: [
          stop({
            name: "qa",
            version: "3e9d1aa",
            routes: [route("storefront", "qa.atlas.example.app")],
          }),
          stop({
            name: "beta",
            version: "release/4.13",
            routes: [route("storefront", "beta.atlas.example.app")],
          }),
        ],
      }),
      mates: [
        mate("atlas", "Kit", "sand", {
          routes: [
            route("storefrontdev", "storefrontdev-11aa.prg1.zerops.app"),
            route("storefrontstage", "storefrontstage-11aa.prg1.zerops.app"),
          ],
        }),
        mate("atlas", "Moss", "slate", {
          owner: "Ines Varga",
          routes: [route("admindev", "admindev-2c3d.prg1.zerops.app")],
        }),
      ],
      prodChip: { label: "prod", state: "ok", version: "v4.12.0" },
    },
  },
  {
    title: "Nothing deployed yet, a Mate on dev pools",
    input: {
      ...base("noola", "Noola"),
      production: () => ({
        stops: [stop({ name: "production", word: "Not released yet", dot: "off", empty: true })],
      }),
      stages: () => ({
        stops: [stop({ name: "stage", word: "Not deployed yet", dot: "off", empty: true })],
      }),
      mates: [
        mate("noola", "Odin", "amber", {
          routes: [
            ...["api", "edge", "web"].map((part) =>
              route(`${part}stage`, `${part}stage-5e2b.prg1.zerops.app`),
            ),
            route("mailpit", "mailpit-5e2b-8025.prg1.zerops.app"),
          ],
          hostnames: [
            "noola",
            "mailpit",
            ...["api", "edge", "runner", "web"].flatMap((part) => [`${part}pool`, `${part}stage`]),
          ],
          pools: ["apipool", "edgepool", "runnerpool", "webpool"],
        }),
      ],
    },
  },
  {
    title: "No address anywhere yet",
    input: {
      ...base("fern", "Fernway"),
      mates: [mate("fern", "Pip", "olive", { routes: [] })],
    },
  },
];

const ROW: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "40px minmax(0, 1fr)",
  columnGap: 12,
  alignItems: "center",
  minHeight: 59,
  padding: "9px 12px 9px 10px",
  borderRadius: 12,
};
const LINE1: CSSProperties = { display: "flex", alignItems: "center", gap: 6, height: 21 };

function Row({ fixture, face }: { readonly fixture: Fixture; readonly face: ReactNode }) {
  return (
    <ProjectSites {...fixture.input}>
      {({ tag, globe }) => (
        <div className="bg-sidebar-row-hover" style={ROW}>
          <span className="flex items-center justify-center">{face}</span>
          <span className="flex min-w-0 flex-col">
            <span style={LINE1}>
              <span className="min-w-0 flex-1 truncate font-medium">
                {fixture.input.projectName}
              </span>
              {tag}
              <span className="flex items-center gap-px">
                {globe}
                <span className="inline-flex size-5 items-center justify-center text-sidebar-muted-foreground">
                  <MoreHorizontalIcon aria-hidden="true" className="size-4" />
                </span>
              </span>
            </span>
            <span className="truncate text-sm text-sidebar-muted-foreground">{fixture.title}</span>
          </span>
        </div>
      )}
    </ProjectSites>
  );
}

function Harness() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <div
        className="flex shrink-0 flex-col gap-0.5 border-e border-border bg-sidebar p-2.5 text-sidebar-foreground"
        data-sites-harness="menu"
        style={{ width: 435 }}
      >
        {FIXTURES.map((fixture) => (
          <Row
            face={
              <MateFace
                shape={fixture.input.mates[0]?.shape}
                size={24}
                state="idle"
                tint={fixture.input.mates[0]?.tint ?? "slate"}
              />
            }
            fixture={fixture}
            key={fixture.input.groupId}
          />
        ))}
      </div>
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
