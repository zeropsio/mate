/**
 * The organization as HQ's navigation says it, for the surfaces that place projects: its
 * applications with the projects HQ places in each, the Mates it holds in none, the presses it
 * holds, the people its records name, and how its HQ stands — each read from the store's facts and
 * the navigation's own streams — with what the person may do with each, decided over their own live
 * read of Zerops (`permissionFacts`). A record HQ removed is in none of it. An application's detail (releases, recipes, changes) and its
 * environments are no part of the navigation.
 *
 * @module data/projections/hqNavigation
 */
import type { HqOffers } from "@t3tools/shared/hqOffers";
import { HQ_NAVIGATION_PROTOCOL } from "@t3tools/shared/hqStream";
import {
  applicationOffers,
  environmentOffers,
  gitEnvironmentOffers,
  organizationOffers,
  placeableOffers,
  placementOffers,
  type ApplicationFacts,
} from "@t3tools/shared/zeropsOffers";

import type { HqMate, HqStructure, CanonicalHqStructure } from "../../zerops/hq/client.ts";
import { zeropsStructure } from "../../zerops/hq/structure.ts";
import { canonicalEnvironmentsOf } from "../../zerops/hq/environments.ts";
import {
  hqAppsScope,
  hqPressesScope,
  hqStatusScope,
  placementsScope,
  type HqAppValue,
  type HqOrganizationValue,
  type HqPersonFacts,
  type HqPressValue,
  type HqStatusValue,
  type PlacementValue,
} from "../families/hqNavigation.ts";
import { hqProtocolScope } from "../families/hqProtocol.ts";
import { projectsScope } from "../families/project.ts";
import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import type { HqGitTargetRecord } from "../adapters/hqGitTargets.ts";
import { linkKeys } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { retryDelayMs, STREAM_POLICY } from "../streamMachine.ts";
import { sameValue } from "./equal.ts";
import { zeropsPeople, type ZeropsPerson } from "./zeropsPeople.ts";

import {
  applicationFacts,
  applicationProjects,
  decided,
  livePermissionFacts,
} from "./permissionFacts.ts";
import { scopeFreshness, scopeSlow, type ScopeFreshness } from "./freshness.ts";
import { hqLinkOf, type HqLink } from "./hqLink.ts";
import type { RosterRead } from "./projects.ts";

export type HqNavigationPeople = Readonly<
  Record<string, Pick<ZeropsPerson, "name" | "called" | "clientUserId">>
>;

export interface HqNavigationRead extends Pick<ScopeFreshness, "unavailableReason"> {
  /** The viewer's link to HQ (`hqLink`): the one word on whether HQ answers now. */
  readonly link: HqLink;
  /** `null` until HQ's navigation said anything of the organization's applications. */
  readonly structure: HqStructure | null;
  readonly organization: HqOrganizationValue | null;
  /** The presses HQ holds, by project: each held while HQ lists it. */
  readonly presses: Readonly<Record<string, HqPressValue>>;
  /** The organization's people by Zerops user id (`ZeropsPerson`). */
  readonly people: HqNavigationPeople;
  /** Where the navigation's read stands: not asked for, its first catchup under way, or read. */
  readonly read: RosterRead;
  /** HQ's own word on why it refused the navigation, while it does. */
  readonly refusal: string | null;
  /**
   * Its first answer has not come and its attempts are failing. This and the next two say only
   * how HQ's first answer comes; once it answered, HQ away is the link's to say.
   */
  readonly retrying: boolean;
  /** HQ never answered, and its retries are as far apart as they get. */
  readonly capped: boolean;
  /** HQ's connection holds, and it is still working on its first answer: slow, not down. */
  readonly slow: boolean;
  /** A caught-up Core has not proved support for the navigation facts this client needs. */
  readonly updateRequired: boolean;
  readonly coreBuild: string | undefined;
}

export interface CanonicalHqNavigationRead extends Omit<HqNavigationRead, "structure"> {
  readonly structure: CanonicalHqStructure | null;
}

export interface HqDeliveryNavigationRead extends HqNavigationRead {
  /** Additive delivery reader; protected facts, including Git, without invented project addresses. */
  readonly deliveryEnvironments: Readonly<Record<string, NonNullable<HqAppValue["environments"]>>>;
}
export type CanonicalHqDeliveryNavigationRead = CanonicalHqNavigationRead &
  Pick<HqDeliveryNavigationRead, "deliveryEnvironments">;

