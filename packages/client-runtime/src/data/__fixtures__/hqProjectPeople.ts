/**
 * What HQ computed of the reader for each project, and the people it names, put into an account's
 * store as HQ's navigation would deliver them: for tests of the surfaces that read who a project's
 * owner is, whether its Mate waits on the reader, and who signed its agents in.
 */
import type { HqNavigationProject } from "@t3tools/shared/hqStream";

import { hqPeopleScope, placementsScope } from "../families/hqNavigation.ts";
import { linkKeys, type ScopeKey } from "../model.ts";
import type { Row } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";

export interface SeededProjectPerson {
  readonly ownerUserId?: string | null;
  readonly waitsOnViewer?: boolean;
  readonly mine?: boolean;
  /** Who is signed in to each login now. */
  readonly signedInNow?: HqNavigationProject["signedInNow"];
  /** Who last signed each login in; who is signed in now, unless a test says otherwise. */
  readonly everSignedIn?: HqNavigationProject["everSignedIn"];
}

export interface SeededProjectPeople {
  readonly projects: Readonly<Record<string, SeededProjectPerson>>;
  readonly people?: Readonly<
    Record<string, { readonly name: string; readonly avatarUrl?: string | null }>
  >;
}

let revisions = 0;

export function seedHqProjectPeople(
  store: AccountStore,
  orgId: string,
  seed: SeededProjectPeople,
): void {
  const revision = { kind: "hq", incarnation: "people", revision: (revisions += 1) } as const;
  const scopes: ReadonlyArray<ScopeKey> = [placementsScope(orgId), hqPeopleScope(orgId)];
  const event = (key: ScopeKey | ReturnType<typeof linkKeys.hq>, streamEvent: StreamEvent) =>
    store.dispatch({ kind: "stream", key, now: 0, event: streamEvent });
  const live = (key: ScopeKey | ReturnType<typeof linkKeys.hq>) =>
    store.state().streams.get(key)?.phase === "live";
  if (!live(linkKeys.hq(orgId))) {
    event(linkKeys.hq(orgId), { kind: "demand", demanded: true });
    event(linkKeys.hq(orgId), { kind: "handshake" });
    event(linkKeys.hq(orgId), { kind: "baseline-committed" });
  }
  const opening = scopes.filter((scope) => !live(scope));
  for (const scope of opening) {
    event(scope, { kind: "demand", demanded: true });
    event(scope, { kind: "attempt" });
    event(scope, { kind: "handshake" });
  }
  const generations = scopes.map((scope) => ({
    scope,
    generation: store.state().streams.get(scope)?.generation ?? 0,
  }));
  const rows: Row[] = [
    ...Object.entries(seed.projects).map(([projectId, person]): Row => ({
      family: "placement",
      id: projectId,
      revision,
      value: {
        projectId,
        appId: null,
        name: projectId,
        kind: "mate",
        mate: null,
        person: {
          role: "DEVELOPER",
          mayWrite: true,
          mine: person.mine ?? false,
          ownerUserId: person.ownerUserId ?? null,
          waitsOnViewer: person.waitsOnViewer ?? false,
          unseen: null,
        },
        signedInNow: person.signedInNow ?? {},
        everSignedIn: person.everSignedIn ?? person.signedInNow ?? {},
      },
    })),
    ...Object.entries(seed.people ?? {}).map(([userId, person]): Row => ({
      family: "hqPerson",
      id: userId,
      revision,
      value: {
        name: person.name,
        clientUserId: `cu-${userId}`,
        avatarUrl: person.avatarUrl ?? null,
      },
    })),
  ];
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: generations,
    reset: true,
    rows,
    removals: [],
  });
  store.dispatch({ kind: "hq-ready", scopes: generations });
  for (const scope of opening) event(scope, { kind: "baseline-committed" });
}
