/**
 * An account whose places' addresses are as a test says: each project's `addresses` projection is
 * the record given, every other projection the empty store's. For the doors that read whether a
 * place has a domain of its own.
 */
import { RegistryContext } from "@effect/atom-react";
import {
  addresses,
  makeAccountStore,
  type AddressDomain,
  type PlaceAddresses,
} from "@t3tools/client-runtime/data";
import { Atom, AtomRegistry } from "effect/reactivity";
import { createElement, type ReactNode } from "react";

import { AccountDataContext, type AccountData } from "../ZeropsAccountData";

/** A place's addresses as read: ready with these domains, or still reading. */
export function placeAddresses(domains: ReadonlyArray<string> | "reading"): PlaceAddresses {
  return {
    state: domains === "reading" ? "reading" : "ready",
    domains:
      domains === "reading"
        ? []
        : domains.map((domainName) => ({ domainName }) as unknown as AddressDomain),
    zerops: [],
    ips: { zoneHasSharedV4: false },
    portsState: "ready",
    ports: [],
    webTargets: [],
    portTargets: [],
    waitingDomains: [],
    waitingPorts: [],
    readsProject: false,
    nothingDeployed: false,
  };
}

/** Wraps a tree in the account `org`, each project's addresses as given, the rest still reading. */
export function withPlaceAddresses(
  places: Readonly<Record<string, PlaceAddresses>>,
): (children: ReactNode) => ReactNode {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const held = new Map<string, Atom.Atom<PlaceAddresses>>();
  const project: AccountData["data"]["project"] = (projection, key) => {
    const projectId = (key as { readonly projectId?: string }).projectId;
    if (projection.name !== addresses.name || projectId === undefined) {
      return store.data.project(projection, key);
    }
    const atom = held.get(projectId) ?? Atom.make(places[projectId] ?? placeAddresses("reading"));
    held.set(projectId, atom);
    return atom as never;
  };
  const account = {
    data: { ...store.data, project },
    orgId: "org",
    demandDetail: () => () => {},
    retry: () => {},
  } as Pick<AccountData, "data" | "orgId" | "demandDetail" | "retry"> as AccountData;
  return (children) =>
    createElement(
      RegistryContext.Provider,
      { value: registry },
      createElement(AccountDataContext.Provider, { value: account }, children),
    );
}
