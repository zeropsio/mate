/**
 * A project's places on its row: the environment tag that speaks only when a place is not calm,
 * and the addresses its globe opens — production's, each stage's, then every Mate's, each address
 * once.
 *
 * Sites is addresses: the places a person opens to follow along. Shared environments keep their
 * own sections. Under each Mate, one row per part, its pair side by side: the part's name, its dev
 * (the dev service's own address, or for a dev pool each workspace zcp holds on it, by the preview
 * zcp read there) and its stage; then the Mate's other addresses. A pool's per-slot routes are
 * never a workspace's address, and no work, status or lease shows.
 *
 * The tag says one thing, the highest of: production down; an environment that did not come up;
 * the newest release failed while the old one serves; a release going out or production
 * deploying; a stage or production coming up; what this tab watched land, for `LANDING_MS`. A
 * stage deploying never shows at rest: it is the stage's own business until it fails.
 *
 * Pure: no clock of its own, no platform globals.
 */
import { comingLine, placeAddresses, type ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import {
  partName,
  poolPartName,
  servicePairs,
  type PoolPair,
} from "@t3tools/client-runtime/zerops/servicePairs";
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

/** One address in the popover: its service (and port where it has a second), where. */
export interface SitesLink {
  readonly key: string;
  readonly service: string;
  readonly port: number | undefined;
  readonly host: string;
  readonly url: string;
}

/** A lease zcp holds on one of a Mate's dev pools, as its envelope names it (`leases[]`). */
export type SitesLease = Pick<ZeropsLease, "alias" | "pool" | "state" | "devServers" | "part">;

/** One side of a part's pair, as its row shows it: its address, or why it has none. */
export interface SitesSide {
  readonly key: string;
  /** `dev`, `dev 2` for a pool's second workspace, `stage`. */
  readonly label: string;
  /** Its address; absent where it has none, and `why` says why. */
  readonly url: string | undefined;
  readonly host: string | undefined;
  /** Its other ports' hosts, which its tooltip lists after its own. */
  readonly more: ReadonlyArray<string>;
  /** `not running`, `paused`, `no address yet`: only where it has no address. */
  readonly why: string | undefined;
}

/** A part of a Mate's application: its name, and its pair's dev and stage side by side. */
export interface SitesPair {
  readonly key: string;
  readonly name: string;
  /** Its dev side: the dev service's address, or each workspace zcp holds on its pool; none for a pool with none. */
  readonly dev: ReadonlyArray<SitesSide>;
  readonly stage: ReadonlyArray<SitesSide>;
}

/** A Mate's addresses: its parts' pairs, then its other addresses. */
export interface SitesMateAddresses {
  readonly pairs: ReadonlyArray<SitesPair>;
  readonly links: ReadonlyArray<SitesLink>;
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
  /** The pairs its envelope keys by a dev pool, the part each serves among them; none unread. */
  readonly poolPairs: ReadonlyArray<PoolPair> | undefined;
}

/** A `{name}dev` runtime is the dev before its stage exists, as every Mate's starts. */
const isDevHostname = (hostname: string) => hostname.length > 3 && hostname.endsWith("dev");

/**
 * Whether a Sites list reads a Mate's leases: only a dev pool's workspaces come from them, so a
 * Mate whose services listing names no pool (or is not read yet) holds no lifecycle feed open.
 */
export const readsLeases = (mate: Pick<SitesMateFacts, "pools">): boolean =>
  (mate.pools ?? []).length > 0;

/** A Mate's dev pools: those its services listing names, and every pool a lease is of. */
const poolsOf = (mate: SitesMateFacts): ReadonlySet<string> =>
  new Set([...(mate.pools ?? []), ...(mate.leases ?? []).map((lease) => lease.pool)]);

const hostOf = (url: string) => url.replace(/^https?:\/\//u, "").replace(/\/$/u, "");

/** A pool's part, by name: the part zcp names for its leases or its pair, else the pool's stem. */
const poolName = (mate: SitesMateFacts, pool: string): string => {
  const part =
    (mate.leases ?? []).find((lease) => lease.pool === pool && lease.part !== undefined)?.part ??
    mate.poolPairs?.find((pair) => pair.pool === pool)?.stages.find((stage) => stage.part)?.part;
  return part === undefined ? poolPartName(pool) : partName(part);
};

/** Why a server zcp read has no address to open: it ended, or it has none yet. */
const ENDED: ReadonlySet<string> = new Set(["stopped", "crashed"]);

/**
 * A pool's dev side: one per workspace zcp holds on it (held or parked), in alias order — `dev`,
 * `dev 2` — each by the preview zcp last read there. One without an address says why: paused while
 * parked, not running once its server ended, no address yet otherwise. None for a pool zcp holds
 * nothing on: a pool's own slot routes balance over every container, so they are nobody's
 * workspace.
 */
function poolDevs(mate: SitesMateFacts, pool: string): ReadonlyArray<SitesSide> {
  return (mate.leases ?? [])
    .filter((lease) => lease.pool === pool && isZeropsLeaseHeld(lease.state))
    .toSorted((left, right) => left.alias.localeCompare(right.alias, "en", { numeric: true }))
    .map((lease, index): SitesSide => {
      const label = index === 0 ? "dev" : `dev ${String(index + 1)}`;
      const servers = lease.devServers ?? [];
      const preview = servers.find(
        (server) => server.url !== undefined && isServiceBrowserUrl(server.url),
      );
      // Where zcp reads no preview, a slot's own route could stand in once slots map to ports.
      const url = lease.state === "parked" ? undefined : preview?.url;
      if (url !== undefined)
        return {
          key: `dev:${lease.alias}`,
          label,
          url,
          host: hostOf(url),
          more: [],
          why: undefined,
        };
      const why =
        lease.state === "parked"
          ? "paused"
          : servers.some((server) => ENDED.has(server.status))
            ? "not running"
            : "no address yet";
      return { key: `dev:${lease.alias}`, label, url: undefined, host: undefined, more: [], why };
    });
}

/**
 * A Mate's addresses: one row per part, its pair (`servicePairs`) side by side — the dev, then the
 * stage — and a dev with no stage yet a part all the same; then every other public service by its
 * name alone. A plain dev's side is its own address; a pool's is each workspace zcp holds on it
 * (`poolDevs`), never the pool's routes. A side with several web ports opens the first and lists
 * the rest in its tooltip. Never the control plane. `undefined` while its routes are unread —
 * never none before the answer.
 */
export function mateLinks(mate: SitesMateFacts): SitesMateAddresses | undefined {
  if (mate.routes === undefined) return undefined;
  const pools = poolsOf(mate);
  const routes = mate.routes.filter(
    (route) => route.service !== mate.controlPlane && !pools.has(route.service),
  );
  // Routes and list are read separately: a routed service is held even before the list shows it.
  const held = [
    ...new Set([...(mate.hostnames ?? []), ...routes.map((route) => route.service), ...pools]),
  ];
  const { pairs } = servicePairs({
    services: held.map((hostname) => ({ hostname })),
    poolPairs: mate.poolPairs,
    pools: [...pools],
  });
  const entries = routeMenuEntries(routes);
  const sideOf = (service: string, label: string): ReadonlyArray<SitesSide> => {
    const [first, ...rest] = entries.filter((entry) => entry.service === service);
    return first === undefined
      ? []
      : [
          {
            key: first.key,
            label,
            url: first.url,
            host: first.host,
            more: rest.map((entry) => entry.host),
            why: undefined,
          },
        ];
  };
  const devSide = (hostname: string) =>
    pools.has(hostname) ? poolDevs(mate, hostname) : sideOf(hostname, "dev");
  const nameOf = (hostname: string, stem: string) =>
    pools.has(hostname) ? poolName(mate, hostname) : partName(stem);
  const used = new Set<string>();
  const rows: Array<SitesPair> = [];
  for (const pair of pairs) {
    used.add(pair.dev);
    for (const preview of pair.previews) used.add(preview.hostname);
    const stage = pair.previews.flatMap((preview, index) =>
      sideOf(preview.hostname, index === 0 ? "stage" : `stage ${String(index + 1)}`),
    );
    const dev = devSide(pair.dev);
    if (dev.length + stage.length > 0)
      rows.push({ key: `pair:${pair.dev}`, name: nameOf(pair.dev, pair.name), dev, stage });
  }
  for (const hostname of held) {
    if (used.has(hostname) || !(pools.has(hostname) || isDevHostname(hostname))) continue;
    used.add(hostname);
    const dev = devSide(hostname);
    if (dev.length > 0)
      rows.push({
        key: `pair:${hostname}`,
        name: nameOf(hostname, hostname.slice(0, -"dev".length)),
        dev,
        stage: [],
      });
  }
  return {
    pairs: rows.toSorted((left, right) => left.name.localeCompare(right.name, "en")),
    links: entries
      .filter((entry) => !used.has(entry.service))
      .map(({ key, service, port, host, url }) => ({ key, service, port, host, url })),
  };
}

const placeLinks = (routes: ReadonlyArray<ZeropsPublicRoute>): ReadonlyArray<SitesLink> =>
  routeMenuEntries(routes).map(({ key, service, port, host, url }) => ({
    key,
    service,
    port,
    host,
    url,
  }));

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
      /** Its other addresses; `undefined` while unread. */
      readonly links: ReadonlyArray<SitesLink> | undefined;
      /** Its parts, each with its dev and its stage. */
      readonly pairs: ReadonlyArray<SitesPair>;
    };

/**
 * The popover's sections, in order: production, each stage (and each being created), then each
 * Mate in the order given. Every address appears once, where it first appears. A Mate with no
 * address and no part's preview shows no section; one not read yet shows a reading one, as does a place
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
    const addresses = mateLinks(mate);
    // Its parts, then its other addresses; while those are unread, it reads.
    const kept = addresses === undefined ? undefined : once(addresses.links);
    const pairs = addresses?.pairs ?? [];
    if (kept !== undefined && kept.length === 0 && pairs.length === 0) return [];
    return [
      {
        kind: "mate",
        key: mateKey(mate.projectId),
        title: mate.name,
        projectId: mate.projectId,
        owner: mate.owner,
        links: kept,
        pairs,
      },
    ];
  });
  return [...places, ...mates];
}

/** How many addresses the sections list: every address, and each side of a part that has one. */
export function sitesLinkCount(sections: ReadonlyArray<SitesSection>): number {
  return sections.reduce(
    (count, section) =>
      count +
      (section.links?.length ?? 0) +
      (section.kind === "mate"
        ? section.pairs.reduce(
            (sides, pair) =>
              sides + [...pair.dev, ...pair.stage].filter((side) => side.url !== undefined).length,
            0,
          )
        : 0),
    0,
  );
}

/**
 * Whether the project has no address anywhere: the sections list none, and no Mate has a dev pool
 * whose leases are not read — those may hold previews nobody has read yet.
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
 * The sections a filter leaves: the addresses whose service, host, section or owner holds every
 * word of it, and the parts whose name, sides or hosts do; a section left with nothing hides. An
 * empty filter keeps everything.
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
    const links = (section.links ?? []).filter((link) => holds([link.service, link.host]));
    if (section.kind === "place") return links.length === 0 ? [] : [{ ...section, links }];
    const pairs = section.pairs.filter((pair) =>
      holds([
        pair.name,
        ...[...pair.dev, ...pair.stage].flatMap((side) => [side.label, side.host]),
      ]),
    );
    return links.length === 0 && pairs.length === 0 ? [] : [{ ...section, links, pairs }];
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
