import { HqEnvironmentId } from "@t3tools/contracts";
import { gitDeliveryOf } from "@t3tools/client-runtime/zerops";
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import type { ChipMenuModel, ChipMenuStop, ProductionChip } from "./SidebarProductionChip.logic";
import type { HeadingLanding, HeadingLineInput } from "./SidebarHeadingLine.logic";
import {
  filterSites,
  mateLinks,
  productionUrl,
  projectSitesSections,
  projectSitesStatus,
  sitesLinkCount,
  type SitesMateFacts,
  type SitesSection,
} from "./SidebarProjectSites.logic";

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

const NO_LINE: HeadingLineInput = { production: undefined, stages: [] };

const lineWith = (over: {
  readonly production?: Partial<NonNullable<HeadingLineInput["production"]>>;
  readonly stages?: HeadingLineInput["stages"];
}): HeadingLineInput => ({
  production:
    over.production === undefined
      ? undefined
      : {
          projectId: "p-prod",
          chip: undefined,
          coming: undefined,
          building: false,
          ...over.production,
        },
  stages: over.stages ?? [],
});

const stageLine = (
  over: Partial<HeadingLineInput["stages"][number]> & { readonly name: string },
): HeadingLineInput["stages"][number] => ({
  projectId: `p-${over.name}`,
  coming: undefined,
  serves: true,
  building: false,
  ...over,
});

describe("the environment tag", () => {
  const healthy: ProductionChip = { label: "prod", state: "ok", version: "v2.3.0" };
  it.each<{
    readonly title: string;
    readonly prodChip?: ProductionChip;
    readonly stageChip?: ProductionChip;
    readonly line?: HeadingLineInput;
    readonly landing?: HeadingLanding;
    readonly expected: { tone: string; word: string; sentence: string; section: string } | null;
  }>([
    {
      title: "says nothing while every place is calm",
      prodChip: healthy,
      stageChip: { label: "stage", state: "ok", version: "main" },
      line: lineWith({ production: { chip: healthy }, stages: [stageLine({ name: "stage" })] }),
      expected: null,
    },
    {
      title: "says Down in red while production is down, over everything else",
      prodChip: { label: "prod", state: "down", version: "v2.3.0", next: "v2.4.0" },
      line: lineWith({
        production: { building: true },
        stages: [stageLine({ name: "stage", coming: { kind: "failed", reason: "No key" } })],
      }),
      expected: {
        tone: "red",
        word: "Down",
        sentence: "Production is down, releasing v2.4.0",
        section: "production",
      },
    },
    {
      title: "says an environment didn't come up, with why, over a failed release",
      prodChip: { label: "prod", state: "failed", version: "v2.3.0" },
      line: lineWith({
        production: {},
        stages: [
          stageLine({ name: "stage", coming: { kind: "failed", reason: "the build exited 2" } }),
        ],
      }),
      expected: {
        tone: "amber",
        word: "Didn’t come up",
        sentence: "Stage didn’t come up · the build exited 2",
        section: "stage:stage",
      },
    },
    {
      title: "says production didn't come up before any stage that didn't",
      line: lineWith({
        production: { coming: { kind: "failed", reason: "the import failed" } },
        stages: [stageLine({ name: "stage", coming: { kind: "failed", reason: "x" } })],
      }),
      expected: {
        tone: "amber",
        word: "Didn’t come up",
        sentence: "Production didn’t come up · the import failed",
        section: "production",
      },
    },
    {
      title: "says the newest release failed while the old one still serves",
      prodChip: { label: "prod", state: "failed", version: "v2.3.0" },
      line: lineWith({ production: { building: true } }),
      expected: {
        tone: "amber",
        word: "Release failed",
        sentence: "Release failed · still runs v2.3.0",
        section: "production",
      },
    },
    {
      title: "says Releasing while a release goes out, over a stage coming up",
      prodChip: { label: "prod", state: "releasing", version: "v2.3.0", next: "v2.4.0" },
      line: lineWith({
        production: {},
        stages: [stageLine({ name: "stage", coming: { kind: "coming", step: "build" } })],
      }),
      expected: {
        tone: "busy",
        word: "Releasing",
        sentence: "Production v2.3.0, releasing v2.4.0",
        section: "production",
      },
    },
    {
      title: "says Rolling back while a roll back goes out, by the release it goes back to",
      prodChip: {
        label: "prod",
        state: "releasing",
        version: "v2.4.0",
        next: "v2.4.1",
        rollsBackTo: "v2.3.0",
      },
      line: lineWith({ production: {} }),
      expected: {
        tone: "busy",
        word: "Rolling back",
        sentence: "Production v2.4.0, rolling back to v2.3.0",
        section: "production",
      },
    },
    {
      title: "says Deploying while production deploys",
      prodChip: healthy,
      line: lineWith({ production: { chip: healthy, building: true } }),
      expected: {
        tone: "busy",
        word: "Deploying",
        sentence: "Production is deploying",
        section: "production",
      },
    },
    {
      title: "says Coming up, with its step, while a stage comes up",
      prodChip: healthy,
      line: lineWith({
        production: { chip: healthy },
        stages: [stageLine({ name: "stage", coming: { kind: "coming", step: "build" } })],
      }),
      expected: {
        tone: "busy",
        word: "Coming up",
        sentence: "Stage coming up · building the app",
        section: "stage:stage",
      },
    },
    {
      title: "names the stage coming up where the project has several",
      line: lineWith({
        stages: [
          stageLine({ name: "qa" }),
          stageLine({ name: "beta", coming: { kind: "coming", step: "project" } }),
        ],
      }),
      expected: {
        tone: "busy",
        word: "Coming up",
        sentence: "beta coming up · making the project",
        section: "stage:beta",
      },
    },
    {
      title: "says Coming up while production comes up",
      line: lineWith({ production: { coming: { kind: "coming", step: "project" } } }),
      expected: {
        tone: "busy",
        word: "Coming up",
        sentence: "Production coming up · making the project",
        section: "production",
      },
    },
    {
      title: "never shows a stage deploying",
      prodChip: healthy,
      stageChip: { label: "stage", state: "releasing", version: "main" },
      line: lineWith({
        production: { chip: healthy },
        stages: [stageLine({ name: "stage", building: true })],
      }),
      expected: null,
    },
    {
      title: "says the release this tab watched land is live",
      prodChip: healthy,
      line: lineWith({ production: { chip: healthy } }),
      landing: { kind: "live", version: "v2.4.0" },
      expected: {
        tone: "ok",
        word: "v2.4.0 live",
        sentence: "v2.4.0 is live · just now",
        section: "production",
      },
    },
    {
      title: "says the stage this tab watched come up is up",
      line: lineWith({ stages: [stageLine({ name: "stage" })] }),
      landing: { kind: "up", name: "Stage" },
      expected: {
        tone: "ok",
        word: "Stage is up",
        sentence: "Stage is up · just now",
        section: "stage:Stage",
      },
    },
    {
      title: "says what HQ last knew as last known while its link is paused",
      prodChip: { label: "prod", state: "down", version: "v2.3.0", lastKnown: true },
      expected: {
        tone: "red",
        word: "Down",
        sentence: "Last known: Production is down",
        section: "production",
      },
    },
  ])("$title", ({ prodChip, stageChip, line, landing, expected }) => {
    const status = projectSitesStatus({
      prodChip,
      stageChip,
      line: line ?? NO_LINE,
      landing,
    });
    expect(
      status === undefined
        ? null
        : {
            tone: status.tone,
            word: status.word,
            sentence: status.sentence,
            section: status.section,
          },
    ).toEqual(expected);
  });
});

