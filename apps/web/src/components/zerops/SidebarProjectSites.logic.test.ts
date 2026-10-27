import { HqEnvironmentId, type ZeropsDevServer } from "@t3tools/contracts";
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
  readsLeases,
  sitesLinkCount,
  type SitesLease,
  type SitesMateFacts,
  type SitesSection,
  type SitesWork,
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
  pools: undefined,
  leases: undefined,
  stageParts: undefined,
  conversations: undefined,
  changes: [],
  ...over,
});

/** A lease of the pool its alias names, held unless said otherwise. */
const lease = (alias: string, over: Partial<SitesLease> = {}): SitesLease => ({
  alias,
  pool: alias.slice(0, alias.lastIndexOf("-")),
  state: "held",
  ...over,
});

/** A lease's preview server as zcp last read it, with its per-port address where it has one. */
const server = (status: string, url?: string): ZeropsDevServer => ({
  name: "web",
  port: 3000,
  ...(url === undefined ? {} : { url }),
  status,
  readAt: "2026-10-25T09:00:00Z",
});

/** A pool declaring three slots' ports, each with its own subdomain whether or not a container holds it. */
const slots = (pool: string) =>
  [3001, 3002, 3003].map((port) => route(pool, `${pool}-${String(port)}.example.app`, port));

/** The works the section of a Mate alone lists; none where it has no section. */
const worksOf = (facts: SitesMateFacts): ReadonlyArray<SitesWork> => {
  const section = projectSitesSections({
    production: undefined,
    productionUnread: false,
    stages: undefined,
    unreadStages: [],
    placeRoutes: (place) => place.routes,
    mates: [facts],
  }).find((found) => found.kind === "mate");
  return section?.kind === "mate" ? section.works : [];
};

/** A Mate's dev pools' previews as its section lists them: each part's name and host. */
const previewRows = (facts: SitesMateFacts) =>
  worksOf(facts).flatMap((work) =>
    work.parts.flatMap((part) =>
      part.host === undefined ? [] : [[part.name, part.host, "no role"].join(" | ")],
    ),
  );

