/**
 * A Mate's parts, the one reader every surface that shows them reads: the menu's Sites, the
 * conversation header's Sites, the Mate rows on the overview and a project's page, and the Browser
 * page. Each part is a piece of the application — its dev entries (where the Mate works on it) and
 * its preview (the stage half of its pair, which runs what the Mate built) — each by its service's
 * real hostname: a surface never names a service anything else (Aleš, 2026-10-29).
 *
 * - **Parts** come from `servicePairs` — the tier, zcp's envelope, the stem — with one override: a
 *   preview a dev pool serves is that pool's, whatever repository holder the tier names as its dev
 *   (Noola's tier pairs every stage with `noola`, which runs nothing once its parts moved to pools).
 *   A dev with no stage yet is a part all the same; a pool with neither a workspace nor a stage is
 *   none. A holder zcp keeps for a repository (its envelope's `standIn`) runs nothing while a
 *   pool stands: it has no link and no part of its own.
 * - **Names** are hostnames: a dev entry is its dev service's, or its workspace's alias
 *   (`apipool-1`); a preview its stage's (`apistage`). Never a name made up for the part, nor the
 *   setup zcp names it by (`apiprod`, `boxpreview`).
 * - **Dev entries**: a plain dev service's own route; for a pool, one per workspace the Mate holds
 *   on it, each by the chat it is for, else "dev" — never numbered. A workspace opens only by the
 *   rule zcp gives (`poolWorkspaceLink`); one that does not says why in plain words, muted. A slot
 *   nobody leases shows nothing: a pool's slot routes balance over every container, so they are
 *   nobody's.
 * - **Several addresses**: a dev service answering on several ports, or a workspace running several
 *   dev servers, is an entry per address, so a link opens exactly what it names: the first by the
 *   dev's own label, the rest by their dev server's name where zcp names one, else their port
 *   (":5195"), in port order (a workspace's in zcp's).
 * - **Preview**: the stage half's first route, labelled "preview"; one with no public address says
 *   so, muted, so a part that serves no page (a runner) still stands.
 *
 * Pure: no network, no clock, no platform globals.
 *
 * @module mateParts
 */
import { isZeropsLeaseHeld, type ZeropsDevServer, type ZeropsLease } from "@t3tools/contracts";

import { isPoolServiceType } from "./infrastructureType.ts";
import { servicePairs, type PoolPair } from "./servicePairs.ts";

/** One entry of a part: a dev workspace or its preview, with its address or why it has none. */
export interface MatePartEntry {
  /** Unique within the Mate: `dev:<alias>`, `dev:<hostname>`, `preview:<hostname>`, then a port's. */
  readonly key: string;
  /** "dev", the chat a workspace is for, or "preview"; past a dev's first address, `server`. */
  readonly label: string;
  /** The service the entry is on (a dev service, a lease's alias, a preview's hostname). */
  readonly service: string;
  /** Its address; absent where it has none, and `why` says why. */
  readonly url: string | undefined;
  /** The address without its scheme: what a row shows and what a person copies. */
  readonly host: string | undefined;
  /** Its other ports' hosts, which a tooltip lists after its own. */
  readonly more: ReadonlyArray<string>;
  /** Only where it has no address, in plain words: "Starting.", "Paused.", "No web address."… */
  readonly why: string | undefined;
  /**
   * Which of its dev's addresses it is, where the dev answers on several: its dev server's name,
   * else its port (":5195"); absent where the dev has one.
   */
  readonly server?: string | undefined;
}

/** A part of a Mate's application: its dev entries and its preview, each by its service. */
export interface MatePart {
  readonly key: string;
  /** The service its dev side is: a dev service, or the dev pool its workspaces are on. */
  readonly devService: string;
  /**
   * Its dev runs only in a workspace the Mate takes while it works on the part — a dev pool's, or
   * a repository holder's while pools stand — so with none held, nothing runs.
   */
  readonly pooled: boolean;
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
  /** By their dev service's hostname, then their preview's. */
  readonly parts: ReadonlyArray<MatePart>;
  readonly others: ReadonlyArray<MateOtherAddress>;
}