const mate = (over: Partial<SitesMateFacts> & { readonly name: string }): SitesMateFacts => ({
  projectId: `p-${over.name.toLowerCase()}`,
  owner: undefined,
  routes: [],
  hostnames: undefined,
  controlPlane: "zcp",
  ...over,
});

describe("a Mate's addresses", () => {
  it.each<{
    readonly title: string;
    readonly routes: ReadonlyArray<ZeropsPublicRoute>;
    readonly hostnames?: ReadonlyArray<string>;
    readonly rows: ReadonlyArray<string>;
  }>([
    {
      title: "labels the dev service dev and the stage half of its pair preview, dev first",
      routes: [route("appdev", "appdev.example.app"), route("appstage", "appstage.example.app")],
      hostnames: ["appdev", "appstage", "db"],
      rows: ["appdev dev appdev.example.app", "appstage preview appstage.example.app"],
    },
    {
      title: "labels a pair whose dev half is the bare name",
      routes: [route("webstage", "webstage.example.app"), route("web", "web.example.app")],
      hostnames: ["web", "webstage"],
      rows: ["web dev web.example.app", "webstage preview webstage.example.app"],
    },
    {
      title: "leaves a service that is neither half of a pair unlabelled, after the pair",
      routes: [
        route("admin", "admin.example.app"),
        route("apidev", "apidev.example.app"),
        route("apistage", "apistage.example.app"),
      ],
      hostnames: ["admin", "apidev", "apistage"],
      rows: [
        "apidev dev apidev.example.app",
        "apistage preview apistage.example.app",
        "admin admin.example.app",
      ],
    },
    {
      title: "keeps a stage half's preview while the services list has not shown it yet",
      routes: [route("todoapp", "todoapp.example.app"), route("todoappstage", "stage.example.app")],
      hostnames: ["todoapp"],
      rows: ["todoapp dev todoapp.example.app", "todoappstage preview stage.example.app"],
    },
    {
      title: "never lists the control plane",
      routes: [route("zcp", "zcp.example.app"), route("appdev", "appdev.example.app")],
      rows: ["appdev dev appdev.example.app"],
    },
    {
      title: "writes the port where one service answers on a second one",
      routes: [
        route("apidev", "apidev-3000.example.app", 3000),
        route("apidev", "apidev-9000.example.app", 9000),
      ],
      rows: ["apidev:3000 dev apidev-3000.example.app", "apidev:9000 dev apidev-9000.example.app"],
    },
    {
      title: "names a stage half preview from its routes alone while the services are unread",
      routes: [route("appdev", "appdev.example.app"), route("appstage", "appstage.example.app")],
      rows: ["appdev dev appdev.example.app", "appstage preview appstage.example.app"],
    },
  ])("$title", ({ routes, hostnames, rows }) => {
    const links = mateLinks(mate({ name: "Nell", routes, hostnames })) ?? [];
    expect(
      links.map((link) =>
        [
          `${link.service}${link.port === undefined ? "" : `:${String(link.port)}`}`,
          link.role,
          link.host,
        ]
          .filter((part) => part !== undefined)
          .join(" "),
      ),
    ).toEqual(rows);
  });

  it("is unread, never none, while the Mate's routes are not read", () => {
    expect(mateLinks(mate({ name: "Nell", routes: undefined }))).toBeUndefined();
  });
});

