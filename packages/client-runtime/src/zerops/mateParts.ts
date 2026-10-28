/**
 * A Mate's parts, the one reader every surface that shows them reads: the menu's Sites, the
 * conversation header's Sites, the Mate rows on the overview and a project's page, and the Browser
 * page. Each part is a piece of the application — API, Web, Runner — by its friendly name, with its
 * dev entries (where the Mate works on it) and its preview (the stage half of its pair, which runs
 * what the Mate built).
 *
 * - **Parts** come from `servicePairs` — the tier, zcp's envelope, the stem — with one override: a
 *   preview a dev pool serves is that pool's, whatever repository holder the tier names as its dev
 *   (Noola's tier pairs every stage with `noola`, which runs nothing once its parts moved to pools).
 *   A dev with no stage yet is a part all the same; a pool with neither a workspace nor a stage is
 *   none.
 * - **Names** are the pair's stem (`partName`): `apipool` and `apistage` are API. Never the setup
 *   zcp names a part by (`apiprod`, `boxpreview`) and never a hostname.
 * - **Dev entries**: a plain dev service's own route; for a pool, one per workspace the Mate holds
 *   on it, each by the chat it is for, else "dev" — never numbered. A workspace opens only by the
 *   rule zcp gives (`poolWorkspaceLink`); one that does not says why, muted. A slot nobody leases
 *   shows nothing: a pool's slot routes balance over every container, so they are nobody's.
 * - **Preview**: the stage half's first route, labelled "preview"; one with no public address says
 *   so, muted, so a part that serves no page (a runner) still stands.
 *
 * Pure: no network, no clock, no platform globals.
 *
 * @module mateParts
 */
import { isZeropsLeaseHeld, type ZeropsLease } from "@t3tools/contracts";

import { isPoolServiceType } from "./infrastructureType.ts";
import { partName, poolPartName, servicePairs, type PoolPair } from "./servicePairs.ts";

/** One entry of a part: a dev workspace or its preview, with its address or why it has none. */
export interface MatePartEntry {
  /** Unique within the Mate: `dev:<alias>`, `dev:<hostname>`, `preview:<hostname>`. */
  readonly key: string;
  /** "dev", the chat a workspace is for, or "preview". */
  readonly label: string;
  /** The service the entry is on (a dev service, a lease's alias, a preview's hostname). */
  readonly service: string;
  /** Its address; absent where it has none, and `why` says why. */
  readonly url: string | undefined;
  /** The address without its scheme: what a row shows and what a person copies. */
  readonly host: string | undefined;
  /** Its other ports' hosts, which a tooltip lists after its own. */
  readonly more: ReadonlyArray<string>;
  /** Only where it has no address: "starting", "paused", "no public address"… */
  readonly why: string | undefined;
}

/** A part of a Mate's application: its friendly name, its dev entries and its preview. */
export interface MatePart {
  readonly key: string;
  readonly name: string;
  readonly dev: ReadonlyArray<MatePartEntry>;
  readonly preview: MatePartEntry | undefined;
}

/** A public address of the Mate that is no part's: a tool beside the app (mailpit), by its service. */
export interface MateOtherAddress {
  readonly key: string;
  readonly service: string;
  /** The port, only where its service answers on a second one. */
  readonly port: number | undefined;
  readonly host: string;
  readonly url: string;
}

export interface MateParts {
  /** In name order. */
  readonly parts: ReadonlyArray<MatePart>;
  readonly others: ReadonlyArray<MateOtherAddress>;
}

/** A lease as the reader needs it, from the newest envelope the Mate's conversation read. */
export type MatePartLease = Pick<
  ZeropsLease,
  "alias" | "pool" | "state" | "unverified" | "devServers" | "acquiredAt"
>;

/** A chat bound to a lease (`ThreadLease`), by its title: what the workspace is for. */
export interface MatePartLeaseChat {
  readonly alias: string;
  readonly acquiredAt?: string | undefined;
  readonly title: string;
}

