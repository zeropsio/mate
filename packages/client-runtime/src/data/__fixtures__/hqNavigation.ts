/**
 * HQ's navigation of an organization, put into an account's store as HQ's scope stream would
 * deliver it: for tests of the surfaces that read it through projections, from the structure,
 * Mates, people and presses they describe.
 */
import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { HqOfficialVerdict } from "@t3tools/shared/hqStream";

import type { HqStructure } from "../../zerops/hq/client.ts";
import { hqMateScope } from "../families/hqMate.ts";
import {
  hqAppsScope,
  hqOrganizationScope,
  hqPeopleScope,
  hqPressesScope,
  hqStatusScope,
  placementsScope,
  type HqAppValue,
  type HqPersonFacts,
  type HqPressValue,
} from "../families/hqNavigation.ts";
import { linkKeys, type ScopeKey } from "../model.ts";
import type { Row } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";

export interface SeededHq {
  readonly structure?: HqStructure;
  /** Each Mate HQ relays, by project. */
  readonly mates?: Readonly<Record<string, MateLiveView>>;
  readonly people?: Readonly<
    Record<string, { readonly name: string; readonly clientUserId?: string }>
  >;
  /** HQ's presses, each held for `heldForMs` from HQ's read. */
  readonly presses?: Readonly<Record<string, HqPressValue>>;
  readonly official?: HqOfficialVerdict | null;
  /** HQ answers now; `false` leaves it as it was read, its link down. */
  readonly live?: boolean;
  readonly person?: HqPersonFacts;
  /** Each application's open changes as the menu draws them, by its id. */
  readonly releaseOffers?: Readonly<Record<string, HqAppValue["releaseOffer"]>>;
  readonly changes?: Readonly<Record<string, HqAppValue["changes"]>>;
}

const PERSON: HqPersonFacts = {
  role: "DEVELOPER",
  mayWrite: true,
  mine: false,
  ownerUserId: null,
  waitsOnViewer: false,
  unseen: null,
};
let revisions = 0;

