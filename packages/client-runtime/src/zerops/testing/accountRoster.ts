/**
 * The account's store as a test mounts it: an organization's roster read and live, these projects
 * as their rows read, and members named whose rows are not read yet.
 */
import type { AtomRegistry } from "effect/unstable/reactivity";

import { projectsScope } from "../../data/families/project.ts";
import { accountReadsAtom } from "../../data/reads.ts";
import { makeAccountStore, type AccountStore } from "../../data/store.ts";
import type { ZeropsProject } from "../api.ts";

export function mountRoster(
  registry: AtomRegistry.AtomRegistry,
  orgId: string,
  projects: ReadonlyArray<ZeropsProject>,
  options: { readonly unreadMembers?: ReadonlyArray<string> } = {},
): AccountStore {
  const store = makeAccountStore(registry);
  const scope = projectsScope(orgId);
  const link = `zerops:${orgId}` as const;
  for (const key of [link, scope])
    store.dispatch({ kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } });
  store.dispatch({ kind: "stream", key: link, now: 0, event: { kind: "handshake" } });
  store.dispatch({ kind: "stream", key: link, now: 0, event: { kind: "baseline-committed" } });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "handshake" } });
  store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-realtime",
    members: [...projects.map((project) => project.id), ...(options.unreadMembers ?? [])],
    rows: projects.map((project) => ({
      family: "project",
      id: project.id,
      value: project,
      revision: { kind: "zerops", version: 1 },
    })),
  });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "baseline-committed" } });
  registry.set(accountReadsAtom, { data: store.data, orgId, demandDetail: () => () => undefined });
  return store;
}
