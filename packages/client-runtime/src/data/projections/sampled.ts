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
import type { Family, FamilyValues, ScopeKey } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface SampledRead<T> {
  /** The owner's value as the last read answered it; `undefined` until one did. */
  readonly value: T | undefined;
  /**
   * `ready` once a read answered, whatever reads it again; `failed` with nothing answered and its
   * read failing or refused; `loading` until then.
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
  const { phase } = read.stream(scope);
  const value = fact.kind === "known" ? fact.value : undefined;
  const failing = phase === "recovering" || phase === "refused";
  return {
    value,
    status: value !== undefined ? "ready" : failing ? "failed" : "loading",
    settled: value !== undefined && phase === "live",
    refused: phase === "refused",
  };
}

/** An organization's members, read for its official HQ's anchor and for whom HQ does not name. */
export const organizationMembers: Projection<
  string,
  SampledRead<FamilyValues["organizationMembers"]>
> = {
  name: "organizationMembers",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => sampledRead(read, "organizationMembers", membersScope(orgId), orgId),
  equals: sameValue,
};

/** Where the organization may put a new project. */
export const organizationLocations: Projection<
  string,
  SampledRead<FamilyValues["organizationLocations"]>
> = {
  name: "organizationLocations",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => sampledRead(read, "organizationLocations", locationsScope(orgId), orgId),
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