const PROD: ChipMenuModel = {
  stops: [
    stop({
      name: "production",
      version: "v2.3.0",
      routes: [route("app", "shop.example.com"), route("api", "api.shop.example.com")],
    }),
  ],
};
const STAGES: ChipMenuModel = {
  stops: [
    stop({ name: "stage", routes: [route("app", "stage.example.app")] }),
    stop({ name: "qa", projectId: undefined, dot: "spinner", word: "Setting up" }),
  ],
};

const sectionRows = (sections: ReadonlyArray<SitesSection>) =>
  sections.map((section) => [
    section.key,
    section.links === undefined ? "reading" : section.links.map((link) => link.host).join(", "),
  ]);

describe("the project's addresses", () => {
  it("lists production, each stage and each one being created, then every Mate in the given order", () => {
    const sections = projectSitesSections({
      production: PROD,
      productionUnread: false,
      stages: STAGES,
      unreadStages: [],
      placeRoutes: (place) => place.routes,
      mates: [
        mate({ name: "Nell", routes: [route("appdev", "nell.example.app")] }),
        mate({ name: "Odo", owner: "Pia", routes: [route("webdev", "odo.example.app")] }),
      ],
    });
    expect(sectionRows(sections)).toEqual([
      ["production", "shop.example.com, api.shop.example.com"],
      ["stage:stage", "stage.example.app"],
      ["stage:qa", ""],
      ["mate:p-nell", "nell.example.app"],
      ["mate:p-odo", "odo.example.app"],
    ]);
    expect(sections.map((section) => section.title)).toEqual([
      "Production",
      "stage",
      "qa",
      "Nell",
      "Odo",
    ]);
  });

  it("lists every address once: a place's public access read over its listed routes, the first place to hold one keeps it", () => {
    const sections = projectSitesSections({
      production: PROD,
      productionUnread: false,
      stages: undefined,
      unreadStages: [],
      placeRoutes: (place) =>
        place.name === "production"
          ? [route("app", "shop.example.com"), route("app", "www.shop.example.com")]
          : place.routes,
      mates: [
        mate({
          name: "Nell",
          routes: [route("app", "shop.example.com"), route("appdev", "nell.example.app")],
        }),
      ],
    });
    expect(sectionRows(sections)).toEqual([
      ["production", "shop.example.com, www.shop.example.com"],
      ["mate:p-nell", "nell.example.app"],
    ]);
  });

  it("shows no section for a Mate with no address, and a reading one for a Mate not read yet", () => {
    const sections = projectSitesSections({
      production: undefined,
      productionUnread: false,
      stages: undefined,
      unreadStages: [],
      placeRoutes: (place) => place.routes,
      mates: [mate({ name: "Nell", routes: [] }), mate({ name: "Odo", routes: undefined })],
    });
    expect(sectionRows(sections)).toEqual([["mate:p-odo", "reading"]]);
  });

  it("holds a place the project has but has not read as reading", () => {
    const sections = projectSitesSections({
      production: undefined,
      productionUnread: true,
      stages: undefined,
      unreadStages: ["stage"],
      placeRoutes: (place) => place.routes,
      mates: [],
    });
    expect(sectionRows(sections)).toEqual([
      ["production", "reading"],
      ["stage:stage", "reading"],
    ]);
  });

  it("opens production's first address on a ⌘-click", () => {
    const one: ChipMenuModel = {
      stops: [stop({ name: "production", routes: [route("app", "shop.example.com")] })],
    };
    expect(productionUrl(one)).toBe("https://shop.example.com");
    expect(productionUrl({ stops: [stop({ name: "production" })] })).toBeUndefined();
    expect(productionUrl(undefined)).toBeUndefined();
  });

  it("The production globe with several addresses offers Open", () => {
    // Two parts, each its own address, and a second port of one: a ⌘-click opens none of them
    // by itself, and the addresses it opens list each.
    const several: ChipMenuModel = {
      stops: [
        stop({
          name: "production",
          routes: [
            route("app", "shop.example.com"),
            route("app", "shop-8080.example.com", 8080),
            route("api", "api.shop.example.com"),
          ],
        }),
      ],
    };
    expect(productionUrl(several)).toBeUndefined();
    const sections = projectSitesSections({
      production: several,
      productionUnread: false,
      stages: undefined,
      unreadStages: [],
      placeRoutes: (place) => place.routes,
      mates: [],
    });
    expect(sections[0]?.links?.map((link) => [link.service, link.url])).toEqual([
      ["app", "https://shop.example.com"],
      ["app", "https://shop-8080.example.com"],
      ["api", "https://api.shop.example.com"],
    ]);
    // Two ports of one service are one address: ⌘-click still opens it.
    expect(
      productionUrl({
        stops: [
          stop({
            name: "production",
            routes: [route("app", "shop.example.com"), route("app", "shop-8080.example.com", 8080)],
          }),
        ],
      }),
    ).toBe("https://shop.example.com");
  });
});

