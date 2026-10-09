/**
 * HQ's navigation of an organization, put into an account's store as HQ's scope stream would
 * deliver it: for tests of the surfaces that read it through projections, from the structure,
 * Mates, people and presses they describe.
 */
import type { HqLifecycleRecord } from "@t3tools/shared/hqLifecycle";
import { hqLifecycleScope, lifecycleReceipt } from "../families/hqLifecycle.ts";
import type { MateAttention } from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { HqOfficialVerdict } from "@t3tools/shared/hqStream";

import type { HqStructure } from "../../zerops/hq/client.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { hqMateAttentionScope } from "../families/mateAttention.ts";
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
import { graceOver } from "./account.ts";
import type { Row } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";

export interface SeededHq {
  readonly structure?: HqStructure;
  readonly lifecycle?: ReadonlyArray<HqLifecycleRecord>;
  /** Each Mate HQ relays, by project. */
  readonly mates?: Readonly<Record<string, MateLiveView>>;
  /** The attention HQ relays live of each of those Mates, by project. */
  readonly attention?: Readonly<Record<string, MateAttention>>;
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
    hqLifecycleScope(orgId),
  ];
  const mates = Object.keys(seed.mates ?? {}).flatMap((projectId) => [
    hqMateScope(orgId, projectId),
    ...(seed.attention?.[projectId] === undefined ? [] : [hqMateAttentionScope(orgId, projectId)]),
  ]);
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
    ...(seed.lifecycle ?? []).map((record): Row => ({
      family: "hqLifecycle",
      id: record.requestId,
      revision,
      value: record,
    })),
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
          mate: project.mate == null ? null : mateOf(project.mate),
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
    kind: "delivery",
    via: "hq-stream",
    scopes: navigationScopes,
    reset: true,
    rows,
    removals: [],
  });
  store.dispatch({ kind: "hq-ready", scopes: navigationScopes });
  for (const record of seed.lifecycle ?? []) {
    store.dispatch({
      kind: "operation-recorded",
      requestId: record.requestId,
      intent: record.intent,
    });
    store.dispatch({ kind: "operation-receipt", receipt: lifecycleReceipt(record) });
  }
  for (const [projectId, mate] of Object.entries(seed.mates ?? {})) {
    const { presence, ...overview } = mate;
    const attention = seed.attention?.[projectId];
    const scopes = generations([
      hqMateScope(orgId, projectId),
      ...(attention === undefined ? [] : [hqMateAttentionScope(orgId, projectId)]),
    ]);
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
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
            attention: attention ?? null,
            attentionState: attention === undefined ? "none" : "live",
          },
        },
        ...(attention === undefined
          ? []
          : [
              {
                family: "mateAttention" as const,
                id: projectId,
                revision: {
                  kind: "mate-attention" as const,
                  environmentId: attention.source.environmentId,
                  epoch: attention.source.epoch,
                  incarnation: attention.source.incarnation,
                  revision: attention.source.revision,
                  live: true,
                },
                value: attention,
              },
            ]),
      ],
      removals: [],
    });
    store.dispatch({ kind: "hq-ready", scopes });
  }
  for (const scope of opening) event(scope, { kind: "baseline-committed" });
  if (seed.live === false) {
    event(linkKeys.hq(orgId), {
      kind: "fault",
      fault: { outcome: "transient", message: "HQ's stream broke." },
      jitter: 0,
    });
    // Down, not blinking: past the reconnect's grace.
    for (const input of graceOver(store.state())) store.dispatch(input);
  }
}

/** Every HQ scope the store observes in `orgId`, as HQ's next segment asks for them again. */
const hqScopesOf = (store: AccountStore, orgId: string): ReadonlyArray<ScopeKey> =>
  [...store.state().streams.keys()].filter(
    (key): key is ScopeKey => key.startsWith(`hq:${orgId}:`) && key !== linkKeys.hq(orgId),
  );

/**
 * HQ ends its segment as planned (`4410`, every 100 s) and the next one asks for each scope again,
 * as the HQ adapter does: a new registration of each, its handshake made, HQ yet to confirm it.
 */
export function hqSegmentEnds(store: AccountStore, orgId: string, now: number): void {
  for (const key of hqScopesOf(store, orgId)) {
    store.dispatch({ kind: "stream", key, now, event: { kind: "attempt" } });
    store.dispatch({ kind: "stream", key, now, event: { kind: "handshake" } });
  }
}

/** HQ says each scope it was asked for again is ready: nothing changed meanwhile. */
export function hqConfirms(store: AccountStore, orgId: string, now: number): void {
  for (const key of hqScopesOf(store, orgId))
    store.dispatch({ kind: "stream", key, now, event: { kind: "baseline-committed" } });
}

/** HQ's socket breaks (no planned end): the link starts recovering and each scope waits on it. */
export function hqDrops(store: AccountStore, orgId: string, now: number): void {
  store.dispatch({
    kind: "stream",
    key: linkKeys.hq(orgId),
    now,
    event: { kind: "fault", fault: { outcome: "transient", message: "closed" }, jitter: 0 },
  });
  for (const key of hqScopesOf(store, orgId))
    store.dispatch({ kind: "stream", key, now, event: { kind: "parent-lost" } });
}