function compatibilityNavigation(
  answer: CanonicalHqDeliveryNavigationRead,
): HqDeliveryNavigationRead {
  return {
    ...answer,
    structure: answer.structure === null ? null : zeropsStructure(answer.structure),
  };
}

export const canonicalHqNavigation = {
  name: "canonicalHqNavigation",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => navigationOf(read, orgId, true),
  equals: sameValue,
} satisfies Projection<string, CanonicalHqDeliveryNavigationRead>;

/**
 * What the person may do with one of an application's environments: a Zerops one as the structure
 * decides it, a Git one by the structure's writers (`gitEnvironmentOffers`). `undefined` while
 * unknown.
 */
export const hqEnvironmentOffers = {
  name: "hqEnvironmentOffers",
  keyOf: ({ orgId, appId, environmentId }) => `${orgId}/${appId}/${environmentId}`,
  derive: (read, { orgId, appId, environmentId }) => {
    const app = read.fact("hqApp", appId);
    const environment =
      app.kind === "known"
        ? app.value.environments?.find((candidate) => candidate.id === environmentId)
        : undefined;
    if (environment === undefined) return undefined;
    if (environment.target.kind === "git")
      return decided(livePermissionFacts(read, orgId), [], gitEnvironmentOffers);
    return canonicalHqNavigation
      .derive(read, orgId)
      .structure?.apps.find((candidate) => candidate.id === appId)
      ?.environments?.find((candidate) => candidate.id === environmentId)?.can;
  },
  equals: sameValue,
} satisfies Projection<
  { readonly orgId: string; readonly appId: string; readonly environmentId: string },
  HqOffers | undefined
>;

/** The ids a navigation scope lists, each with its value. */
function listed<F extends "hqApp" | "placement" | "hqPress">(
  read: ProjectionReads,
  family: F,
  scope: Parameters<ProjectionReads["members"]>[0],
) {
  return read.members(scope).ids.flatMap((id) => {
    const fact = read.fact(family, id);
    return fact.kind === "known" ? [{ id, value: fact.value }] : [];
  });
}

/** A Mate's record as the old surfaces read it: what HQ leaves unsaid is absent. */
function mateOf(
  mate: NonNullable<PlacementValue["mate"]>,
  /** Who last signed each of its agents in, by login, as HQ keeps it after sign-out too. */
  signers: PlacementValue["everSignedIn"],
): HqMate {
  return {
    ...(mate.face === undefined ? {} : { face: mate.face }),
    madeBy: mate.madeBy,
    standupRequestedBy: mate.standupRequestedBy,
    ...(mate.birthId === undefined ? {} : { birthId: mate.birthId }),
    ...(mate.importProcessId === undefined ? {} : { importProcessId: mate.importProcessId }),
    ...(mate.automated === undefined ? {} : { automated: mate.automated }),
    ...(mate.task === undefined ? {} : { task: mate.task }),
    // Who last signed each of its agents in, as HQ's record keeps it (`Mine` without an owner).
    ...(signers === undefined || Object.keys(signers).length === 0 ? {} : { signers }),
  };
}

/**
 * An application's Zerops stage and production with their deploys, each with what the person may
 * do with it; none where HQ sent none this build can read.
 */
function environmentsOfApp(
  environments: HqAppValue["environments"],
  offers: (projectId: string, tier: "stage" | "production") => HqOffers | undefined,
): Pick<CanonicalHqStructure["apps"][number], "environments"> {
  if (environments === undefined) return {};
  // Legacy Zerops rows still go through their existing normalizer; Git has no outward project DTO.
  const read = canonicalEnvironmentsOf(environments.filter((row) => row.target?.kind !== "git"));
  return read === undefined
    ? {}
    : {
        environments: read.map((environment) => {
          const can =
            environment.target.kind === "zerops"
              ? offers(environment.target.projectId, environment.tier)
              : undefined;
          return can === undefined ? environment : { ...environment, can };
        }),
      };
}

const offered = (can: HqOffers | undefined) => (can === undefined ? {} : { can });

