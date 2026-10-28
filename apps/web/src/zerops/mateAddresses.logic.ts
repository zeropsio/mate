/**
 * A Mate's public addresses, each with what it is to the person: the dev they
 * work on, the Mate's preview of it (the stage half of its dev/stage pair), the
 * project's stage they check, the production people use — and any other public
 * service by its name alone. The preview is never called stage: the onboarding
 * run's owner held two addresses named stage and kept the preview's as the app.
 *
 * The owner, 2026-10-03: "the browser automatically opens all tabs, imo it
 * shouldnt and you should be able to open each separately". Picking Browser
 * used to open a tab per address; now this list is what a person picks from,
 * in the conversation's top bar and in the Browser tab, and a tab exists only
 * for an address somebody opened.
 *
 * The Mate's own addresses are its parts (`mateParts`, the one reader the menu's Sites and the
 * Mate rows read too): each part's dev entries — a dev service's route, or each workspace the Mate
 * holds on a dev pool that opens by zcp's rule — and its preview, by the part's friendly name; then
 * every other public service by its name. A service's first route is its address: a second port
 * is the same page. The control plane serves Mate itself; browsing it from inside Mate is noise.
 *
 * Pure: no React, no store.
 */
import { projectNameInApp } from "@t3tools/client-runtime/zerops";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import {
  mateParts,
  type MatePartLease,
  type MatePartLeaseChat,
} from "@t3tools/client-runtime/zerops/mateParts";
import { partName, type PoolPair } from "@t3tools/client-runtime/zerops/servicePairs";
import type { ZeropsTopologyGroup } from "@t3tools/client-runtime/zerops/topology";

import { isServiceBrowserUrl } from "./serviceBrowserPolicy";

export type MateAddressRole = "dev" | "preview" | "stage" | "production";

export interface MateAddress {
  /**
   * The tab's key and its title, unique in the list and stable: a service of
   * the Mate's own project by its hostname (a pool workspace by its lease's alias), one of another
   * project by its hostname and its role — or its project's name where two projects share the
   * role. A hostname holds no space, so the two never meet.
   */
  readonly service: string;
  readonly role: MateAddressRole | undefined;
  readonly url: string;
  /** The address without its scheme — what a row shows and what a person copies. */
  readonly host: string;
  /**
   * What a row names after the address's role: a part's friendly name (and the chat a workspace is
   * for), another service's own hostname, with its environment's name only where its role has
   * several — never the role again.
   */
  readonly name: string;
}

type GroupRole = "stage" | "prod";

export interface MateAddressInput {
  /** The Mate's own project's services, in topology order. */
  readonly services: ReadonlyArray<{
    readonly hostname: string;
    readonly group: ZeropsTopologyGroup;
    /** The type-version, which tells a pool or a Box from a runtime (`servicePairs`). */
    readonly type?: string;
    readonly routes: ReadonlyArray<{ readonly url: string }>;
  }>;
  /** zcp's leases for the whole Mate, in the newest envelope its conversation read; absent unread. */
  readonly leases?: ReadonlyArray<MatePartLease> | undefined;
  /** The Mate's chats bound to a lease, by title: what each workspace is for. */
  readonly leaseChats?: ReadonlyArray<MatePartLeaseChat> | undefined;
  /**
   * The pairs the conversation's last envelope keys by a dev pool (`poolPairsOf`); none before it
   * carries one.
   */
  readonly poolPairs?: ReadonlyArray<PoolPair> | undefined;
  /** The services that envelope marks as a repository's stand-in (`standInsOf`): they open nothing. */
  readonly standIns?: ReadonlyArray<string> | undefined;
  /** The Mate's own project's role tag, where it is a stage or a production. */
  readonly ownRole?: GroupRole | undefined;
  /** The Mate's group's stage and production projects the account holds, with their routes. */
  readonly environments?: ReadonlyArray<{
    readonly projectId: string;
    readonly name: string;
    readonly role: GroupRole;
    readonly routes: ReadonlyArray<{ readonly service: string; readonly url: string }>;
  }>;
}

const ROLE_ORDER: ReadonlyArray<MateAddressRole | undefined> = [
  "dev",
  "preview",
  "stage",
  "production",
  undefined,
];

const ADDRESS_ROLE: Record<GroupRole, MateAddressRole> = { stage: "stage", prod: "production" };