export interface MatePartsInput {
  /** The Mate's project's services, in its order; a type tells a pool or a Box from a runtime. */
  readonly services: ReadonlyArray<{
    readonly hostname: string;
    readonly group?: string;
    readonly type?: string;
  }>;
  /** Its public routes; a second port of a service is the same page, listed in its tooltip. */
  readonly routes: ReadonlyArray<{
    readonly service: string;
    readonly url: string;
    readonly port?: number | undefined;
  }>;
  /** The control plane's hostname (zcp), never listed: it serves Mate itself. */
  readonly controlPlane?: string | undefined;
  /** Its dev pools by hostname; every service of a pool's type, and every pool a lease is of, is one too. */
  readonly pools?: ReadonlyArray<string> | undefined;
  /** The pairs its envelope keys by a dev pool (`poolPairsIn`). */
  readonly poolPairs?: ReadonlyArray<PoolPair> | undefined;
  /** The Mate tier on `main` (`servicePairs`). */
  readonly tier?: string | undefined;
  /** zcp's leases in the newest envelope read; absent while none is read. */
  readonly leases?: ReadonlyArray<MatePartLease> | undefined;
  /** The chats bound to its leases, by title. */
  readonly leaseChats?: ReadonlyArray<MatePartLeaseChat> | undefined;
}

const DEV_SUFFIX = "dev";
const STAGE_SUFFIX = "stage";
const POOL_SUFFIX = "pool";

