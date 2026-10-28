/**
 * A place's page — a project's Stage or Production — as words: its title, the one status line
 * under it, the address it stands for, its services as one table (the code services HQ deploys
 * joined with everything else the platform runs there), who reaches it folded to faces, and the
 * release it rolls back to.
 */
import type {
  FlowReleaseRow,
  GroupEnvironmentTier,
  GroupRowTone,
  ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import {
  NOTHING_DEPLOYED,
  type StopServiceRow,
  type StopView,
} from "@t3tools/client-runtime/zerops/flow";
import type { ZeropsServiceRow } from "@t3tools/client-runtime/zerops/serviceMap";

import { placeStateWord, type ChipLabel } from "../SidebarProductionChip.logic";

/** What a tier is called where the place's own name is only its tier. */
const TIER_TITLE: Record<GroupEnvironmentTier, string> = {
  production: "Production",
  stage: "Stage",
};

/** The names that only say the tier: written as the tier, with no chip repeating it. */
const TIER_NAMES: Record<GroupEnvironmentTier, ReadonlyArray<string>> = {
  production: ["production", "prod"],
  stage: ["stage"],
};

/** The chip beside a custom name, saying which tier it is. */
const TIER_TAG: Record<GroupEnvironmentTier, string> = { production: "prod", stage: "stage" };

/**
 * A shared environment's title, the same wherever one is named: "Production"; a stage by its own
 * name with its first letter capitalised ("Stage", "Client demo"). A name HQ made from the
 * application's slug and the tier ("demo-app-stage") is the tier's own word.
 */
export function environmentTitle(tier: "production" | "stage", name: string): string {
  if (tier === "production") return "Production";
  const own = name.trim();
  if (own === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*-stage$/u.test(own)) return "Stage";
  return own.charAt(0).toLocaleUpperCase() + own.slice(1);
}

/**
 * A place's title: its tier in title case where its name only says the tier, else its own name as
 * typed, with the tier's chip beside it.
 */
export function placeTitle(
  name: string,
  tier: GroupEnvironmentTier,
): { readonly title: string; readonly tag: string | undefined } {
  return TIER_NAMES[tier].includes(name.trim().toLowerCase())
    ? { title: TIER_TITLE[tier], tag: undefined }
    : { title: name, tag: TIER_TAG[tier] };
}

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** The one line under a place's title: its state, what runs, how it got there, how many services. */
export interface PlaceStatus {
  readonly tone: GroupRowTone;
  readonly text: string;
}

/**
 * Production: `Running · v0.1.0 · released 3h ago by Mira · 1 service`.
 * Stage: `Running · deployed 23m ago · 6bc9923 · follows main · 1 service`.
 * Nothing there: `Not released yet`, `Not deployed yet` — the words its card says it in.
 * Any other state says its own word first and what it knows after it.
 */
export function placeStatus(input: {
  readonly tier: GroupEnvironmentTier;
  readonly view: Pick<StopView, "tone" | "word" | "version">;
  /** How long ago the live release was made; production only. */
  readonly releasedAge?: string | undefined;
  /** How long what runs has run, where the platform says. */
  readonly since?: string | undefined;
  /** The stage's branch (`EnvironmentRow.source`); `—` or empty for none. */
  readonly source: string;
  readonly services: number;
}): PlaceStatus {
  const { view } = input;
  const version = view.version;
  const count = input.services > 0 ? plural(input.services, "service", "services") : undefined;
  const follows =
    input.source === "" || input.source === "—" || input.source === "release"
      ? undefined
      : `follows ${input.source}`;
  const parts: Array<string | undefined> = [];
  if (view.tone === "good" && input.tier === "production") {
    const by = version?.taggedBy === undefined ? "" : ` by ${version.taggedBy}`;
    parts.push(
      "Running",
      version?.label,
      input.releasedAge === undefined ? undefined : `released ${input.releasedAge}${by}`,
    );
  } else if (view.tone === "good") {
    parts.push(
      placeStateWord("stage", "ok"),
      input.since === undefined ? undefined : `deployed ${input.since}`,
      version?.commit ?? version?.label,
      follows,
    );
  } else if (view.word === NOTHING_DEPLOYED) {
    parts.push(placeStateWord(CHIP_LABEL[input.tier], "empty"));
  } else {
    const label = version?.label;
    parts.push(view.word, label === view.word ? undefined : label);
    if (input.tier === "stage") parts.push(follows);
  }
  parts.push(count);
  return {
    tone: view.tone,
    text: parts.filter((part): part is string => part !== undefined && part !== "").join(" · "),
  };
}

/** Whether an address is the platform's own subdomain rather than a domain of the project's. */
const isSubdomain = (route: Pick<ZeropsPublicRoute, "host">) =>
  /\.zerops\.app(?::\d+)?(?:\/|$)/u.test(route.host);

/**
 * The address a place stands for, linked in its head: production's first own domain, else its
 * subdomain; a stage's subdomain, else its first. None where it serves nothing publicly.
 */
export function placeAddress<Route extends Pick<ZeropsPublicRoute, "host">>(
  tier: GroupEnvironmentTier,
  routes: ReadonlyArray<Route>,
): Route | undefined {
  const preferred =
    tier === "production"
      ? routes.find((route) => !isSubdomain(route))
      : routes.find((route) => isSubdomain(route));
  return preferred ?? routes[0];
}

/** The platform types that hold data without a container of their own to measure. */
const NO_COMPUTE = /^(?:object-storage|shared-storage)\b/u;

/** One service of a place's table: a code service HQ deploys, or anything else the place runs. */
export interface PlaceServiceRow {
  readonly hostname: string;
  /** Muted under the name: the repository a code service is built from, else its ports. */
  readonly under: string | undefined;
  /** What it is, `Node.js 22`, `PostgreSQL 17`, `Object storage`; none while unread. */
  readonly type: string | undefined;
  /** Whether it runs in a container whose CPU, RAM and disk can be metered. */
  readonly compute: boolean;
  /** HQ's row for a code service: what runs, its state, addresses and jobs. */
  readonly code: StopServiceRow | undefined;
  /** The platform's row: type, meters and the last day. */
  readonly platform: ZeropsServiceRow | undefined;
}

/**
 * A place's services as one table: its code services first, in their order, each joined with the
 * platform's row of the same hostname; then every other service the platform lists there — a
 * database, a cache, a bucket — in the platform's order. The control plane is the Mate's, not the
 * place's.
 */
export function placeServiceRows(
  code: ReadonlyArray<StopServiceRow>,
  platform: ReadonlyArray<ZeropsServiceRow> | undefined,
): ReadonlyArray<PlaceServiceRow> {
  const listed = (platform ?? []).filter((row) => !row.isControlPlane);
  const byHost = new Map(listed.map((row) => [row.service.hostname, row]));
  const codeHosts = new Set(code.map((row) => row.hostname));
  const of = (hostname: string, row: ZeropsServiceRow | undefined, own?: StopServiceRow) => ({
    hostname,
    under: own?.repository ?? row?.portLabel,
    type: row?.typeShort ?? row?.typeLabel,
    compute: row === undefined || !NO_COMPUTE.test(row.service.type),
    code: own,
    platform: row,
  });
  return [
    ...code.map((row) => of(row.hostname, byHost.get(row.hostname), row)),
    ...listed
      .filter((row) => !codeHosts.has(row.service.hostname))
      .map((row) => of(row.service.hostname, row)),
  ];
}

/** Who reaches a place, folded: the first faces, and how many more there are behind them. */
export function foldedFaces<Person>(
  people: ReadonlyArray<Person>,
  shown: number,
): { readonly faces: ReadonlyArray<Person>; readonly more: number } {
  return { faces: people.slice(0, shown), more: Math.max(0, people.length - shown) };
}

/** The release production rolls back to from its menu: the newest one *Roll back* is offered on. */
export function rollBackTarget(releases: ReadonlyArray<FlowReleaseRow>): string | undefined {
  return releases.find((release) => release.rollBack)?.tag;
}

const CHIP_LABEL: Record<GroupEnvironmentTier, ChipLabel> = { production: "prod", stage: "stage" };

/**
 * An environment's row in its project's page column: what runs there in its version column, and its
 * state in the words its card and Sites say it (`placeStateWord`) — its dot's tone beside them, none
 * where the word is only that its answer is not in yet.
 */
export function stopRowSays(
  tier: GroupEnvironmentTier,
  view: Pick<StopView, "tone" | "word" | "line">,
): {
  readonly version: string | undefined;
  readonly word: string;
  readonly tone: GroupRowTone | undefined;
} {
  const label = CHIP_LABEL[tier];
  switch (view.tone) {
    case "good":
      return { version: view.line, word: placeStateWord(label, "ok"), tone: "good" };
    case "pending": {
      const word = placeStateWord(label, "releasing");
      return { version: view.line === view.word ? undefined : view.line, word, tone: "pending" };
    }
    case "bad":
      return { version: view.line, word: placeStateWord(label, "failed"), tone: "bad" };
    case "neutral":
      return view.line === NOTHING_DEPLOYED
        ? { version: undefined, word: placeStateWord(label, "empty"), tone: "neutral" }
        : { version: undefined, word: view.line, tone: undefined };
  }
}