const hostOf = (url: string) => url.replace(/^https?:\/\//u, "").replace(/\/$/u, "");

export function mateAddresses(input: MateAddressInput): ReadonlyArray<MateAddress> {
  // Infrastructure is never browsed (the control plane serves Mate itself), but a pool keying a
  // migrated part's pair stands there, so every service is handed to the reader.
  const { parts, others } = mateParts({
    services: input.services,
    routes: input.services
      .filter((service) => service.group !== "infrastructure")
      .flatMap((service) =>
        service.routes.map((route) => ({ service: service.hostname, url: route.url })),
      ),
    poolPairs: input.poolPairs,
    standIns: input.standIns,
    leases: input.leases,
    leaseChats: input.leaseChats,
  });

  const addresses: Array<MateAddress> = [];
  const seenUrls = new Set<string>();
  const add = (key: string, role: MateAddressRole | undefined, url: string, name = key) => {
    if (!isServiceBrowserUrl(url) || seenUrls.has(url)) return;
    seenUrls.add(url);
    addresses.push({ service: key, role, url, host: hostOf(url), name });
  };

  const projectRole = input.ownRole === undefined ? undefined : ADDRESS_ROLE[input.ownRole];
  for (const part of parts) {
    for (const entry of part.dev)
      if (entry.url !== undefined)
        add(
          entry.service,
          "dev",
          entry.url,
          entry.label === "dev" ? part.name : `${part.name} · ${entry.label}`,
        );
    // A pair's half is the Mate's preview, unless its project is itself the stage or production.
    if (part.preview?.url !== undefined)
      add(part.preview.service, projectRole ?? "preview", part.preview.url, part.name);
  }
  // A service's first route is its address: a second port is the same page.
  const listed = new Set<string>();
  for (const other of others) {
    if (listed.has(other.service)) continue;
    listed.add(other.service);
    add(other.service, projectRole, other.url);
  }

  const environments = input.environments ?? [];
  for (const groupRole of ["stage", "prod"] as const) {
    const ofRole = environments.filter((environment) => environment.role === groupRole);
    for (const environment of ofRole) {
      const firstByService = new Map<string, string>();
      for (const entry of environment.routes) {
        if (!firstByService.has(entry.service) && isServiceBrowserUrl(entry.url))
          firstByService.set(entry.service, entry.url);
      }
      const role = ADDRESS_ROLE[groupRole];
      const suffix = ofRole.length === 1 ? role : environment.name;
      for (const [service, url] of firstByService)
        add(
          `${service} ${suffix}`,
          role,
          url,
          ofRole.length === 1 ? partName(service) : `${partName(service)} · ${environment.name}`,
        );
    }
  }
  // Two projects of one role and one name stay apart by the order the account lists them.
  const counts = new Map<string, number>();
  const unique = addresses.map((address) => {
    const seen = counts.get(address.service) ?? 0;
    counts.set(address.service, seen + 1);
    return seen === 0 ? address : { ...address, service: `${address.service} ${seen + 1}` };
  });
  return unique.toSorted(
    (left, right) => ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role),
  );
}

/** A stage's or a production's role where HQ places a project as one. */
const roleOf = (placement: HqPlacement | undefined): GroupRole | undefined =>
  placement?.kind === "stage" ? "stage" : placement?.kind === "production" ? "prod" : undefined;

/**
 * What the account holds of the Mate's application for its addresses, as HQ places its projects
 * (`ZeropsProject.hq`): the Mate's own project's role, and the application's stage and production
 * projects with their routes. A project whose services are not read yet is left out until they
 * are, and `pending` says so — as it does while the Mate's own project is not held. Another
 * Mate's dev is that Mate's, never this one's.
 */
export function groupAddressEnvironments<
  P extends {
    readonly id: string;
    readonly name: string;
    readonly hq?: HqPlacement | undefined;
  },
>(input: {
  readonly projectId: string;
  readonly projects: ReadonlyArray<P>;
  readonly routesOf: (
    project: P,
  ) => ReadonlyArray<{ readonly service: string; readonly url: string }> | undefined;
}): {
  readonly ownRole: GroupRole | undefined;
  readonly environments: NonNullable<MateAddressInput["environments"]>;
  readonly pending: boolean;
} {
  const own = input.projects.find((project) => project.id === input.projectId);
  if (own === undefined) return { ownRole: undefined, environments: [], pending: true };
  const ownRole = roleOf(own.hq);
  const appId = own.hq?.appId ?? null;
  if (appId === null) return { ownRole, environments: [], pending: false };
  let pending = false;
  const environments = input.projects.flatMap((project) => {
    if (project.id === input.projectId) return [];
    const role = roleOf(project.hq);
    if (project.hq?.appId !== appId || role === undefined) return [];
    const routes = input.routesOf(project);
    if (routes === undefined) {
      pending = true;
      return [];
    }
    return [{ projectId: project.id, name: projectNameInApp(project), role, routes }];
  });
  return { ownRole, environments, pending };
}