const hostOf = (url: string) => url.replace(/^https?:\/\//u, "").replace(/\/$/u, "");

/** An http(s) address with no credentials in it: one a link may open. */
export function isBrowsableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

/** A `{name}dev` runtime is the dev before its stage exists, as every Mate's starts. */
const isDevHostname = (hostname: string) =>
  hostname.length > DEV_SUFFIX.length && hostname.endsWith(DEV_SUFFIX);

const withoutSuffix = (hostname: string, suffix: string) =>
  hostname.length > suffix.length && hostname.endsWith(suffix)
    ? hostname.slice(0, -suffix.length)
    : hostname;

/**
 * Whether a workspace on a dev pool opens, and where — zcp's rule (spec-workflows §8 DP-13/25/28/34,
 * spec-mate §2.8a.3): only a lease of the newest envelope that is held, verified, and whose server
 * runs with an address. Anything else says why, and never opens a slot port, a past announcement
 * or a message's link: a free or warm container's slot port answers nothing.
 */
export function poolWorkspaceLink(
  lease: Pick<ZeropsLease, "state" | "unverified" | "devServers">,
):
  | { readonly url: string; readonly why?: undefined }
  | { readonly url?: undefined; readonly why: string } {
  if (lease.state === "parked") return { why: "paused" };
  if (lease.state !== "held") return { why: "not mounted" };
  if (lease.unverified === true) return { why: "not confirmed by its pool" };
  const servers = (lease.devServers ?? []).filter(
    (server) => server.url !== undefined && isBrowsableUrl(server.url),
  );
  const running = servers.find((server) => server.status === "running");
  if (running?.url !== undefined) return { url: running.url };
  const [first] = servers.length > 0 ? servers : (lease.devServers ?? []);
  if (first === undefined) return { why: "no address yet" };
  if (first.status === "starting") return { why: "starting" };
  if (first.status === "running") return { why: "no address yet" };
  return { why: first.status === "stopped" ? "stopped" : `stopped: ${first.status}` };
}

/** The chat a lease is for: one bound to its alias, acquired when it was. */
const chatOf = (
  lease: MatePartLease,
  chats: ReadonlyArray<MatePartLeaseChat>,
): string | undefined =>
  chats.find(
    (chat) =>
      chat.alias === lease.alias &&
      (chat.acquiredAt === undefined ||
        lease.acquiredAt === undefined ||
        chat.acquiredAt === lease.acquiredAt),
  )?.title;

export function mateParts(input: MatePartsInput): MateParts {
  const leases = input.leases ?? [];
  const pools = new Set([
    ...(input.pools ?? []),
    ...input.services.flatMap((service) =>
      service.type !== undefined && isPoolServiceType(service.type) ? [service.hostname] : [],
    ),
    ...leases.map((lease) => lease.pool),
  ]);
  const routes = input.routes.filter(
    (route) =>
      route.service !== input.controlPlane &&
      !pools.has(route.service) &&
      isBrowsableUrl(route.url),
  );
  // Routes and the services listing are read separately: a routed service is held before the
  // listing shows it, and a pool a lease is of is held before the listing names it.
  const listed = new Set(input.services.map((service) => service.hostname));
  const services = [
    ...input.services.filter((service) => service.hostname !== input.controlPlane),
    ...[...new Set([...routes.map((route) => route.service), ...pools])]
      .filter((hostname) => !listed.has(hostname))
      .map((hostname) => ({ hostname })),
  ];
  const held = new Set(services.map((service) => service.hostname));
  const { pairs } = servicePairs({
    services,
    tier: input.tier,
    poolPairs: input.poolPairs,
    pools: [...pools],
  });

  // A preview a dev pool serves is that pool's: zcp's pair first, then the stem's pool.
  const poolOf = new Map<string, string>();
  for (const { pool, stages } of input.poolPairs ?? [])
    if (held.has(pool))
      for (const { hostname } of stages) if (!poolOf.has(hostname)) poolOf.set(hostname, pool);
  const servingPool = (preview: string): string | undefined => {
    const linked = poolOf.get(preview);
    if (linked !== undefined) return linked;
    const pool = `${withoutSuffix(preview, STAGE_SUFFIX)}${POOL_SUFFIX}`;
    return preview.endsWith(STAGE_SUFFIX) && pools.has(pool) && held.has(pool) ? pool : undefined;
  };

  const routesOf = (service: string) => routes.filter((route) => route.service === service);
  const entryOf = (key: string, label: string, service: string, why: string): MatePartEntry => {
    const [first, ...rest] = routesOf(service);
    return first === undefined
      ? { key, label, service, url: undefined, host: undefined, more: [], why }
      : {
          key,
          label,
          service,
          url: first.url,
          host: hostOf(first.url),
          more: rest.map((route) => hostOf(route.url)),
          why: undefined,
        };
  };
  const chats = input.leaseChats ?? [];
  const devOf = (dev: string): ReadonlyArray<MatePartEntry> => {
    if (!pools.has(dev)) {
      const entry = entryOf(`dev:${dev}`, "dev", dev, "no public address");
      return entry.url === undefined ? [] : [entry];
    }
    return [...leases]
      .filter((lease) => lease.pool === dev && isZeropsLeaseHeld(lease.state))
      .sort((left, right) => left.alias.localeCompare(right.alias, "en", { numeric: true }))
      .map((lease): MatePartEntry => {
        const link = poolWorkspaceLink(lease);
        return {
          key: `dev:${lease.alias}`,
          label: chatOf(lease, chats) ?? "dev",
          service: lease.alias,
          url: link.url,
          host: link.url === undefined ? undefined : hostOf(link.url),
          more: [],
          why: link.why,
        };
      });
  };
  const nameOf = (dev: string, stem: string) =>
    pools.has(dev) ? poolPartName(dev) : partName(stem);

  // Each preview with the dev that serves it: the pool where one does, else its pair's dev.
  const previewsOf = new Map<string, Array<string>>();
  const stemOf = new Map<string, string>();
  for (const pair of pairs)
    for (const preview of pair.previews) {
      const pool = servingPool(preview.hostname);
      const dev = pool ?? pair.dev;
      previewsOf.set(dev, [...(previewsOf.get(dev) ?? []), preview.hostname]);
      if (!stemOf.has(dev)) stemOf.set(dev, pool === undefined ? pair.name : dev);
    }

  const used = new Set<string>();
  const parts: Array<MatePart> = [];
  for (const [dev, previews] of previewsOf) {
    used.add(dev);
    for (const preview of previews) used.add(preview);
    const devEntries = devOf(dev);
    // Several previews of one dev are several parts of one codebase, each by its own stem.
    for (const preview of previews)
      parts.push({
        key: `part:${previews.length > 1 ? preview : dev}`,
        name:
          previews.length > 1
            ? partName(withoutSuffix(preview, STAGE_SUFFIX))
            : nameOf(dev, stemOf.get(dev) ?? dev),
        dev: devEntries,
        preview: entryOf(`preview:${preview}`, "preview", preview, "no public address"),
      });
  }
  for (const { hostname } of services) {
    if (used.has(hostname) || !(pools.has(hostname) || isDevHostname(hostname))) continue;
    used.add(hostname);
    const dev = devOf(hostname);
    if (dev.length > 0)
      parts.push({
        key: `part:${hostname}`,
        name: nameOf(hostname, withoutSuffix(hostname, DEV_SUFFIX)),
        dev,
        preview: undefined,
      });
  }
  const others = routes
    .filter((route) => !used.has(route.service))
    .map((route) => ({
      key: route.url,
      service: route.service,
      port:
        new Set(routesOf(route.service).map((own) => own.port)).size > 1 ? route.port : undefined,
      host: hostOf(route.url),
      url: route.url,
    }));
  return {
    parts: parts.sort((left, right) => left.name.localeCompare(right.name, "en")),
    others,
  };
}