function structureOf(
  read: ProjectionReads,
  orgId: string,
  organization: HqOrganizationValue | null,
): CanonicalHqStructure | null {
  if (
    read.coverage(hqAppsScope(orgId)) !== "complete" &&
    read.members(hqAppsScope(orgId)).ids.length === 0
  )
    return null;
  const placements = new Map(
    listed(read, "placement", placementsScope(orgId)).map(({ id, value }) => [id, value]),
  );
  // What the person may do with each, from their own live read of Zerops (`zeropsOffers`).
  const facts = livePermissionFacts(read, orgId);
  const placementCan = (projectId: string, kind: string, app: ApplicationFacts) =>
    decided(facts, [projectId, ...app.projectIds], (live) =>
      placementOffers(live, { projectId, kind }, app),
    );
  const ungroupedApp: ApplicationFacts = { projectIds: [], placements: [], production: null };
  return {
    ...(organization === null ? {} : offered(decided(facts, [], organizationOffers))),
    // Placeable: in the person's own live Zerops list, with no row in HQ's read structure.
    ...(facts === undefined || read.coverage(placementsScope(orgId)) !== "complete"
      ? {}
      : {
          placeable: Object.fromEntries(
            read.members(projectsScope(orgId)).ids.flatMap((projectId) => {
              if (placements.has(projectId)) return [];
              const can = decided(facts, [projectId], (live) => placeableOffers(live, projectId));
              return can === undefined ? [] : [[projectId, can]];
            }),
          ),
        }),
    apps: listed(read, "hqApp", hqAppsScope(orgId)).map(({ id, value: app }) => {
      const projects = (
        app.projectIds ??
        [...placements].flatMap(([projectId, placed]) => (placed.appId === id ? [projectId] : []))
      ).flatMap((projectId) => {
        const placement = placements.get(projectId);
        return placement === undefined
          ? []
          : [{ projectId, placement, kind: placement.kind ?? "unknown" }];
      });
      const appFacts = applicationFacts(app, projects);
      return {
        id,
        name: app.name ?? "Unknown",
        ...offered(
          decided(facts, applicationProjects(appFacts), (live) =>
            applicationOffers(live, appFacts),
          ),
        ),
        ...(app.problems === undefined ? {} : { problems: app.problems }),
        ...(app.contents === undefined ? {} : { contents: app.contents }),
        ...(app.births === undefined ? {} : { births: app.births }),
        ...(app.intake === undefined ? {} : { intake: app.intake }),
        ...environmentsOfApp(app.environments, (projectId, tier) =>
          decided(facts, [projectId, ...appFacts.projectIds], (live) =>
            environmentOffers(live, { projectId, tier }, appFacts),
          ),
        ),
        projects: projects.map(({ projectId, placement, kind }) => ({
          projectId,
          name: placement.name ?? "Unknown",
          kind,
          mate:
            placement.mate == null
              ? placement.mate
              : mateOf(placement.mate, placement.everSignedIn),
          ...offered(placementCan(projectId, kind, appFacts)),
        })),
      };
    }),
    ungrouped: [...placements].flatMap(([projectId, placement]) =>
      placement.appId !== null || placement.mate == null
        ? []
        : [
            {
              projectId,
              name: placement.name ?? "Unknown",
              mate: mateOf(placement.mate, placement.everSignedIn),
              ...offered(placementCan(projectId, placement.kind ?? "mate", ungroupedApp)),
            },
          ],
    ),
  };
}

