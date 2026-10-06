/**
 * The account's store as a test mounts it: an organization's roster read and live, these projects
 * as their rows read, and members named whose rows are not read yet; and, where a test names them,
 * the organization's services read and live.
 */
import type { AtomRegistry } from "effect/unstable/reactivity";

import { projectsScope } from "../../data/families/project.ts";
import { servicesScope, type ServiceValue } from "../../data/families/service.ts";
import type { ScopeKey } from "../../data/model.ts";
import { accountReadsAtom } from "../../data/reads.ts";
import type { Row } from "../../data/reducer.ts";
import { makeAccountStore, type AccountStore } from "../../data/store.ts";
import type { ZeropsProject } from "../api.ts";

export function mountRoster(
  registry: AtomRegistry.AtomRegistry,
  orgId: string,
  projects: ReadonlyArray<ZeropsProject>,
  options: {
    readonly unreadMembers?: ReadonlyArray<string>;
    readonly services?: ReadonlyArray<ServiceValue>;
  } = {},
): AccountStore {
  const store = makeAccountStore(registry);
  const link = `zerops:${orgId}` as const;
  store.dispatch({ kind: "stream", key: link, now: 0, event: { kind: "demand", demanded: true } });
  store.dispatch({ kind: "stream", key: link, now: 0, event: { kind: "handshake" } });
  store.dispatch({ kind: "stream", key: link, now: 0, event: { kind: "baseline-committed" } });
  const live = (scope: ScopeKey, members: ReadonlyArray<string>, rows: ReadonlyArray<Row>) => {
    for (const event of [
      { kind: "demand", demanded: true },
      { kind: "attempt" },
      { kind: "handshake" },
    ] as const)
      store.dispatch({ kind: "stream", key: scope, now: 0, event });
    store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
    store.dispatch({
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-realtime",
      members,
      rows,
    });
    store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "baseline-committed" } });
  };
  live(
    projectsScope(orgId),
    [...projects.map((project) => project.id), ...(options.unreadMembers ?? [])],
    projects.map((project) => ({
      family: "project",
      id: project.id,
      value: { clientId: orgId, ...project },
      revision: { kind: "zerops", version: 1 },
    })),
  );
  if (options.services !== undefined)
    live(
      servicesScope(orgId),
      options.services.map((service) => service.id),
      options.services.map((service) => ({
        family: "service",
        id: service.id,
        value: service,
        revision: { kind: "zerops", version: 1 },
      })),
    );
  registry.set(accountReadsAtom, {
    data: store.data,
    orgId,
    demandDetail: () => () => undefined,
    renewHeld: () => undefined,
  });
  return store;
}
