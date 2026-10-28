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
  mateParts,
  type MatePart,
  type MatePartEntry,
  type MatePartLease,
  type MatePartLeaseChat,
} from "@t3tools/client-runtime/zerops/mateParts";
import type { PoolPair } from "@t3tools/client-runtime/zerops/servicePairs";

import {
  chipFace,
  placeTitle,
  type ChipDot,
  type ChipMenuModel,
  type ChipMenuStop,
  type ProductionChip,
} from "./SidebarProductionChip.logic";
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
/** A stage's section, by its name in any case: the heading line speaks of it by its title. */
const stageKey = (name: string) => `stage:${name.toLocaleLowerCase("en")}`;
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
  stages.length > 1 ? placeTitle(name) : "Stage";

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

/** A lease zcp holds on one of a Mate's dev pools, as its newest envelope names it (`leases[]`). */
export type SitesLease = MatePartLease;

/** One entry of a part: its dev workspace or its preview (`MatePartEntry`). */
export type SitesSide = MatePartEntry;

/** A part of a Mate's application: its friendly name, its dev entries and its preview. */
export type SitesPair = MatePart;

/** A Mate's addresses: its parts, then its other addresses. */
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
  /** The pairs its envelope keys by a dev pool; none unread. */
  readonly poolPairs: ReadonlyArray<PoolPair> | undefined;
  /** The Mate's chats bound to its leases, by title: what each workspace is for. */
  readonly leaseChats?: ReadonlyArray<MatePartLeaseChat> | undefined;
}

/**
 * Whether a Sites list reads a Mate's leases: only a dev pool's workspaces come from them, so a
 * Mate whose services listing names no pool (or is not read yet) holds no lifecycle feed open.
 */
export const readsLeases = (mate: Pick<SitesMateFacts, "pools">): boolean =>
  (mate.pools ?? []).length > 0;

/**
 * A Mate's addresses: its parts (`mateParts`, the one reader every surface shows them from), then
 * every other public service by its name alone. Never the control plane. `undefined` while its
 * routes are unread — never none before the answer.
 */
export function mateLinks(mate: SitesMateFacts): SitesMateAddresses | undefined {
  if (mate.routes === undefined) return undefined;
  const { parts, others } = mateParts({
    services: (mate.hostnames ?? []).map((hostname) => ({ hostname })),
    routes: mate.routes,
    controlPlane: mate.controlPlane,
    pools: mate.pools,
    poolPairs: mate.poolPairs,
    leases: mate.leases,
    leaseChats: mate.leaseChats,
  });
  return { pairs: parts, links: others };
}

const placeLinks = (routes: ReadonlyArray<ZeropsPublicRoute>): ReadonlyArray<SitesLink> =>
  routeMenuEntries(routes).map(({ key, service, port, host, url }) => ({
    key,
    service,
    port,
    host,
    url,
  }));

/** A part's entries as its row lists them: its dev entries, then its preview. */
export const partEntries = (pair: SitesPair): ReadonlyArray<SitesSide> =>
  pair.preview === undefined ? pair.dev : [...pair.dev, pair.preview];

/** One section of the popover: a place with its state, or a Mate. */
export type SitesSection =
  | {
      readonly kind: "place";
      readonly key: string;
      readonly title: string;
      readonly place: "production" | "stage";
      /**
       * Nothing is deployed there: one quiet row, its title and its state word — no address, no
       * domain or address offer, nothing to manage yet.
       */
      readonly quiet: boolean;
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
  const place = (stop: ChipMenuStop, kind: "production" | "stage"): SitesSection => {
    const quiet = stop.git === undefined && stop.empty === true;
    return {
      kind: "place",
      key: kind === "production" ? PRODUCTION : stageKey(stop.name),
      title: kind === "production" ? "Production" : placeTitle(stop.name),
      place: kind,
      quiet,
      stop,
      links: stop.git === undefined && !quiet ? once(placeLinks(input.placeRoutes(stop))) : [],
    };
  };
  const unread = (name: string, kind: "production" | "stage"): SitesSection => ({
    kind: "place",
    key: kind === "production" ? PRODUCTION : stageKey(name),
    title: kind === "production" ? "Production" : placeTitle(name),
    place: kind,
    quiet: false,
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
              sides + partEntries(pair).filter((side) => side.url !== undefined).length,
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
      holds([pair.name, ...partEntries(pair).flatMap((side) => [side.label, side.host])]),
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