function navigationOf(
  read: ProjectionReads,
  orgId: string,
  includePeople: boolean,
): CanonicalHqDeliveryNavigationRead {
  const scope = hqAppsScope(orgId);
  const { complete, reconnecting, unavailableReason } = scopeFreshness(read, scope);
  const organizationFact = read.fact("hqOrganization", orgId);
  const organization = organizationFact.kind === "known" ? organizationFact.value : null;
  const phase = read.stream(scope).phase;
  const link = read.stream(linkKeys.hq(orgId));
  const refused = [link, read.stream(scope)].find((stream) => stream.phase === "refused");
  const protocol = read.fact("hqProtocol", orgId);
  const declared =
    protocol.kind === "known" && read.members(hqProtocolScope(orgId)).ids.includes(orgId)
      ? protocol.value
      : null;
  return {
    updateRequired:
      declared !== null &&
      (declared.protocol === undefined || declared.protocol < HQ_NAVIGATION_PROTOCOL),
    coreBuild: declared?.build,
    structure: structureOf(read, orgId, organization),
    deliveryEnvironments: Object.fromEntries(
      listed(read, "hqApp", scope).flatMap(({ id, value }) =>
        value.environments === undefined ? [] : [[id, value.environments]],
      ),
    ),
    organization,
    presses: Object.fromEntries(
      listed(read, "hqPress", hqPressesScope(orgId)).map(({ id, value }) => [id, value]),
    ),
    people: includePeople
      ? Object.fromEntries(
          [...zeropsPeople(read, orgId)].map(([id, { name, called, clientUserId }]) => [
            id,
            { name, called, clientUserId },
          ]),
        )
      : {},
    read: complete ? "read" : phase === "idle" || phase === "paused" ? "unread" : "reading",
    refusal: refused?.fault?.message ?? null,
    link: hqLinkOf(read, orgId),
    retrying: !complete && reconnecting,
    capped:
      !complete &&
      link.phase === "recovering" &&
      retryDelayMs(link.failures, 1) >= STREAM_POLICY.backoffCapMs,
    slow: !complete && scopeSlow(read, scope),
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
  };
}
export const hqNavigation = {
  name: "hqNavigation",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => compatibilityNavigation(canonicalHqNavigation.derive(read, orgId)),
  equals: sameValue,
} satisfies Projection<string, HqDeliveryNavigationRead>;

/** Review facts share app-detail's order, access and demand; silence cannot manufacture a verdict. */
export const hqAppGitTargets: Projection<
  { readonly orgId: string; readonly appId: string },
  {
    readonly records: Readonly<Record<string, HqGitTargetRecord>>;
  } & ScopeFreshness
> = {
  name: "hqAppGitTargets",
  keyOf: ({ orgId, appId }) => JSON.stringify([orgId, appId]),
  derive: (read, { orgId, appId }) => {
    const scope = hqAppDetailScope(orgId, appId);
    return {
      ...scopeFreshness(read, scope),
      records: Object.fromEntries(
        read.members(scope).ids.flatMap((id) => {
          const fact = read.fact("hqAppDetail", id);
          if (fact.kind !== "known") return [];
          const value = fact.value;
          return value.kind === "probe" ||
            value.kind === "preflight" ||
            value.kind === "adoption" ||
            value.kind === "delivery"
            ? [[id.slice(appId.length + 1), value]]
            : [];
        }),
      ),
    };
  },
  equals: sameValue,
};
/** Structure and navigation standing have no dependency on individual people. */
export const canonicalHqMenuNavigation = {
  name: "canonicalHqMenuNavigation",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => navigationOf(read, orgId, false),
  equals: sameValue,
} satisfies Projection<string, CanonicalHqDeliveryNavigationRead>;

export const hqMenuNavigation = {
  name: "hqMenuNavigation",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => compatibilityNavigation(canonicalHqMenuNavigation.derive(read, orgId)),
  equals: sameValue,
} satisfies Projection<string, HqDeliveryNavigationRead>;

/**
 * What HQ computed of the reader for each project it places, by project: whether it is theirs
 * (*Mine*), whether it waits on them, and how much of it they have not seen. Apart from the
 * navigation: it moves with every result a Mate publishes.
 */
export const hqPersonFacts: Projection<string, Readonly<Record<string, HqPersonFacts>>> = {
  name: "hqPersonFacts",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) =>
    Object.fromEntries(
      listed(read, "placement", placementsScope(orgId)).flatMap(({ id, value }) =>
        value.person === undefined ? [] : [[id, value.person]],
      ),
    ),
  equals: sameValue,
};

/** How the organization's HQ stands, as its navigation says it; `null` before it said. */
export const hqStatus: Projection<string, HqStatusValue | null> = {
  name: "hqStatus",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const fact = read.fact("hqStatus", orgId);
    return fact.kind === "known" && read.members(hqStatusScope(orgId)).ids.includes(orgId)
      ? fact.value
      : null;
  },
  equals: sameValue,
};

/**
 * Each application's open changes as HQ's navigation says them, for the menu's change rows: what
 * the menu draws and orders, never a change's contents. HQ's refusal with its reason to one who
 * may not read them.
 */
export const hqAppChanges: Projection<string, Readonly<Record<string, HqAppValue["changes"]>>> = {
  name: "hqAppChanges",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) =>
    Object.fromEntries(
      listed(read, "hqApp", hqAppsScope(orgId)).map(({ id, value }) => [id, value.changes]),
    ),
  equals: sameValue,
};
