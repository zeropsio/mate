/**
 * The sampled sources as a screen reads them (`families/{organizationMembers,
 * organizationLocations,serviceAgents}.ts`): the owner's value once a read answered it, shown under
 * every read again, and the stream's own word on whether a read is under way, failed or refused —
 * never the absence of data.
 *
 * @module data/projections/sampled
 */
import { locationsScope } from "../families/organizationLocations.ts";
import { membersScope } from "../families/organizationMembers.ts";
import { agentsScope } from "../families/serviceAgents.ts";
import type { Coverage, Family, FamilyValues, PublicRead, ScopeKey, StreamKey } from "../model.ts";
import type { StreamState } from "../streamMachine.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface SampledRead<T> {
  readonly fact: PublicRead<T>;
  readonly coverage: Coverage;
  readonly stream: StreamState;
  readonly link: StreamState | null;
  /** The owner's value as the last read answered it; `undefined` until one did. */
  readonly value: T | undefined;
  /**
   * `ready` only for a complete current answer; retained values remain visible while loading
   * or failed. The public fact, coverage and stream preserve why.
   */
  readonly status: "loading" | "ready" | "failed";
  /** The value is what a read settled: none is under way or failing over it. */
  readonly settled: boolean;
  /** Its owner refused it: nothing reads it again until the person tries again. */
  readonly refused: boolean;
}

/** A sampled scope's read of its owner's fact. */
export function sampledRead<F extends Family>(
  read: ProjectionReads,
  family: F,
  scope: ScopeKey,
  ownerId: string,
): SampledRead<FamilyValues[F]> {
  const fact = read.fact(family, ownerId);
  const stream = read.stream(scope);
  const link = stream.parent === null ? null : read.stream(stream.parent as StreamKey);
  const fault = link?.fault ?? stream.fault;
  const coverage = read.coverage(scope);
  let value: FamilyValues[F] | undefined;
  switch (fact.kind) {
    case "known":
      value = fact.value;
      break;
    case "unknown":
    case "deleted":
    case "withheld":
      break;
  }
  const refused = stream.phase === "refused" || link?.phase === "refused";
  const failing = fault !== null || refused || fact.kind === "withheld";
  const settled =
    fact.kind === "known" && coverage === "complete" && stream.phase === "live" && !failing;
  return {
    fact,
    coverage,
    stream,
    link,
    value,
    status: failing ? "failed" : settled ? "ready" : "loading",
    settled,
    refused,
  };
}

/**
 * An organization's members as a screen names people from them: nobody until a read answered —
 * `status` says whether one is under way, failed or refused.
 */
export interface MembersRead extends Omit<
  SampledRead<FamilyValues["organizationMembers"]>,
  "value"
> {
  readonly members: FamilyValues["organizationMembers"];
}

const NO_MEMBERS: FamilyValues["organizationMembers"] = [];

/**
 * An organization's members — by default the one shown — read for its official HQ's anchor and for
 * whom HQ does not name.
 */
export const organizationMembers: Projection<
  { readonly orgId: string; readonly clientId: string },
  MembersRead
> = {
  name: "organizationMembers",
  keyOf: ({ orgId, clientId }) => `${orgId}/${clientId}`,
  derive: (read, { orgId, clientId }) => {
    const { value, ...standing } = sampledRead(
      read,
      "organizationMembers",
      membersScope(orgId, clientId),
      clientId,
    );
    return { members: value ?? NO_MEMBERS, ...standing };
  },
  equals: sameValue,
};

/** The places a new project may be put in: none to offer until a read answered them. */
export interface LocationsRead extends Omit<
  SampledRead<FamilyValues["organizationLocations"]>,
  "value"
> {
  readonly locations: FamilyValues["organizationLocations"];
}

const NO_LOCATIONS: FamilyValues["organizationLocations"] = [];

/** Where the organization may put a new project. */
export const organizationLocations: Projection<string, LocationsRead> = {
  name: "organizationLocations",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const { value, ...standing } = sampledRead(
      read,
      "organizationLocations",
      locationsScope(orgId),
      orgId,
    );
    return { ...standing, locations: value ?? NO_LOCATIONS };
  },
  equals: sameValue,
};

/** The agents each of these Mates' services is signed in with, by service id. */
export const servicesAgents: Projection<
  { readonly orgId: string; readonly serviceIds: ReadonlyArray<string> },
  Readonly<Record<string, SampledRead<FamilyValues["serviceAgents"]>>>
> = {
  name: "servicesAgents",
  keyOf: ({ orgId, serviceIds }) => `${orgId}/${serviceIds.join(",")}`,
  derive: (read, { orgId, serviceIds }) =>
    Object.fromEntries(
      serviceIds.map((serviceId) => [
        serviceId,
        sampledRead(read, "serviceAgents", agentsScope(orgId, serviceId), serviceId),
      ]),
    ),
  equals: sameValue,
};