export function seedHqNavigation(store: AccountStore, orgId: string, seed: SeededHq): void {
  const revision = { kind: "hq", incarnation: "seed", revision: (revisions += 1) } as const;
  const event = (key: ScopeKey | ReturnType<typeof linkKeys.hq>, streamEvent: StreamEvent) =>
    store.dispatch({ kind: "stream", key, now: 0, event: streamEvent });
  const navigation = [
    hqOrganizationScope(orgId),
    hqStatusScope(orgId),
    hqAppsScope(orgId),
    placementsScope(orgId),
    hqPeopleScope(orgId),
    hqPressesScope(orgId),
  ];
  const mates = Object.keys(seed.mates ?? {}).map((projectId) => hqMateScope(orgId, projectId));
  const live = (key: ScopeKey | ReturnType<typeof linkKeys.hq>) =>
    store.state().streams.get(key)?.phase === "live";
  // What is live already stays so: seeding again moves HQ's word, not its streams.
  if (!live(linkKeys.hq(orgId))) {
    event(linkKeys.hq(orgId), { kind: "demand", demanded: true });
    event(linkKeys.hq(orgId), { kind: "handshake" });
    event(linkKeys.hq(orgId), { kind: "baseline-committed" });
  }
  const opening = [...navigation, ...mates].filter((scope) => !live(scope));
  for (const scope of opening) {
    event(scope, { kind: "demand", demanded: true });
    event(scope, { kind: "attempt" });
    event(scope, { kind: "handshake" });
  }
  const generations = (scopes: ReadonlyArray<ScopeKey>) =>
    scopes.map((scope) => ({
      scope,
      generation: store.state().streams.get(scope)?.generation ?? 0,
    }));
  // HQ relays only the Mates it places: those a seed names alone are placed in no application.
  const structure: HqStructure | undefined =
    seed.structure ??
    (seed.mates === undefined
      ? undefined
      : {
          apps: [],
          ungrouped: Object.keys(seed.mates).map((projectId) => ({
            projectId,
            name: projectId,
            mate: { face: "" },
          })),
        });
  const mateOf = (mate: NonNullable<HqStructure["ungrouped"][number]["mate"]>) => ({
    face: mate.face,
    madeBy: mate.madeBy ?? null,
    standupRequestedBy: mate.standupRequestedBy ?? null,
    closedOff: mate.closedOff ?? false,
    setupMarker: mate.setupMarker ?? null,
    keyWider: mate.keyWider ?? false,
    ...(mate.birthId == null ? {} : { birthId: mate.birthId }),
  });
  const rows: Row[] = [
    {
      family: "hqOrganization",
      id: orgId,
      revision,
      value: {
        can: structure?.can ?? {},
        unheld: structure?.unheld ?? {},
        tools: structure?.tools ?? [],
        build: "",
      },
    },
    {
      family: "hqStatus",
      id: orgId,
      revision,
      value: {
        official: seed.official === undefined ? "ok" : seed.official,
        parts: { quarantined: [] },
      },
    },
    ...(structure?.apps ?? []).flatMap((app): Row[] => [
      {
        family: "hqApp",
        id: app.id,
        revision,
        value: {
          id: app.id,
          name: app.name,
          can: (app.can ?? {}) as HqAppValue["can"],
          contents: app.contents ?? { empty: app.projects.length === 0, deletingProjectIds: [] },
          projectIds: app.projects.map(({ projectId }) => projectId),
          births: app.births ?? [],
          environments: (app.environments ?? []) as HqAppValue["environments"],
          changes: seed.changes?.[app.id] ?? [],
          releaseOffer: seed.releaseOffers?.[app.id] ?? null,
        },
      },
      ...app.projects.map((project): Row => ({
        family: "placement",
        id: project.projectId,
        revision,
        value: {
          projectId: project.projectId,
          appId: app.id,
          name: project.name,
          kind: project.kind,
          mate: project.mate === null ? null : mateOf(project.mate),
          ...(project.can === undefined ? {} : { can: project.can as HqAppValue["can"] }),
          person: seed.person ?? PERSON,
          signedInNow: {},
          everSignedIn: project.mate?.signers ?? {},
        },
      })),
    ]),
    ...(structure?.ungrouped ?? []).map((project): Row => ({
      family: "placement",
      id: project.projectId,
      revision,
      value: {
        projectId: project.projectId,
        appId: null,
        name: project.name,
        kind: "mate",
        mate: mateOf(project.mate),
        ...(project.can === undefined ? {} : { can: project.can as HqAppValue["can"] }),
        person: seed.person ?? PERSON,
        signedInNow: {},
        everSignedIn: project.mate.signers ?? {},
      },
    })),
    ...Object.entries(seed.people ?? {}).map(([id, person]): Row => ({
      family: "hqPerson",
      id,
      revision,
      value: { name: person.name, clientUserId: person.clientUserId ?? "", avatarUrl: null },
    })),
    ...Object.entries(seed.presses ?? {}).map(([id, press]): Row => ({
      family: "hqPress",
      id,
      revision,
      value: press,
    })),
  ];
  const navigationScopes = generations(navigation);
  store.dispatch({
    kind: "hq-delivery",
    scopes: navigationScopes,
    reset: true,
    rows,
    removals: [],
  });
  store.dispatch({ kind: "hq-ready", scopes: navigationScopes });
  for (const [projectId, mate] of Object.entries(seed.mates ?? {})) {
    const { presence, ...overview } = mate;
    const scopes = generations([hqMateScope(orgId, projectId)]);
    store.dispatch({
      kind: "hq-delivery",
      scopes,
      reset: true,
      rows: [
        {
          family: "hqMate",
          id: projectId,
          revision,
          value: {
            presence,
            overview: Object.keys(overview).length === 0 ? null : (overview as never),
            attention: null,
            attentionState: "none",
          },
        },
      ],
      removals: [],
    });
    store.dispatch({ kind: "hq-ready", scopes });
  }
  for (const scope of opening) event(scope, { kind: "baseline-committed" });
  if (seed.live === false)
    event(linkKeys.hq(orgId), {
      kind: "fault",
      fault: { outcome: "transient", message: "HQ's stream broke." },
      jitter: 0,
    });
}