describe("a Mate's dev pools", () => {
  it("lists a part's preview once, by the part's name, never its pool's per-port addresses", () => {
    const kara = mate({
      name: "Kara",
      routes: [
        ...slots("webpool"),
        ...slots("embedderpool"),
        route("appstage", "appstage.example.app"),
      ],
      hostnames: ["appstage", "embedderpool", "webpool"],
      pools: ["embedderpool", "webpool"],
      leases: [
        lease("embedderpool-3", {
          devServers: [server("running", "https://embedderpool-c2e4-8101.prg1.zerops.app")],
        }),
        lease("webpool-3", {
          devServers: [server("crashed", "https://webpool-3001.example.app")],
        }),
        lease("webpool-6", { state: "released" }),
      ],
    });
    expect(mateLinks(kara)?.map((link) => link.host)).toEqual(["appstage.example.app"]);
    expect(previewRows(kara)).toEqual([
      "Embedder | embedderpool-c2e4-8101.prg1.zerops.app | no role",
      "Web | webpool-3001.example.app | no role",
    ]);
  });

  it.each<{ readonly title: string; readonly given: SitesLease }>([
    { title: "no preview server read on it", given: lease("webpool-3") },
    {
      title: "a preview server with no address",
      given: lease("webpool-3", { devServers: [{ ...server("running"), port: undefined }] }),
    },
    {
      title: "a parked container, which serves nothing",
      given: lease("webpool-3", {
        state: "parked",
        devServers: [server("running", "https://webpool-3001.example.app")],
      }),
    },
    // Review r4-13: an envelope's address becomes a link's href as it is.
    {
      title: "an address that is no web address",
      given: lease("webpool-3", {
        devServers: [server("running", "javascript:alert(document.cookie)")],
      }),
    },
  ])("lists no preview of a part with $title", ({ given }) => {
    expect(
      previewRows(
        mate({ name: "Kara", routes: slots("webpool"), pools: ["webpool"], leases: [given] }),
      ),
    ).toEqual([]);
  });

  it("names a part by its pool's hostname, the pool left off", () => {
    expect(
      previewRows(
        mate({
          name: "Kara",
          pools: ["pool", "apipool"],
          leases: [
            lease("apipool-1", {
              devServers: [server("running", "https://apipool-1.example.app")],
            }),
            lease("pool-2", { devServers: [server("running", "https://pool-2.example.app")] }),
          ],
        }),
      ),
    ).toEqual(["API | apipool-1.example.app | no role", "Pool | pool-2.example.app | no role"]);
  });

  it("lists nothing of a pool with no lease, and a service that is no pool keeps its addresses", () => {
    const kara = mate({
      name: "Kara",
      routes: [...slots("webpool"), route("appdev", "appdev.example.app")],
      hostnames: ["appdev", "webpool"],
      pools: ["webpool"],
      leases: [],
    });
    expect(mateLinks(kara)?.map((link) => link.host)).toEqual(["appdev.example.app"]);
    expect(previewRows(kara)).toEqual([]);
  });

  it("never lists a pool's per-port addresses while its leases are not read", () => {
    const kara = mate({
      name: "Kara",
      routes: [...slots("webpool"), route("appdev", "appdev.example.app")],
      pools: ["webpool"],
      leases: undefined,
    });
    expect(mateLinks(kara)?.map((link) => link.host)).toEqual(["appdev.example.app"]);
    expect(previewRows(kara)).toEqual([]);
  });

  it("takes a lease's pool for a pool where the services listing has not named it", () => {
    const kara = mate({
      name: "Kara",
      routes: slots("webpool"),
      pools: undefined,
      leases: [
        lease("webpool-3", {
          devServers: [server("running", "https://webpool-3-1df2-3000.example.app")],
        }),
      ],
    });
    expect(mateLinks(kara)).toEqual([]);
    expect(previewRows(kara)).toEqual(["Web | webpool-3-1df2-3000.example.app | no role"]);
  });
});

