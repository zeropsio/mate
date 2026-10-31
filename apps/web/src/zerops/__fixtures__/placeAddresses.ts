/**
 * An account whose places' addresses are as a test says: each project's `addresses` projection is
 * the record given. Other reads keep the parent account when mounted, otherwise the empty store. For the doors that read whether a
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
import { createElement, useContext, type ReactNode } from "react";

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

/** Wraps a tree in the account `org`, each project's addresses as given, preserving any surrounding account reads. */
export function withPlaceAddresses(
  places: Readonly<Record<string, PlaceAddresses>>,
): (children: ReactNode) => ReactNode {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const held = new Map<string, Atom.Atom<PlaceAddresses>>();
  function AddressesFixture({ children }: { readonly children: ReactNode }) {
    const parent = useContext(AccountDataContext);
    const parentRegistry = useContext(RegistryContext);
    const data = parent?.data ?? store.data;
    const project: AccountData["data"]["project"] = (projection, key) => {
      const projectId = (key as { readonly projectId?: string }).projectId;
      if (projection.name !== addresses.name || projectId === undefined)
        return data.project(projection, key);
      const atom = held.get(projectId) ?? Atom.make(places[projectId] ?? placeAddresses("reading"));
      held.set(projectId, atom);
      return atom as never;
    };
    const account = {
      ...(parent ?? { orgId: "org", demandDetail: () => () => {}, retry: () => {} }),
      data: { ...data, project },
    } as AccountData;
    return createElement(
      RegistryContext.Provider,
      { value: parent === null ? registry : parentRegistry },
      createElement(AccountDataContext.Provider, { value: account }, children),
    );
  }
  return (children) => createElement(AddressesFixture, { children });
}
