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
import { readZeropsGroupTags } from "@t3tools/client-runtime/zerops";
import {
  devPartnerHostname,
  foldedStageHostnames,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type { ZeropsTopologyGroup } from "@t3tools/client-runtime/zerops/topology";

import { isServiceBrowserUrl } from "./serviceBrowserPolicy";

export type MateAddressRole = "dev" | "stage" | "production";

export interface MateAddress {
  /** The tab's key and its title: the service's hostname, unique in the list. */
  readonly service: string;
  readonly role: MateAddressRole | undefined;
  readonly url: string;
  /** The address without its scheme — what a row shows and what a person copies. */
  readonly host: string;
}

export interface MateAddressInput {
  /** The Mate's own project's services, in topology order. */
  readonly services: ReadonlyArray<{
    readonly hostname: string;
    readonly group: ZeropsTopologyGroup;
    readonly routes: ReadonlyArray<{ readonly url: string }>;
  }>;
  /** The Mate's group's stage and production projects the account holds, with their routes. */
  readonly environments?: ReadonlyArray<{
    readonly role: "stage" | "prod";
    readonly routes: ReadonlyArray<{ readonly service: string; readonly url: string }>;
  }>;
}

const ROLE_ORDER: ReadonlyArray<MateAddressRole | undefined> = [
  "dev",
  "stage",
  "production",
  undefined,
];

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
  const add = (service: string, role: MateAddressRole | undefined, url: string) => {
    if (!isServiceBrowserUrl(url) || seenUrls.has(url)) return;
    seenUrls.add(url);
    const taken = new Set(addresses.map((address) => address.service));
    const key = taken.has(service) && role !== undefined ? `${service} ${role}` : service;
    addresses.push({ service: key, role, url, host: hostOf(url) });
  };

  for (const service of own) {
    const route = service.routes.find((entry) => isServiceBrowserUrl(entry.url));
    if (route === undefined) continue;
    const role = stages.has(service.hostname)
      ? "stage"
      : devs.has(service.hostname) || isDevHostname(service.hostname)
        ? "dev"
        : undefined;
    add(service.hostname, role, route.url);
  }
  for (const role of ["stage", "prod"] as const) {
    for (const environment of input.environments ?? []) {
      if (environment.role !== role) continue;
      const firstByService = new Map<string, string>();
      for (const entry of environment.routes) {
        if (!firstByService.has(entry.service) && isServiceBrowserUrl(entry.url))
          firstByService.set(entry.service, entry.url);
      }
      for (const [service, url] of firstByService)
        add(service, role === "prod" ? "production" : "stage", url);
    }
  }
  return addresses.toSorted(
    (left, right) => ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role),
  );
}

/**
 * The Mate's group's stage and production projects, with their routes, as the
 * account holds them: a project whose services are not read yet is left out
 * until they are, and another Mate's dev is that Mate's, never this one's.
 */
export function groupAddressEnvironments<
  P extends { readonly id: string; readonly tagList?: ReadonlyArray<string> | undefined },
>(input: {
  readonly projectId: string;
  readonly projects: ReadonlyArray<P>;
  readonly routesOf: (
    project: P,
  ) => ReadonlyArray<{ readonly service: string; readonly url: string }> | undefined;
}): NonNullable<MateAddressInput["environments"]> {
  const own = input.projects.find((project) => project.id === input.projectId);
  const groupId = own === undefined ? undefined : readZeropsGroupTags(own.tagList).groupId;
  if (groupId === undefined) return [];
  return input.projects.flatMap((project) => {
    if (project.id === input.projectId) return [];
    const tags = readZeropsGroupTags(project.tagList);
    if (tags.groupId !== groupId || (tags.role !== "stage" && tags.role !== "prod")) return [];
    const routes = input.routesOf(project);
    return routes === undefined ? [] : [{ role: tags.role, routes }];
  });
}