/** A lease as the reader needs it, from the newest envelope the Mate's conversation read. */
export type MatePartLease = Pick<
  ZeropsLease,
  "alias" | "pool" | "state" | "unverified" | "devServers" | "acquiredAt" | "branch"
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
    /** The dev servers zcp last read on it (`devServersOf`), which name its ports; absent unread. */
    readonly devServers?: ReadonlyArray<Pick<ZeropsDevServer, "name" | "port">> | undefined;
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
  /**
   * The services its envelope marks as a repository's stand-in (`standIn`, `standInsOf`): while
   * a pool stands, a holder keeps the code and runs nothing, so its routes open nothing.
   */
  readonly standIns?: ReadonlyArray<string> | undefined;
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

/** A dev server by its own name, by its port where it has none. */
export const devServerName = (server: Pick<ZeropsDevServer, "name" | "port">): string =>
  server.name.trim() !== "" || server.port === undefined
    ? server.name.trim()
    : `:${String(server.port)}`;

/** What a part's side with no address says in its tooltip, where it has no public route. */
const NO_ADDRESS = "No web address.";

/** `poolWorkspaceLink`'s reason as a person reads it; any server that is not running is "Not running.". */
const PLAIN_WHY: Readonly<Record<string, string>> = {
  paused: "Paused.",
  starting: "Starting.",
  "not mounted": "Not running yet.",
  "not confirmed by its pool": "Not confirmed yet.",
  "no address yet": "No web address yet.",
};

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

/**
 * The chat a lease is for: one bound to its alias, acquired when it was — a pool hands a released
 * container out again under the same alias.
 */
export const leaseChatTitle = (
  lease: Pick<ZeropsLease, "alias" | "acquiredAt">,
  chats: ReadonlyArray<MatePartLeaseChat>,
): string | undefined =>
  chats.find(
    (chat) =>
      chat.alias === lease.alias &&
      (chat.acquiredAt === undefined ||
        lease.acquiredAt === undefined ||
        chat.acquiredAt === lease.acquiredAt),
  )?.title;

/**
 * What a workspace goes by: the chat it is for, else the branch checked out there — a helper's or
 * a task's workspace is bound to no chat — else "dev". A workspace on `main` is plain development.
 */
export const leaseLabel = (
  lease: Pick<ZeropsLease, "alias" | "acquiredAt" | "branch">,
  chats: ReadonlyArray<MatePartLeaseChat>,
): string =>
  leaseChatTitle(lease, chats) ??
  (lease.branch === undefined || lease.branch === "main" || lease.branch === "master"
    ? "dev"
    : lease.branch);

