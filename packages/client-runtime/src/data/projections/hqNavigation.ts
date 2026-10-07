/**
 * The organization as HQ's navigation says it, for the surfaces that place projects: its
 * applications with the projects HQ places in each, the Mates it holds in none, its offers and
 * tools, the presses it holds, the people its records name, and how its HQ stands — each read from
 * the store's facts and the navigation's own streams. A record HQ removed, or withheld from the
 * reader, is in none of it. An application's detail (releases, recipes, changes) and its
 * environments are no part of the navigation.
 *
 * @module data/projections/hqNavigation
 */
import { HQ_NAVIGATION_PROTOCOL } from "@t3tools/shared/hqStream";
import type { HqPeople } from "@t3tools/shared/hqMates";

import type { HqMate, HqStructure } from "../../zerops/hq/client.ts";
import { environmentsOf } from "../../zerops/hq/environments.ts";
import {
  hqAppsScope,
  hqPeopleScope,
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
import { linkKeys } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { retryDelayMs, STREAM_POLICY } from "../streamMachine.ts";
import { sameValue } from "./equal.ts";
import { scopeFreshness, type ScopeFreshness } from "./freshness.ts";
import type { RosterRead } from "./projects.ts";

export interface HqNavigationRead extends Omit<ScopeFreshness, "complete"> {
  /** `null` until HQ's navigation said anything of the organization's applications. */
  readonly structure: HqStructure | null;
  readonly organization: HqOrganizationValue | null;
  /** The presses HQ holds, by project: each held while HQ lists it. */
  readonly presses: Readonly<Record<string, HqPressValue>>;
  readonly people: HqPeople;
  /** Where the navigation's read stands: not asked for, its first catchup under way, or read. */
  readonly read: RosterRead;
  /** HQ's own word on why it refused the navigation, while it does. */
  readonly refusal: string | null;
  /** HQ does not answer, and its retries are as far apart as they get. */
  readonly capped: boolean;
  /** A caught-up Core has not proved support for the navigation facts this client needs. */
  readonly updateRequired: boolean;
  readonly coreBuild: string | undefined;
}

/** The ids a navigation scope lists, each with its value. */
function listed<F extends "hqApp" | "placement" | "hqPerson" | "hqPress">(
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
    closedOff: mate.closedOff,
    setupMarker: mate.setupMarker,
    keyWider: mate.keyWider,
    ...(mate.birthId === undefined ? {} : { birthId: mate.birthId }),
    // Who last signed each of its agents in, as HQ's record keeps it (`Mine` without an owner).
    ...(signers === undefined || Object.keys(signers).length === 0 ? {} : { signers }),
  };
}

/**
 * An application's stage and production with their deploys, to whoever reads its changes; HQ's
 * refusal with its reason to one who only sees it; none where they cannot be read.
 */
function environmentsOfApp(
  environments: HqAppValue["environments"],
): Pick<HqStructure["apps"][number], "environments"> {
  if (environments === undefined) return {};
  if ("refused" in environments) return { environments: { refused: environments.refused } };
  const read = environmentsOf(environments);
  return read === undefined ? {} : { environments: read };
}

const offersOf = (placement: PlacementValue) =>
  placement.can === undefined ? {} : { can: placement.can };

function structureOf(
  read: ProjectionReads,
  orgId: string,
  organization: HqOrganizationValue | null,
): HqStructure | null {
  if (
    read.coverage(hqAppsScope(orgId)) !== "complete" &&
    read.members(hqAppsScope(orgId)).ids.length === 0
  )
    return null;
  const placements = new Map(
    listed(read, "placement", placementsScope(orgId)).map(({ id, value }) => [id, value]),
  );
  return {
    ...(organization === null
      ? {}
      : { can: organization.can, unheld: organization.unheld, tools: organization.tools }),
    apps: listed(read, "hqApp", hqAppsScope(orgId)).map(({ id, value: app }) => ({
      id,
      name: app.name ?? "Unknown",
      ...(app.can === undefined ? {} : { can: app.can }),
      ...(app.contents === undefined ? {} : { contents: app.contents }),
      ...(app.births === undefined ? {} : { births: app.births }),
      ...environmentsOfApp(app.environments),
      projects: (
        app.projectIds ??
        [...placements].flatMap(([projectId, placed]) => (placed.appId === id ? [projectId] : []))
      ).flatMap((projectId) => {
        const placement = placements.get(projectId);
        return placement === undefined
          ? []
          : [
              {
                projectId,
                name: placement.name ?? "Unknown",
                kind: placement.kind ?? "unknown",
                mate:
                  placement.mate == null
                    ? placement.mate
                    : mateOf(placement.mate, placement.everSignedIn),
                ...offersOf(placement),
              },
            ];
      }),
    })),
    ungrouped: [...placements].flatMap(([projectId, placement]) =>
      placement.appId !== null || placement.mate == null
        ? []
        : [
            {
              projectId,
              name: placement.name ?? "Unknown",
              mate: mateOf(placement.mate, placement.everSignedIn),
              ...offersOf(placement),
            },
          ],
    ),
  };
}

function navigationOf(
  read: ProjectionReads,
  orgId: string,
  includePeople: boolean,
): HqNavigationRead {
  const scope = hqAppsScope(orgId);
  const { complete, ...freshness } = scopeFreshness(read, scope);
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
    organization,
    presses: Object.fromEntries(
      listed(read, "hqPress", hqPressesScope(orgId)).map(({ id, value }) => [id, value]),
    ),
    people: includePeople
      ? Object.fromEntries(
          listed(read, "hqPerson", hqPeopleScope(orgId)).map(({ id, value }) => [
            id,
            {
              name: value.name ?? "Unknown",
              avatarUrl: value.avatarUrl,
              ...(value.clientUserId === undefined ? {} : { clientUserId: value.clientUserId }),
            },
          ]),
        )
      : {},
    read: complete ? "read" : phase === "idle" || phase === "paused" ? "unread" : "reading",
    refusal: refused?.fault?.message ?? null,
    capped:
      link.phase === "recovering" && retryDelayMs(link.failures, 1) >= STREAM_POLICY.backoffCapMs,
    ...freshness,
    // What was read and is not live now is catching up, whatever step its next attempt is at.
    reconnecting:
      freshness.reconnecting ||
      (complete && !freshness.live && freshness.unavailableReason === undefined),
  };
}
export const hqNavigation: Projection<string, HqNavigationRead> = {
  name: "hqNavigation",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => navigationOf(read, orgId, true),
  equals: sameValue,
};
/** Structure and navigation standing have no dependency on individual people. */
export const hqMenuNavigation: Projection<string, HqNavigationRead> = {
  name: "hqMenuNavigation",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => navigationOf(read, orgId, false),
  equals: sameValue,
};

/**
 * What HQ computed of the reader for each project it places, by project: their role, whether they
 * may write to its Mate, whether it is theirs (*Mine*), and how much of it they have not seen.
 * Apart from the navigation: it moves with every result a Mate publishes.
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

/** Compact per-person release offers; independent of any app-detail demand. */
export const hqAppReleaseOffers: Projection<
  string,
  Readonly<Record<string, HqAppValue["releaseOffer"]>>
> = {
  name: "hqAppReleaseOffers",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) =>
    Object.fromEntries(
      listed(read, "hqApp", hqAppsScope(orgId)).map(({ id, value }) => [id, value.releaseOffer]),
    ),
  equals: sameValue,
};