describe("the addresses filter", () => {
  const sections = projectSitesSections({
    production: PROD,
    productionUnread: false,
    stages: STAGES,
    unreadStages: [],
    placeRoutes: (place) => place.routes,
    mates: [
      mate({ name: "Nell", routes: [route("appdev", "nell-dev.example.app")] }),
      mate({ name: "Odo", owner: "Pia", routes: [route("webdev", "odo.example.app")] }),
      mate({ name: "Rue", routes: undefined }),
    ],
  });

  it.each<{
    readonly title: string;
    readonly query: string;
    readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  }>([
    {
      title: "keeps everything while it is empty",
      query: "  ",
      rows: sectionRows(sections),
    },
    {
      title: "finds an address by its service, and hides the sections left with nothing",
      query: "api",
      rows: [["production", "api.shop.example.com"]],
    },
    {
      title: "finds an address by its host",
      query: "stage.example",
      rows: [["stage:stage", "stage.example.app"]],
    },
    {
      title: "finds a Mate's addresses by its name or its owner's",
      query: "pia",
      rows: [["mate:p-odo", "odo.example.app"]],
    },
    {
      title: "finds a Mate's dev by its role",
      query: "nell dev",
      rows: [["mate:p-nell", "nell-dev.example.app"]],
    },
    {
      title: "finds nothing where nothing matches",
      query: "zzz",
      rows: [],
    },
  ])("$title", ({ query, rows }) => {
    expect(sectionRows(filterSites(sections, query))).toEqual(rows);
  });

  it("counts the addresses it lists", () => {
    expect(sitesLinkCount(sections)).toBe(5);
  });
});

it("a calm Git stage does not hide a failed Zerops production", () => {
  const git = gitDeliveryOf({
    id: HqEnvironmentId.make("git-stage"),
    target: { kind: "git", branch: "main", delivery: "direct" },
    tier: "stage",
    jobs: [],
    release: null,
  })!;
  const shown = projectSitesStatus({
    prodChip: { label: "prod", state: "failed" },
    stageChip: { label: "stage", state: "ok", git },
    line: NO_LINE,
    landing: undefined,
  });
  expect(shown?.word).toBe("Release failed");
  expect(shown?.section).toBe("production");
});