export function mateParts(input: MatePartsInput): MateParts {
  const leases = input.leases ?? [];
  const pools = new Set([
    ...(input.pools ?? []),
    ...input.services.flatMap((service) =>
      service.type !== undefined && isPoolServiceType(service.type) ? [service.hostname] : [],
    ),
    ...leases.map((lease) => lease.pool),
  ]);
  // Before any pool stands, a stand-in is still where the code runs (the Zerops panel's rule).
  const holders = new Set(pools.size === 0 ? [] : (input.standIns ?? []));
  const routes = input.routes.filter(
    (route) =>
      route.service !== input.controlPlane &&
      !pools.has(route.service) &&
      !holders.has(route.service) &&
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
  const serversOf = new Map(
    input.services.map((service) => [service.hostname, service.devServers ?? []] as const),
  );
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
  /** A dev service's addresses: one entry per port, in port order, each by its server's name. */
  const serviceDev = (dev: string): ReadonlyArray<MatePartEntry> => {
    const own = [...routesOf(dev)].sort((left, right) => (left.port ?? 0) - (right.port ?? 0));
    const several = own.length > 1;
    return own.map((route, index): MatePartEntry => {
      const named = (serversOf.get(dev) ?? []).find(
        (server) => server.port !== undefined && server.port === route.port,
      );
      const server = !several
        ? undefined
        : named !== undefined && named.name.trim() !== ""
          ? devServerName(named)
          : route.port === undefined
            ? hostOf(route.url)
            : `:${String(route.port)}`;
      return {
        key: index === 0 ? `dev:${dev}` : `dev:${dev}:${route.url}`,
        label: index === 0 || server === undefined ? "dev" : server,
        service: dev,
        url: route.url,
        host: hostOf(route.url),
        more: [],
        why: undefined,
        server,
      };
    });
  };
  const chats = input.leaseChats ?? [];
  const devOf = (dev: string): ReadonlyArray<MatePartEntry> => {
    if (!pools.has(dev)) return serviceDev(dev);
    return [...leases]
      .filter((lease) => lease.pool === dev && isZeropsLeaseHeld(lease.state))
      .sort((left, right) => left.alias.localeCompare(right.alias, "en", { numeric: true }))
      .flatMap((lease): ReadonlyArray<MatePartEntry> => {
        const link = poolWorkspaceLink(lease);
        const label = leaseLabel(lease, chats);
        // Its running servers, the first the one its link opens (`poolWorkspaceLink`).
        const running = (lease.devServers ?? []).flatMap((server) =>
          server.status === "running" && server.url !== undefined && isBrowsableUrl(server.url)
            ? [{ ...server, url: server.url }]
            : [],
        );
        if (link.url === undefined || running.length < 2)
          return [
            {
              key: `dev:${lease.alias}`,
              label,
              service: lease.alias,
              url: link.url,
              host: link.url === undefined ? undefined : hostOf(link.url),
              more: [],
              why: link.why === undefined ? undefined : (PLAIN_WHY[link.why] ?? "Not running."),
            },
          ];
        return running.map((server, index) => {
          const name = devServerName(server) || hostOf(server.url);
          return {
            key: index === 0 ? `dev:${lease.alias}` : `dev:${lease.alias}:${server.url}`,
            label: index === 0 ? label : name,
            service: lease.alias,
            url: server.url,
            host: hostOf(server.url),
            more: [],
            why: undefined,
            server: name,
          };
        });
      });
  };
  // Each preview with the dev that serves it: the pool where one does, else its pair's dev.
  const previewsOf = new Map<string, Array<string>>();
  for (const pair of pairs)
    for (const preview of pair.previews) {
      const dev = servingPool(preview.hostname) ?? pair.dev;
      previewsOf.set(dev, [...(previewsOf.get(dev) ?? []), preview.hostname]);
    }

  const used = new Set<string>();
  const parts: Array<MatePart> = [];
  for (const [dev, previews] of previewsOf) {
    used.add(dev);
    for (const preview of previews) used.add(preview);
    const devEntries = devOf(dev);
    // Several previews of one dev are several parts of one codebase.
    for (const preview of previews)
      parts.push({
        key: `part:${previews.length > 1 ? preview : dev}`,
        devService: dev,
        pooled: pools.has(dev) || holders.has(dev),
        dev: devEntries,
        preview: entryOf(`preview:${preview}`, "preview", preview, NO_ADDRESS),
      });
  }
  for (const { hostname } of services) {
    if (used.has(hostname) || !(pools.has(hostname) || isDevHostname(hostname))) continue;
    used.add(hostname);
    const dev = devOf(hostname);
    if (dev.length > 0)
      parts.push({
        key: `part:${hostname}`,
        devService: hostname,
        pooled: pools.has(hostname),
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
  const order = (part: MatePart) => [part.devService, part.preview?.service ?? ""] as const;
  return {
    parts: parts.sort((left, right) => {
      const [leftDev, leftPreview] = order(left);
      const [rightDev, rightPreview] = order(right);
      return (
        leftDev.localeCompare(rightDev, "en", { numeric: true }) ||
        leftPreview.localeCompare(rightPreview, "en", { numeric: true })
      );
    }),
    others,
  };
}
