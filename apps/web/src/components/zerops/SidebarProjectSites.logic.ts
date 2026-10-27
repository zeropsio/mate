/**
 * A project's places on its row: the environment tag that speaks only when a place is not calm,
 * and the addresses its globe opens — production's, each stage's, then every Mate's, each address
 * once.
 *
 * Each section is what it represents. Production. Main, which runs what is merged: one row per part,
 * named by the part (Web, HQ), opening that part's stage — the stage place and every Mate's stages.
 * Then each Mate: its own addresses, and one group per piece of work it holds leases for, headed by
 * the work (its change's title, else its conversation's, else "Work in progress") with one row per
 * part the work touches: the part's name, its preview's status, its preview. A pool's ports, a
 * lease's alias, its branch: none of it shows, since a person never manages leases.
 *
 * The tag says one thing, the highest of: production down; an environment that did not come up;
 * the newest release failed while the old one serves; a release going out or production
 * deploying; a stage or production coming up; what this tab watched land, for `LANDING_MS`. A
 * stage deploying never shows at rest: it is the stage's own business until it fails.
 *
 * Pure: no clock of its own, no platform globals.
 */
import { comingLine, placeAddresses, type ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { leaseOfRepository } from "@t3tools/client-runtime/zerops";
import {
  isStageHostname,
  partName,
  poolPartName,
  servicePairs,
  stagePartName,
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
export type SitesLease = Pick<
  ZeropsLease,
  "alias" | "pool" | "branch" | "repo" | "acquiredAt" | "state" | "devServers" | "part" | "stage"
>;

/** One of a Mate's conversations bound to a lease, as its shell reads it (`ThreadLease`). */
export interface SitesConversation {
  readonly key: string;
  readonly title: string;
  readonly lease: {
    readonly alias: string;
    readonly branch: string | null;
    readonly acquiredAt?: string | undefined;
  };
}

/** A Mate's change at HQ, as the project's flow carries it (`FlowPullRequest`). */
export interface SitesChange {
  readonly mateProjectId: string;
  readonly branch?: string | undefined;
  readonly repositoryUrl?: string | undefined;
  readonly number: number;
  readonly title: string;
}

/** What a part's preview is doing, in a person's words; none before any read. */
export type SitesPartStatus = "running" | "starting" | "crashed" | "paused" | "not running";

/** One part a piece of work touches: its name, its preview's status, the preview to open. */
export interface SitesPart {
  readonly key: string;
  readonly name: string;
  readonly status: SitesPartStatus | undefined;
  readonly url: string | undefined;
  readonly host: string | undefined;
  /**
   * The request that starts its preview, written for the Mate to read in the conversation of the
   * work's branch; absent while it runs, starts, or was never read.
   */
  readonly start:
    | {
        readonly request: string;
        readonly branch: string | undefined;
        readonly repositoryUrl: string | undefined;
      }
    | undefined;
}

/** A piece of a Mate's work: the leases of one branch, headed by what the work is. */
export interface SitesWork {
  readonly key: string;
  /** Its change's title and number, else its conversation's title, else "Work in progress". */
  readonly title: string;
  /** Its branch and aliases, for the heading's tooltip alone. */
  readonly tooltip: string;
  readonly parts: ReadonlyArray<SitesPart>;
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
  /** The part each of its stages serves, by the stage's hostname, as zcp's pairs name it. */
  readonly stageParts: Readonly<Record<string, string>> | undefined;
  /** Its conversations bound to a lease; `undefined` while its conversations are not read. */
  readonly conversations: ReadonlyArray<SitesConversation> | undefined;
  /** Its changes at HQ, open or landed. */
  readonly changes: ReadonlyArray<SitesChange>;
}

const ROLE_ORDER: ReadonlyArray<SitesLinkRole | undefined> = ["dev", "preview", undefined];

/** A `{name}dev` runtime is the dev before its stage exists, as every Mate's starts. */
const isDevHostname = (hostname: string) => hostname.length > 3 && hostname.endsWith("dev");

/**
 * Whether a Sites list reads a Mate's leases: only a dev pool's previews come from them, so a
 * Mate whose services listing names no pool (or is not read yet) holds no lifecycle feed open.
 */
export const readsLeases = (mate: Pick<SitesMateFacts, "pools">): boolean =>
  (mate.pools ?? []).length > 0;

/** A Mate's dev pools: those its services listing names, and every pool a lease is of. */
const poolsOf = (mate: SitesMateFacts): ReadonlySet<string> =>
  new Set([...(mate.pools ?? []), ...(mate.leases ?? []).map((lease) => lease.pool)]);

/**
 * A Mate's own addresses, each with what it is: its dev, the preview its pair's stage half serves
 * (`servicePairs`), then any other public service by its name alone. Never the control
 * plane, and never a dev pool's (`poolPreviews` lists those). `undefined` while its routes are
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

const hostOf = (url: string) => url.replace(/^https?:\/\//u, "").replace(/\/$/u, "");

export const WORK_IN_PROGRESS = "Work in progress";

/** The stage that runs what is merged, as the popover names it. */
const MAIN = "Main";
const MAIN_KEY = "main";

/** A preview server's status, in a person's words: zcp's `stopped` is not running. */
const STATUS: Readonly<Record<string, SitesPartStatus>> = {
  running: "running",
  starting: "starting",
  crashed: "crashed",
  stopped: "not running",
};

/** Opens its preview only while it runs or starts: a stopped or crashed server serves nothing. */
const SERVES: ReadonlySet<SitesPartStatus | undefined> = new Set([
  "running",
  "starting",
  "crashed",
]);

/** A lease's part and its preview's status, from the last read of its dev servers; none unread. */
function partOf(lease: SitesLease): Omit<SitesPart, "start"> & { readonly startable: boolean } {
  const name = lease.part === undefined ? poolPartName(lease.pool) : partName(lease.part);
  const servers = lease.devServers;
  const preview =
    servers?.find((server) => server.url !== undefined && isServiceBrowserUrl(server.url)) ??
    servers?.[0];
  const status: SitesPartStatus | undefined =
    lease.state === "parked"
      ? "paused"
      : servers === undefined
        ? undefined
        : preview === undefined
          ? "not running"
          : STATUS[preview.status];
  const url =
    SERVES.has(status) && preview?.url !== undefined && isServiceBrowserUrl(preview.url)
      ? preview.url
      : undefined;
  return {
    key: `part:${lease.alias}`,
    name,
    status,
    url,
    host: url === undefined ? undefined : hostOf(url),
    startable: status === "not running" || status === "crashed" || status === "paused",
  };
}

/** The Mate's newest change on a lease's branch, of the repository the lease names. */
const changeOf = (mate: SitesMateFacts, lease: SitesLease): SitesChange | undefined =>
  mate.changes
    .filter(
      (change) =>
        change.mateProjectId === mate.projectId &&
        lease.branch !== undefined &&
        change.branch === lease.branch &&
        leaseOfRepository(lease.repo, change.repositoryUrl),
    )
    .reduce<SitesChange | undefined>(
      (newest, change) => (newest === undefined || change.number > newest.number ? change : newest),
      undefined,
    );

/** The conversation bound to a lease: of its alias, and of its acquire where both say one. */
const conversationOf = (mate: SitesMateFacts, lease: SitesLease): SitesConversation | undefined =>
  mate.conversations?.find(
    ({ lease: binding }) =>
      binding.alias === lease.alias &&
      (binding.acquiredAt === undefined ||
        lease.acquiredAt === undefined ||
        binding.acquiredAt === lease.acquiredAt),
  );

/**
 * A Mate's work: its held leases grouped by repository and branch (a lease of no branch is work
 * of its own), each group headed by what the work is and listing each part it touches. In title
 * order, "Work in progress" last; none while the leases are not read.
 */
function mateWorks(mate: SitesMateFacts): ReadonlyArray<SitesWork> {
  const groups = new Map<string, Array<SitesLease>>();
  for (const lease of mate.leases ?? []) {
    if (!isZeropsLeaseHeld(lease.state)) continue;
    const key =
      lease.branch === undefined || lease.branch === ""
        ? `alias:${lease.alias}`
        : `branch:${lease.repo ?? ""}:${lease.branch}`;
    groups.set(key, [...(groups.get(key) ?? []), lease]);
  }
  return [...groups]
    .map(([key, leases]): SitesWork => {
      const change = leases
        .map((lease) => changeOf(mate, lease))
        .find((found) => found !== undefined);
      const conversation = leases
        .map((lease) => conversationOf(mate, lease))
        .find((found) => found !== undefined);
      const title =
        change !== undefined
          ? `${change.title} · #${String(change.number)}`
          : (conversation?.title ?? WORK_IN_PROGRESS);
      const branch = leases[0]?.branch;
      const aliases = leases.map((lease) => lease.alias).join(", ");
      return {
        key: `work:${key}`,
        title,
        tooltip: branch === undefined || branch === "" ? aliases : `Branch ${branch} · ${aliases}`,
        parts: leases
          .map((lease): SitesPart => {
            const { startable, ...part } = partOf(lease);
            const about = title === WORK_IN_PROGRESS ? "" : ` for “${change?.title ?? title}”`;
            return {
              ...part,
              start: startable
                ? {
                    request: `Start the ${part.name} preview${about}.`,
                    branch: branch === undefined || branch === "" ? undefined : branch,
                    repositoryUrl: change?.repositoryUrl,
                  }
                : undefined,
            };
          })
          .toSorted(
            (left, right) =>
              left.name.localeCompare(right.name, "en") ||
              left.key.localeCompare(right.key, "en", { numeric: true }),
          ),
      };
    })
    .toSorted(
      (left, right) =>
        Number(left.title === WORK_IN_PROGRESS) - Number(right.title === WORK_IN_PROGRESS) ||
        left.title.localeCompare(right.title, "en") ||
        (left.parts[0]?.name ?? "").localeCompare(right.parts[0]?.name ?? "", "en"),
    );
}

/** The part each of a Mate's stages serves, by the stage's hostname: zcp's pairs, its leases. */
const stagePartsOf = (mate: SitesMateFacts): ReadonlyMap<string, string> => {
  const parts = new Map<string, string>(Object.entries(mate.stageParts ?? {}));
  for (const lease of mate.leases ?? []) {
    if (lease.stage !== undefined && lease.part !== undefined) parts.set(lease.stage, lease.part);
  }
  return parts;
};

/**
 * A Mate's own addresses split from its stages, which Main lists: a stage is its pair's stage half,
 * a `{name}stage` service, or one zcp names a part's stage — each named by the part it serves.
 */
function splitStages(
  mate: SitesMateFacts,
  links: ReadonlyArray<SitesLink>,
): { readonly own: ReadonlyArray<SitesLink>; readonly stages: ReadonlyArray<SitesLink> } {
  const parts = stagePartsOf(mate);
  const isStage = (link: SitesLink) =>
    link.role === "preview" || isStageHostname(link.service) || parts.has(link.service);
  return {
    own: links.filter((link) => !isStage(link)),
    stages: links.filter(isStage).map((link) => {
      const part = parts.get(link.service);
      return {
        ...link,
        service: part === undefined ? stagePartName(link.service) : partName(part),
        role: undefined,
      };
    }),
  };
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
      /** Main, which runs what is merged, where no single stage place holds it. */
      readonly kind: "main";
      readonly key: string;
      readonly title: string;
      readonly links: ReadonlyArray<SitesLink>;
    }
  | {
      readonly kind: "mate";
      readonly key: string;
      readonly title: string;
      readonly projectId: string;
      readonly owner: string | undefined;
      /** Its own addresses, never a stage (Main lists those); `undefined` while unread. */
      readonly links: ReadonlyArray<SitesLink> | undefined;
      /** Its work, each piece by what it is, with the parts it touches. */
      readonly works: ReadonlyArray<SitesWork>;
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
  // One stage place is Main, which runs what is merged; several keep their own names.
  const stageCount = input.stages?.stops.length ?? input.unreadStages.length;
  const stageTitle = (name: string) => (stageCount === 1 ? MAIN : name);
  const place = (stop: ChipMenuStop, kind: "production" | "stage"): SitesSection => ({
    kind: "place",
    key: kind === "production" ? PRODUCTION : stageKey(stop.name),
    title: kind === "production" ? "Production" : stageTitle(stop.name),
    place: kind,
    stop,
    links:
      stop.git !== undefined
        ? []
        : once(placeLinks(input.placeRoutes(stop))).map((link) =>
            kind === "stage" ? { ...link, service: stagePartName(link.service) } : link,
          ),
  });
  const unread = (name: string, kind: "production" | "stage"): SitesSection => ({
    kind: "place",
    key: kind === "production" ? PRODUCTION : stageKey(name),
    title: kind === "production" ? "Production" : stageTitle(name),
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
  const mateStages: Array<SitesLink> = [];
  const mates = input.mates.flatMap((mate): ReadonlyArray<SitesSection> => {
    const links = mateLinks(mate);
    const split = links === undefined ? undefined : splitStages(mate, links);
    mateStages.push(...(split?.stages ?? []));
    const own = split === undefined ? undefined : once(split.own);
    const works = mateWorks(mate);
    if (own !== undefined && own.length === 0 && works.length === 0) return [];
    return [
      {
        kind: "mate",
        key: mateKey(mate.projectId),
        title: mate.name,
        projectId: mate.projectId,
        owner: mate.owner,
        links: own,
        works,
      },
    ];
  });
  // The Mates' stages join Main: the one stage place where it lists its own, else a Main of theirs.
  const stages = once(mateStages).toSorted((left, right) =>
    left.service.localeCompare(right.service, "en"),
  );
  if (stages.length === 0) return [...places, ...mates];
  const mainAt = places.findIndex(
    (section) =>
      section.kind === "place" &&
      section.title === MAIN &&
      section.stop !== undefined &&
      section.stop.git === undefined,
  );
  const main = places[mainAt];
  if (main !== undefined && main.links !== undefined) {
    return [
      ...places.slice(0, mainAt),
      { ...main, links: [...main.links, ...stages] },
      ...places.slice(mainAt + 1),
      ...mates,
    ];
  }
  return [...places, { kind: "main", key: MAIN_KEY, title: MAIN, links: stages }, ...mates];
}

/** How many addresses the sections list: every address, and each part's preview. */
export function sitesLinkCount(sections: ReadonlyArray<SitesSection>): number {
  return sections.reduce(
    (count, section) =>
      count +
      (section.links?.length ?? 0) +
      (section.kind === "mate"
        ? section.works.reduce(
            (parts, work) => parts + work.parts.filter((part) => part.url !== undefined).length,
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
 * The sections a filter leaves: the addresses whose service, role, host, section or owner holds
 * every word of it, and the parts whose work, name, status or preview does; a section left
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
    if (section.kind !== "mate") return links.length === 0 ? [] : [{ ...section, links }];
    const works = section.works.flatMap((work) => {
      const parts = work.parts.filter((part) =>
        holds([work.title, part.name, part.status, part.host]),
      );
      return parts.length === 0 ? [] : [{ ...work, parts }];
    });
    return links.length === 0 && works.length === 0 ? [] : [{ ...section, links, works }];
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
