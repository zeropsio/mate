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
import type { HqPeople } from "@t3tools/shared/hqMates";

import type { HqMate, HqStructure } from "../../zerops/hq/client.ts";
import {
  hqAppsScope,
  hqPeopleScope,
  hqPressesScope,
  placementsScope,
  type HqOrganizationValue,
  type HqPersonFacts,
  type HqPressValue,
  type PlacementValue,
} from "../families/hqNavigation.ts";
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
function mateOf(mate: NonNullable<PlacementValue["mate"]>): HqMate {
  return {
    face: mate.face,
    madeBy: mate.madeBy,
    standupRequestedBy: mate.standupRequestedBy,
    closedOff: mate.closedOff,
    keyWider: mate.keyWider,
    ...(mate.birthId === undefined ? {} : { birthId: mate.birthId }),
    ...(mate.signers === undefined ? {} : { signers: mate.signers }),
  };
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
    apps: listed(read, "hqApp", hqAppsScope(orgId)).map(({ value: app }) => ({
      id: app.id,
      name: app.name,
      can: app.can,
      contents: app.contents,
      births: app.births,
      projects: app.projectIds.flatMap((projectId) => {
        const placement = placements.get(projectId);
        return placement === undefined
          ? []
          : [
              {
                projectId,
                name: placement.name,
                kind: placement.kind,
                mate: placement.mate === null ? null : mateOf(placement.mate),
                ...offersOf(placement),
              },
            ];
      }),
    })),
    ungrouped: [...placements.values()].flatMap((placement) =>
      placement.appId !== null || placement.mate === null
        ? []
        : [
            {
              projectId: placement.projectId,
              name: placement.name,
              mate: mateOf(placement.mate),
              ...offersOf(placement),
            },
          ],
    ),
  };
}

export const hqNavigation: Projection<string, HqNavigationRead> = {
  name: "hqNavigation",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const scope = hqAppsScope(orgId);
    const { complete, ...freshness } = scopeFreshness(read, scope);
    const organizationFact = read.fact("hqOrganization", orgId);
    const organization = organizationFact.kind === "known" ? organizationFact.value : null;
    const phase = read.stream(scope).phase;
    const link = read.stream(linkKeys.hq(orgId));
    const refused = [link, read.stream(scope)].find((stream) => stream.phase === "refused");
    return {
      structure: structureOf(read, orgId, organization),
      organization,
      presses: Object.fromEntries(
        listed(read, "hqPress", hqPressesScope(orgId)).map(({ id, value }) => [id, value]),
      ),
      people: Object.fromEntries(
        listed(read, "hqPerson", hqPeopleScope(orgId)).map(({ id, value }) => [id, value]),
      ),
      read: complete ? "read" : phase === "idle" || phase === "paused" ? "unread" : "reading",
      refusal: refused?.fault?.message ?? null,
      capped:
        link.phase === "recovering" && retryDelayMs(link.failures, 1) >= STREAM_POLICY.backoffCapMs,
      ...freshness,
    };
  },
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
      listed(read, "placement", placementsScope(orgId)).map(({ id, value }) => [id, value.person]),
    ),
  equals: sameValue,
};
