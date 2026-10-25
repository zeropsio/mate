/**
 * A project's places on its row: the environment tag that speaks only when a place is not calm,
 * and the addresses its globe opens — production's, each stage's, then every Mate's, each address
 * once.
 *
 * A Mate's dev pool lists its workspaces, never its ports: a pool declares a port per container
 * slot, each with a subdomain whether or not a container holds it, so its routes say nothing of
 * whose an address is. Each lease zcp still holds is one row, named `<pool> · <branch>` as the
 * bound conversation names it, with its preview's state and its preview's address.
 *
 * The tag says one thing, the highest of: production down; an environment that did not come up;
 * the newest release failed while the old one serves; a release going out or production
 * deploying; a stage or production coming up; what this tab watched land, for `LANDING_MS`. A
 * stage deploying never shows at rest: it is the stage's own business until it fails.
 *
 * Pure: no clock of its own, no platform globals.
 */
import {
  checkoutLabel,
  comingLine,
  placeAddresses,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import { servicePairs } from "@t3tools/client-runtime/zerops/servicePairs";
import { isZeropsLeaseHeld, type ZeropsLease } from "@t3tools/contracts";

import {
  chipFace,
  type ChipDot,
  type ChipMenuModel,
  type ChipMenuStop,
  type ProductionChip,
} from "./SidebarProductionChip.logic";
import { isServiceBrowserUrl } from "../../zerops/serviceBrowserPolicy";
import type { HeadingLanding, HeadingLineInput } from "./SidebarHeadingLine.logic";
import { routeMenuEntries } from "./ZeropsPublicRoutes.logic";

/** The tag's ink: red while production is down, amber for trouble, busy while moving, ok once landed. */
export type SitesTone = "red" | "amber" | "busy" | "ok";

export interface SitesStatus {
  readonly tone: SitesTone;
  /** The tag's word. */
  readonly word: string;
  /** The whole state in a sentence: its tooltip and its accessible name. */
  readonly sentence: string;
  readonly dot: ChipDot;
  /** The section of the addresses it speaks of (`SitesSection.key`). */
  readonly section: string;
}

const PRODUCTION = "production";
const stageKey = (name: string) => `stage:${name}`;
const mateKey = (projectId: string) => `mate:${projectId}`;

const DOT: Record<SitesTone, ChipDot> = {
  red: "failed",
  amber: "attention",
  busy: "spinner",
  ok: "ok",
};

const status = (tone: SitesTone, word: string, sentence: string, section: string): SitesStatus => ({
  tone,
  word,
  sentence,
  section,
  dot: DOT[tone],
});

/** "fact · rest", the heading line's way of saying a fact and what follows it. */
const sentenceOf = (fact: string, rest: string | undefined) =>
  rest === undefined || rest.length === 0 ? fact : `${fact} · ${rest}`;

/** What HQ last said, never said as current while its link is paused. */
const asKnown = (chip: ProductionChip, words: string) =>
  chip.lastKnown === true ? `Last known: ${words}` : words;

/** "Stage", or the stage's own name where the project has several. */
const stageWord = (stages: HeadingLineInput["stages"], name: string) =>
  stages.length > 1 ? name : "Stage";

/** The environment tag, or nothing while every place is calm. */
export function projectSitesStatus(input: {
  readonly prodChip: ProductionChip | undefined;
  readonly stageChip: ProductionChip | undefined;
  readonly line: HeadingLineInput | undefined;
  /** What this tab watched land, while it stands (`useHeadingLine`). */
  readonly landing: HeadingLanding | undefined;
}): SitesStatus | undefined {
  const { prodChip, stageChip, landing } = input;
  const git = prodChip?.git ?? stageChip?.git;

  const production = input.line?.production;
  const stages = input.line?.stages ?? [];
  if (prodChip?.state === "down") {
    return status("red", "Down", chipFace(prodChip).words, PRODUCTION);
  }
  if (production?.coming?.kind === "failed") {
    const fact = sentenceOf("Production didn’t come up", production.coming.reason);
    return status("amber", "Didn’t come up", fact, PRODUCTION);
  }
  for (const stage of stages) {
    if (stage.coming?.kind !== "failed") continue;
    const fact = `${stageWord(stages, stage.name)} didn’t come up`;
    return status(
      "amber",
      "Didn’t come up",
      sentenceOf(fact, stage.coming.reason),
      stageKey(stage.name),
    );
  }

  if (prodChip?.git === undefined && prodChip?.state === "failed") {
    const words =
      prodChip.version === undefined
        ? "Release failed"
        : `Release failed · still runs ${prodChip.version}`;
    return status("amber", "Release failed", asKnown(prodChip, words), PRODUCTION);
  }
  if (git !== undefined)
    return git.blocked || git.standing === "partly" || git.standing === "refused"
      ? status(
          "amber",
          "Push needs attention",
          git.line,
          prodChip?.git !== undefined ? PRODUCTION : stageKey("Stage"),
        )
      : git.standing === "pushing"
        ? status(
            "busy",
            "Pushing",
            git.line,
            prodChip?.git !== undefined ? PRODUCTION : stageKey("Stage"),
          )
        : undefined;
  if (prodChip?.state === "releasing") {
    const word =
      prodChip.next === undefined
        ? "Deploying"
        : prodChip.rollsBackTo === undefined
          ? "Releasing"
          : "Rolling back";
    return status("busy", word, chipFace(prodChip).words, PRODUCTION);
  }
  if (production?.building === true) {
    return status("busy", "Deploying", "Production is deploying", PRODUCTION);
  }
  if (production?.coming?.kind === "coming") {
    const line = comingLine("Production", production.coming);
    return status("busy", "Coming up", sentenceOf(line.fact, line.rest), PRODUCTION);
  }
  for (const stage of stages) {
    if (stage.coming?.kind !== "coming") continue;
    const line = comingLine(stageWord(stages, stage.name), stage.coming);
    return status("busy", "Coming up", sentenceOf(line.fact, line.rest), stageKey(stage.name));
  }
  // No line to read: the stages' chip still says one is being set up.
  if (input.line === undefined && stageChip?.state === "creating") {
    return status("busy", "Coming up", chipFace(stageChip).words, stageKey("Stage"));
  }
  if (landing?.kind === "live") {
    return status(
      "ok",
      `${landing.version} live`,
      `${landing.version} is live · just now`,
      PRODUCTION,
    );
  }
  if (landing?.kind === "up") {
    return status(
      "ok",
      `${landing.name} is up`,
      `${landing.name} is up · just now`,
      stageKey(landing.name),
    );
  }
  return undefined;
}

/** What an address is to a Mate's person: the dev they work on, or the preview of a pair. */
export type SitesLinkRole = "dev" | "preview";

/** One address in the popover: its service (and port where it has a second), what it is, where. */
export interface SitesLink {
  readonly key: string;
  readonly service: string;
  readonly port: number | undefined;
  readonly role: SitesLinkRole | undefined;
  readonly host: string;
  readonly url: string;
}

/** A lease zcp holds on one of a Mate's dev pools, as its envelope names it (`leases[]`). */
export type SitesLease = Pick<ZeropsLease, "alias" | "pool" | "branch" | "state" | "devServers">;

/**
 * One workspace of a Mate's dev pool, as its row shows it: the lease's name and alias, what its
 * preview is doing, and the preview's address while it has one to open.
 */
export interface SitesWorkspace {
  readonly key: string;
  /** `<pool> · <branch>`, or the alias of a lease of no branch (`checkoutLabel`). */
  readonly name: string;
  /** `<pool>-<number>`, beside the name; absent where the name is the alias. */
  readonly alias: string | undefined;
  /** Its preview server's status (zcp's word), `parked`, or `no preview yet`. */
  readonly word: string;
  readonly dot: ChipDot;
  /** Its preview's address; absent while it has none to open. */
  readonly url: string | undefined;
  readonly host: string | undefined;
}

/** A Mate of the project, as its addresses are read. */
export interface SitesMateFacts {
  /** Its own Zerops project. */
  readonly projectId: string;
  readonly name: string;
  /** Its owner's first name, where it is a colleague's. */
  readonly owner: string | undefined;
  /** Its project's public routes; `undefined` while unread. */
  readonly routes: ReadonlyArray<ZeropsPublicRoute> | undefined;
  /** Its project's developer services by hostname, which name a pair's halves; `undefined` unread. */
  readonly hostnames: ReadonlyArray<string> | undefined;
  /** The control plane's hostname (the zcp service), never listed: it serves Mate itself. */
  readonly controlPlane: string | undefined;
  /** Its project's dev pools by hostname, as the services listing names them; `undefined` unread. */
  readonly pools: ReadonlyArray<string> | undefined;
  /**
   * zcp's leases as a conversation of the Mate last read them — zcp keeps one set for the whole
   * Mate; `undefined` while none is read, never none.
   */
  readonly leases: ReadonlyArray<SitesLease> | undefined;
}

const ROLE_ORDER: ReadonlyArray<SitesLinkRole | undefined> = ["dev", "preview", undefined];

/** A `{name}dev` runtime is the dev before its stage exists, as every Mate's starts. */
const isDevHostname = (hostname: string) => hostname.length > 3 && hostname.endsWith("dev");

/** A Mate's dev pools: those its services listing names, and every pool a lease is of. */
const poolsOf = (mate: SitesMateFacts): ReadonlySet<string> =>
  new Set([...(mate.pools ?? []), ...(mate.leases ?? []).map((lease) => lease.pool)]);

/**
 * A Mate's own addresses, each with what it is: its dev, the preview its pair's stage half serves
 * (`servicePairs`), then any other public service by its name alone. Never the control
 * plane, and never a dev pool's (`mateWorkspaces` lists those). `undefined` while its routes are
 * unread — never none before the answer.
 */
export function mateLinks(mate: SitesMateFacts): ReadonlyArray<SitesLink> | undefined {
  if (mate.routes === undefined) return undefined;
  const pools = poolsOf(mate);
  const routes = mate.routes.filter(
    (route) => route.service !== mate.controlPlane && !pools.has(route.service),
  );
  // Routes and list are read separately: a routed service is held even before the list shows it.
  const held = [...new Set([...(mate.hostnames ?? []), ...routes.map((route) => route.service)])];
  const { devOf } = servicePairs({ services: held.map((hostname) => ({ hostname })) });
  // A pair's dev half is its dev where the pair has a preview to show.
  const devs = new Set(
    routes.flatMap((route) => {
      const dev = devOf.get(route.service);
      return dev === undefined ? [] : [dev];
    }),
  );
  const roleOf = (service: string): SitesLinkRole | undefined => {
    if (devOf.has(service)) return "preview";
    return devs.has(service) || isDevHostname(service) ? "dev" : undefined;
  };
  return routeMenuEntries(routes)
    .map((entry) => ({ ...entry, role: roleOf(entry.service) }))
    .toSorted((left, right) => ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role));
}

