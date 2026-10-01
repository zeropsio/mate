/**
 * What a service runs and whether it serves Zerops Mate, as the account's store states them —
 * never read per service. The service's own row, from its organization's search and stream, names
 * its active version and, while a push states it, that version's source; the organization's active
 * versions (`organization-versions`) state every source; its variables (`organization-variables`)
 * name the deploy the service last started (A11) and carry its Mate flag (H9).
 */
import { readsAsEnabled } from "../api.ts";
import type { Shown } from "../knowledge/known.ts";
import { activeVersionOf, serviceVariableOf } from "./entityTable.ts";
import type { ZeropsDataState } from "./state.ts";
import type { IngestionStamp, RuntimeInterestDescriptor, ServiceRef } from "./types.ts";
import { organizationKeyOf, serviceKeyOf } from "./types.ts";

/**
 * What a service runs (A14): its active version's id and source (`NONE` on a runtime nothing was
 * ever deployed to), each `null` when it has no active version, and that version's name — `null`
 * unless the deploy the service last started is the active one (A11), since only then is the name
 * it carries the one it runs.
 */
export interface ZeropsServiceDeployedVersion {
  readonly activeId: string | null;
  readonly source: string | null;
  readonly name: string | null;
}

const UNREAD = { state: "unread", waitingFor: null } as const;

/** The stream an organization-wide fact waits on, failed: its failure; otherwise `null`. */
function streamFailure(
  state: ZeropsDataState,
  kind: Extract<
    RuntimeInterestDescriptor["kind"],
    "organization-versions" | "organization-variables"
  >,
  service: ServiceRef,
): Shown<never> | null {
  const organization = organizationKeyOf(service.project.organization);
  for (const desired of state.interests.values()) {
    const descriptor = desired.descriptor;
    if (descriptor.kind !== kind || organizationKeyOf(descriptor.organization) !== organization)
      continue;
    const interest = desired.interest;
    if (interest.status === "failed")
      return {
        state: "failed",
        failure: { kind: "transport", detail: interest.reason },
        atMs: 0,
        attempt: interest.attempts,
        retryAtMs: interest.retryAtMs,
      };
  }
  return null;
}

const known = (
  value: ZeropsServiceDeployedVersion,
  stamp: IngestionStamp,
): Shown<ZeropsServiceDeployedVersion> => ({
  state: "known",
  value,
  asOf: { ordinal: stamp.receiptOrdinal, atMs: stamp.observedAtMs },
  coverage: "complete",
  freshness: { kind: "live" },
});

const trimmed = (content: string | null): string | null => {
  const value = content?.trim() ?? "";
  return value.length === 0 ? null : value;
};

export function selectDeployedVersion(
  state: ZeropsDataState,
  service: ServiceRef,
): Shown<ZeropsServiceDeployedVersion> {
  const facet = state.inventory.services.get(serviceKeyOf(service))?.deployment;
  // A service the platform no longer shows runs nothing anyone can state.
  if (facet?.knowledge === "unavailable")
    return {
      state: "failed",
      failure: { kind: "refused", code: facet.reason, words: "The service is not there." },
      atMs: facet.stamp.observedAtMs,
      attempt: 1,
      retryAtMs: null,
    };
  if (facet === undefined || facet.knowledge !== "observed") return UNREAD;
  const deploy = facet.fields.activeDeploy;
  if (deploy === undefined) return UNREAD;
  if (deploy === null || deploy.id === null)
    return known({ activeId: null, source: null, name: null }, facet.stamp);
  const organization = service.project.organization;
  let source = deploy.source;
  if (source === null) {
    const version = activeVersionOf(state.table, organization, deploy.id);
    // A version not listed active yet is one the list has not caught up with: it waits.
    if (!version.known || version.row === null)
      return streamFailure(state, "organization-versions", service) ?? UNREAD;
    source = version.row.source;
  }
  const started = serviceVariableOf(state.table, organization, service.serviceId, "appVersionId");
  if (!started.known) {
    // The push's own name stands until the variables answer; with none, the name waits for them.
    if (deploy.name !== null)
      return known({ activeId: deploy.id, source, name: deploy.name }, facet.stamp);
    return streamFailure(state, "organization-variables", service) ?? UNREAD;
  }
  const name =
    trimmed(started.content) === deploy.id
      ? trimmed(
          serviceVariableOf(state.table, organization, service.serviceId, "appVersionName").content,
        )
      : null;
  return known({ activeId: deploy.id, source, name }, facet.stamp);
}

/**
 * `ZCP_MATE_ENABLED` on the service: absent reads as off, the way zcp reads it. `"unread"` until
 * the organization's variables are listed; `"unknown"` when their stream failed — never `false`,
 * a fact a row offers Enable on (H9).
 */
export function selectMateFlag(
  state: ZeropsDataState,
  service: ServiceRef,
): boolean | "unknown" | "unread" {
  const flag = serviceVariableOf(
    state.table,
    service.project.organization,
    service.serviceId,
    "ZCP_MATE_ENABLED",
  );
  if (flag.known) return flag.content !== null && readsAsEnabled(flag.content);
  return streamFailure(state, "organization-variables", service) === null ? "unread" : "unknown";
}
