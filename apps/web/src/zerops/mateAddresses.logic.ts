/**
 * A Mate's public addresses, each with what it is to the person: the dev they
 * work on, the stage they check, the production people use — and any other
 * public service by its name alone.
 *
 * The owner, 2026-10-03: "the browser automatically opens all tabs, imo it
 * shouldnt and you should be able to open each separately". Picking Browser
 * used to open a tab per address; now this list is what a person picks from,
 * in the conversation's top bar and in the Browser tab, and a tab exists only
 * for an address somebody opened.
 *
 * A service's FIRST browsable route is its address: a second port on the same
 * service is the same page to a reader, not another thing to look at. The
 * control plane serves Mate itself; browsing it from inside Mate is noise.
 *
 * Pure: no React, no store.
 */
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import {
  devPartnerHostname,
  foldedStageHostnames,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type { ZeropsTopologyGroup } from "@t3tools/client-runtime/zerops/topology";

import { isServiceBrowserUrl } from "./serviceBrowserPolicy";

export type MateAddressRole = "dev" | "stage" | "production";

export interface MateAddress {
  /**
   * The tab's key and its title, unique in the list and stable: a service of
   * the Mate's own project by its hostname, one of another project by its
   * hostname and its role — or its project's name where two projects share
   * the role. A hostname holds no space, so the two never meet.
   */
  readonly service: string;
  readonly role: MateAddressRole | undefined;
  readonly url: string;
  /** The address without its scheme — what a row shows and what a person copies. */
  readonly host: string;
}

type GroupRole = "stage" | "prod";

export interface MateAddressInput {
  /** The Mate's own project's services, in topology order. */
  readonly services: ReadonlyArray<{
    readonly hostname: string;
    readonly group: ZeropsTopologyGroup;
    readonly routes: ReadonlyArray<{ readonly url: string }>;
  }>;
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
  "stage",
  "production",
  undefined,
];

const ADDRESS_ROLE: Record<GroupRole, MateAddressRole> = { stage: "stage", prod: "production" };

/** A `{name}dev` runtime is the dev before its stage exists, as every Mate's starts. */
const isDevHostname = (hostname: string) => hostname.length > 3 && hostname.endsWith("dev");

const hostOf = (url: string) => url.replace(/^https?:\/\//u, "").replace(/\/$/u, "");

export function mateAddresses(input: MateAddressInput): ReadonlyArray<MateAddress> {
  const own = input.services.filter((service) => service.group !== "infrastructure");
  const stages = foldedStageHostnames(own);
  const byHostname = new Map(own.map((service) => [service.hostname, service]));
  const devs = new Set<string>();
  for (const service of own) {
    const partner = stages.has(service.hostname)
      ? devPartnerHostname(service, byHostname)
      : undefined;
    if (partner !== undefined) devs.add(partner);
  }

  const addresses: Array<MateAddress> = [];
  const seenUrls = new Set<string>();
  const add = (key: string, role: MateAddressRole | undefined, url: string) => {
    if (!isServiceBrowserUrl(url) || seenUrls.has(url)) return;
    seenUrls.add(url);
    addresses.push({ service: key, role, url, host: hostOf(url) });
  };

  for (const service of own) {
    const route = service.routes.find((entry) => isServiceBrowserUrl(entry.url));
    if (route === undefined) continue;
    const role = stages.has(service.hostname)
      ? "stage"
      : devs.has(service.hostname) || isDevHostname(service.hostname)
        ? "dev"
        : input.ownRole === undefined
          ? undefined
          : ADDRESS_ROLE[input.ownRole];
    add(service.hostname, role, route.url);
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
      for (const [service, url] of firstByService) add(`${service} ${suffix}`, role, url);
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
    return [{ projectId: project.id, name: project.name, role, routes }];
  });
  return { ownRole, environments, pending };
}