/** What a preview server's status says, as its dot: zcp's word verbatim, an unknown one neutral. */
const SERVER_DOT: Readonly<Record<string, ChipDot>> = {
  running: "ok",
  starting: "spinner",
  crashed: "failed",
  stopped: "off",
};

const hostOf = (url: string) => url.replace(/^https?:\/\//u, "").replace(/\/$/u, "");

/**
 * A Mate's workspaces: one row per lease zcp still holds on its dev pools (held or parked), in
 * name order. A free or warm slot is no lease and never shows; nor does one zcp no longer holds.
 * A row says its preview server's status and opens its preview (the server zcp read with an
 * address); a parked lease's container is stopped, so it says parked and opens nothing; one with
 * no preview read, or whose address is no web address, says so. None while the leases are not read.
 */
function mateWorkspaces(mate: SitesMateFacts): ReadonlyArray<SitesWorkspace> {
  const held = (mate.leases ?? []).filter((lease) => isZeropsLeaseHeld(lease.state));
  const named = held.map((lease) => ({
    alias: lease.alias,
    pool: lease.pool,
    branch: lease.branch === undefined || lease.branch === "" ? null : lease.branch,
  }));
  return held
    .map((lease): SitesWorkspace => {
      const name = checkoutLabel(lease.alias, named);
      const preview = (lease.devServers ?? []).find(
        (server) => server.url !== undefined && isServiceBrowserUrl(server.url),
      );
      const base = {
        key: `workspace:${lease.alias}`,
        name,
        alias: name === lease.alias ? undefined : lease.alias,
      };
      if (lease.state === "parked")
        return { ...base, word: "parked", dot: "hollow", url: undefined, host: undefined };
      if (preview?.url === undefined)
        return { ...base, word: "no preview yet", dot: "off", url: undefined, host: undefined };
      return {
        ...base,
        word: preview.status,
        dot: SERVER_DOT[preview.status] ?? "off",
        url: preview.url,
        host: hostOf(preview.url),
      };
    })
    .toSorted(
      (left, right) =>
        left.name.localeCompare(right.name, "en") ||
        left.key.localeCompare(right.key, "en", { numeric: true }),
    );
}

const placeLinks = (routes: ReadonlyArray<ZeropsPublicRoute>): ReadonlyArray<SitesLink> =>
  routeMenuEntries(routes).map((entry) => ({ ...entry, role: undefined }));

/** One section of the popover: a place with its state, or a Mate. */
export type SitesSection =
  | {
      readonly kind: "place";
      readonly key: string;
      readonly title: string;
      readonly place: "production" | "stage";
      /** Its row in the place's menu; `undefined` while the place is not read. */
      readonly stop: ChipMenuStop | undefined;
      /** `undefined` while unread. */
      readonly links: ReadonlyArray<SitesLink> | undefined;
    }
  | {
      readonly kind: "mate";
      readonly key: string;
      readonly title: string;
      readonly projectId: string;
      readonly owner: string | undefined;
      /** `undefined` while unread. */
      readonly links: ReadonlyArray<SitesLink> | undefined;
      /** Its dev pools' workspaces (`mateWorkspaces`), listed before its addresses. */
      readonly workspaces: ReadonlyArray<SitesWorkspace>;
    };

/**
 * The popover's sections, in order: production, each stage (and each being created), then each
 * Mate in the order given. Every address appears once, where it first appears. A Mate with no
 * address and no workspace shows no section; one not read yet shows a reading one, as does a place
 * the project has but has not read.
 */
export function projectSitesSections(input: {
  readonly production: ChipMenuModel | undefined;
  /** The project has a production its chip has not read yet. */
  readonly productionUnread: boolean;
  readonly stages: ChipMenuModel | undefined;
  /** Stages the project has, by name, whose chip has not read them yet. */
  readonly unreadStages: ReadonlyArray<string>;
  /** A place's routes: its public access as read, else what its listing holds (`stop.routes`). */
  readonly placeRoutes: (stop: ChipMenuStop) => ReadonlyArray<ZeropsPublicRoute>;
  readonly mates: ReadonlyArray<SitesMateFacts>;
}): ReadonlyArray<SitesSection> {
  const seen = new Set<string>();
  const once = (links: ReadonlyArray<SitesLink>) =>
    links.filter((link) => {
      if (seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    });
  const place = (stop: ChipMenuStop, kind: "production" | "stage"): SitesSection => ({
    kind: "place",
    key: kind === "production" ? PRODUCTION : stageKey(stop.name),
    title: kind === "production" ? "Production" : stop.name,
    place: kind,
    stop,
    links: stop.git === undefined ? once(placeLinks(input.placeRoutes(stop))) : [],
  });
  const unread = (name: string, kind: "production" | "stage"): SitesSection => ({
    kind: "place",
    key: kind === "production" ? PRODUCTION : stageKey(name),
    title: kind === "production" ? "Production" : name,
    place: kind,
    stop: undefined,
    links: undefined,
  });
  const places: Array<SitesSection> = [
    ...(input.production?.stops.map((stop) => place(stop, "production")) ??
      (input.productionUnread ? [unread("production", "production")] : [])),
    ...(input.stages?.stops.map((stop) => place(stop, "stage")) ??
      input.unreadStages.map((name) => unread(name, "stage"))),
  ];
  const mates = input.mates.flatMap((mate): ReadonlyArray<SitesSection> => {
    const links = mateLinks(mate);
    const kept = links === undefined ? undefined : once(links);
    const workspaces = mateWorkspaces(mate);
    if (kept !== undefined && kept.length === 0 && workspaces.length === 0) return [];
    return [
      {
        kind: "mate",
        key: mateKey(mate.projectId),
        title: mate.name,
        projectId: mate.projectId,
        owner: mate.owner,
        links: kept,
        workspaces,
      },
    ];
  });
  return [...places, ...mates];
}

/** How many rows the sections list: every address, and every workspace of a Mate's dev pools. */
export function sitesLinkCount(sections: ReadonlyArray<SitesSection>): number {
  return sections.reduce(
    (count, section) =>
      count +
      (section.links?.length ?? 0) +
      (section.kind === "mate" ? section.workspaces.length : 0),
    0,
  );
}

/**
 * Whether the project has no address anywhere: the sections list none, and no Mate has a dev pool
 * whose leases are not read — those may hold workspaces nobody has read yet.
 */
export function sitesHoldNothing(
  sections: ReadonlyArray<SitesSection>,
  mates: ReadonlyArray<SitesMateFacts>,
): boolean {
  return (
    sitesLinkCount(sections) === 0 &&
    mates.every((mate) => mate.leases !== undefined || (mate.pools ?? []).length === 0)
  );
}

/**
 * The sections a filter leaves: the addresses whose service, role, host, section or owner holds
 * every word of it, and the workspaces whose name, alias, state or preview does; a section left
 * with nothing hides. An empty filter keeps everything.
 */
export function filterSites(
  sections: ReadonlyArray<SitesSection>,
  query: string,
): ReadonlyArray<SitesSection> {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return sections;
  return sections.flatMap((section): ReadonlyArray<SitesSection> => {
    const whose = [section.title, section.kind === "mate" ? section.owner : undefined];
    const holds = (parts: ReadonlyArray<string | undefined>) => {
      const said = [...whose, ...parts]
        .filter((part) => part !== undefined)
        .join(" ")
        .toLocaleLowerCase();
      return words.every((word) => said.includes(word));
    };
    const links = (section.links ?? []).filter((link) =>
      holds([link.service, link.role, link.host]),
    );
    if (section.kind === "place") return links.length === 0 ? [] : [{ ...section, links }];
    const workspaces = section.workspaces.filter((workspace) =>
      holds([workspace.name, workspace.alias, workspace.word, workspace.host]),
    );
    return links.length === 0 && workspaces.length === 0 ? [] : [{ ...section, links, workspaces }];
  });
}

/**
 * Production's address, which a ⌘-click on the globe opens straight away — only where it is the
 * only one (`placeAddresses`: a second port of a service is the same page). With several parts'
 * addresses none stands for production: the click offers each to open (MODEL §6).
 */
export function productionUrl(production: ChipMenuModel | undefined): string | undefined {
  const addresses = placeAddresses(production?.stops.flatMap((stop) => stop.routes) ?? []);
  return addresses.length === 1 ? addresses[0]?.url : undefined;
}