describe("the project's Sites, by what each section represents", () => {
  const conversation = (alias: string, title: string, branch: string | null = "feat-x") => ({
    key: `env-kara:thread-${alias}`,
    title,
    lease: { alias, pool: alias.slice(0, alias.lastIndexOf("-")), branch },
  });
  const change = (branch: string, number: number, title: string) => ({
    mateProjectId: "p-kara",
    branch,
    repositoryUrl: undefined,
    number,
    title,
  });

  it("Main lists each part's stage link by its part's name", () => {
    const sections = projectSitesSections({
      production: undefined,
      productionUnread: false,
      stages: { stops: [stop({ name: "stage", routes: [route("app", "app-stage.example.app")] })] },
      unreadStages: [],
      placeRoutes: (place) => place.routes,
      mates: [
        mate({
          name: "Kara",
          routes: [
            route("boxstage", "boxstage.example.app"),
            route("hqstage", "hqstage.example.app"),
            route("webstage", "webstage.example.app"),
            route("webdev", "webdev.example.app"),
          ],
          hostnames: ["boxstage", "hqstage", "webdev", "webstage"],
          pools: ["boxpool"],
          leases: [lease("boxpool-2", { part: "box", stage: "boxstage" })],
          stageParts: { webstage: "web" },
        }),
      ],
    });
    const main = sections.find((section) => section.title === "Main");
    expect(main?.links?.map((link) => [link.service, link.host])).toEqual([
      ["App", "app-stage.example.app"],
      ["Box", "boxstage.example.app"],
      ["HQ", "hqstage.example.app"],
      ["Web", "webstage.example.app"],
    ]);
    expect(
      sections.find((section) => section.kind === "mate")?.links?.map((link) => link.host),
      "the Mate keeps its own dev, never a stage",
    ).toEqual(["webdev.example.app"]);
    expect(
      projectSitesSections({
        production: undefined,
        productionUnread: false,
        stages: undefined,
        unreadStages: [],
        placeRoutes: (place) => place.routes,
        mates: [mate({ name: "Kara", routes: [route("apistage", "apistage.example.app")] })],
      }).map((section) => [section.title, section.links?.map((link) => link.service)]),
      "with no stage of its own, Main still lists the Mates' stages",
    ).toEqual([["Main", ["API"]]]);
  });

  it("A Mate's work is headed by its change's title, else its conversation's title, else \"Work in progress\", never its branch", () => {
    const works = worksOf(
      mate({
        name: "Kara",
        pools: ["boxpool", "hqpool", "webpool"],
        leases: [
          lease("boxpool-2", { branch: "checkout-rework" }),
          lease("hqpool-2", { branch: "checkout-rework" }),
          lease("webpool-4", { branch: "fix-login" }),
          lease("webpool-5", { branch: "spike" }),
        ],
        conversations: [
          conversation("webpool-4", "Fix the login redirect", "fix-login"),
          conversation("boxpool-2", "Checkout chat", "checkout-rework"),
        ],
        changes: [change("checkout-rework", 2, "Rework the checkout flow")],
      }),
    );
    expect(works.map((work) => [work.title, work.parts.map((part) => part.name)])).toEqual([
      ["Fix the login redirect", ["Web"]],
      ["Rework the checkout flow · #2", ["Box", "HQ"]],
      ["Work in progress", ["Web"]],
    ]);
    for (const work of works) {
      expect(work.title).not.toMatch(/checkout-rework|fix-login|spike|pool/u);
    }
    expect(works[1]?.tooltip, "the branch and aliases, only in the tooltip").toBe(
      "Branch checkout-rework · boxpool-2, hqpool-2",
    );
  });

  it.each<{
    readonly title: string;
    readonly given: Partial<SitesLease>;
    readonly status: string | undefined;
    readonly host: string | undefined;
  }>([
    {
      title: "running, opening its preview",
      given: { devServers: [server("running", "https://web-4.example.app")] },
      status: "running",
      host: "web-4.example.app",
    },
    {
      title: "starting",
      given: { devServers: [server("starting", "https://web-4.example.app")] },
      status: "starting",
      host: "web-4.example.app",
    },
    {
      title: "crashed, a failed start",
      given: { devServers: [server("crashed", "https://web-4.example.app")] },
      status: "crashed",
      host: "web-4.example.app",
    },
    {
      title: "not running, where its server stopped",
      given: { devServers: [server("stopped", "https://web-4.example.app")] },
      status: "not running",
      host: undefined,
    },
    {
      title: "not running, where the read found no server",
      given: { devServers: [] },
      status: "not running",
      host: undefined,
    },
    {
      title: "paused, while its lease is parked",
      given: { state: "parked", devServers: [server("running", "https://web-4.example.app")] },
      status: "paused",
      host: undefined,
    },
    { title: "nothing, before any read", given: {}, status: undefined, host: undefined },
  ])("Each part shows its preview with its status: $title", ({ given, status, host }) => {
    const [part] = worksOf(
      mate({ name: "Kara", pools: ["webpool"], leases: [lease("webpool-4", given)] }),
    ).flatMap((work) => work.parts);
    expect([part?.status, part?.host]).toEqual([status, host]);
  });

  it("A part not running offers to start it, by a request written for the Mate", () => {
    const works = worksOf(
      mate({
        name: "Kara",
        pools: ["webpool", "boxpool"],
        leases: [
          lease("webpool-4", { branch: "checkout-rework", devServers: [server("stopped")] }),
          lease("boxpool-4", {
            branch: "checkout-rework",
            devServers: [server("running", "https://box-4.example.app")],
          }),
          lease("webpool-5", { branch: "spike", devServers: [server("crashed")] }),
        ],
        changes: [change("checkout-rework", 2, "Rework the checkout flow")],
      }),
    );
    expect(
      works.flatMap((work) => work.parts.map((part) => [part.name, part.start?.request])),
    ).toEqual([
      ["Box", undefined],
      ["Web", "Start the Web preview for “Rework the checkout flow”."],
      ["Web", "Start the Web preview."],
    ]);
    expect(works[0]?.parts[1]?.start?.branch).toBe("checkout-rework");
  });

  it("A Mate with nothing is left out", () => {
    expect(
      projectSitesSections({
        production: undefined,
        productionUnread: false,
        stages: undefined,
        unreadStages: [],
        placeRoutes: (place) => place.routes,
        mates: [
          mate({ name: "Kara", routes: [], pools: ["webpool"], leases: [] }),
          mate({ name: "Nell", routes: [route("appstage", "nell-stage.example.app")] }),
        ],
      }).map((section) => section.title),
    ).toEqual(["Main"]);
  });
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

  it("counts each part's preview as one address, its pool's slots never, and a part with no preview not at all", () => {
    const sections = projectSitesSections({
      production: undefined,
      productionUnread: false,
      stages: undefined,
      unreadStages: [],
      placeRoutes: (place) => place.routes,
      mates: [
        mate({
          name: "Kara",
          routes: [...slots("webpool"), ...slots("hqpool"), ...slots("boxpool")],
          pools: ["boxpool", "hqpool", "webpool"],
          leases: [
            lease("webpool-3", {
              devServers: [server("running", "https://webpool-3001.example.app")],
            }),
            lease("hqpool-3"),
          ],
        }),
      ],
    });
    const [kara] = sections;
    expect(
      kara?.kind === "mate"
        ? kara.works.flatMap((work) => work.parts.map((part) => [part.name, part.host]))
        : [],
    ).toEqual([
      ["HQ", undefined],
      ["Web", "webpool-3001.example.app"],
    ]);
    expect(sitesLinkCount(sections)).toBe(1);
  });

  it("shows no section for a Mate whose only public service is a pool with no lease", () => {
    const sections = projectSitesSections({
      production: undefined,
      productionUnread: false,
      stages: undefined,
      unreadStages: [],
      placeRoutes: (place) => place.routes,
      mates: [mate({ name: "Kara", routes: slots("webpool"), pools: ["webpool"], leases: [] })],
    });
    expect(sections).toEqual([]);
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

  it("finds a part's preview by the part's name", () => {
    const withPools = projectSitesSections({
      production: PROD,
      productionUnread: false,
      stages: undefined,
      unreadStages: [],
      placeRoutes: (place) => place.routes,
      mates: [
        mate({
          name: "Kara",
          routes: [...slots("webpool"), route("appdev", "kara-dev.example.app")],
          pools: ["embedderpool", "webpool"],
          leases: [
            lease("webpool-3", {
              devServers: [server("running", "https://webpool-3.example.app")],
            }),
            lease("embedderpool-4", {
              devServers: [server("running", "https://embedderpool-4.example.app")],
            }),
          ],
        }),
      ],
    });
    expect(
      filterSites(withPools, "embedder").map((section) => [
        section.key,
        section.links?.map((link) => link.host),
        section.kind === "mate"
          ? section.works.flatMap((work) => work.parts.map((part) => part.host))
          : [],
      ]),
    ).toEqual([["mate:p-kara", [], ["embedderpool-4.example.app"]]]);
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

// Review r3-13: opening Sites held a lifecycle feed open for every Mate, pool or not, while the
// popover stayed open; only a dev pool's workspaces come from a Mate's leases.
describe("the Mates whose leases a Sites list reads", () => {
  it.each([
    { name: "a Mate whose listing names a dev pool", pools: ["webpool"], reads: true },
    { name: "a Mate with no dev pool", pools: [], reads: false },
    { name: "a Mate whose listing is not read yet", pools: undefined, reads: false },
  ])("reads the leases of $name: $reads", ({ pools, reads }) => {
    expect(readsLeases({ pools })).toBe(reads);
  });
});
