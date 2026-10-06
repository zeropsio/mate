/**
 * What a service runs and whether it serves Zerops Mate, as the data runtime states them — never
 * read per service. The service's own row, from its organization's search and stream, names its
 * active version and, while a push states it, that version's source; its variables
 * (`project-variables`) name the deploy the service last started (A11) and carry its Mate flag
 * (H9). A source the push left unstated is the organization's active versions' to state, in the
 * account's store (`account/stops.ts`).
 */
import { readsAsEnabled } from "../api.ts";
import type { Shown } from "../knowledge/known.ts";
import {
  rereadTableRows,
  serviceVariableHeard,
  serviceVariableOf,
  serviceVariablesDelivered,
  type EntityTableState,
} from "./entityTable.ts";
import type { ZeropsDataState } from "./state.ts";
import type { IngestionStamp, OrganizationRef, ServiceRecord, ServiceRef } from "./types.ts";
import { organizationKeyOf } from "./types.ts";

/**
 * What a service runs (A14): its active version's id and source (`NONE` on a runtime nothing was
 * ever deployed to), each `null` when it has no active version — the source also while its push
 * left it unstated — and that version's name — `null` unless the deploy the service last started is
 * the active one (A11), since only then is the name it carries the one it runs.
 */
export interface ZeropsServiceDeployedVersion {
  readonly activeId: string | null;
  readonly source: string | null;
  readonly name: string | null;
}

const UNREAD = { state: "unread", waitingFor: null } as const;

/** The organization's variables stream, failed: its failure; otherwise `null`. */
function streamFailure(state: ZeropsDataState, service: ServiceRef): Shown<never> | null {
  const organization = organizationKeyOf(service.project.organization);
  for (const desired of state.interests.values()) {
    const descriptor = desired.descriptor;
    if (
      descriptor.kind !== "project-variables" ||
      organizationKeyOf(descriptor.project.organization) !== organization ||
      !descriptor.serviceIds.includes(service.serviceId)
    )
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

/** What the service runs, its row as the account's store holds it (`serviceBridge.ts`). */
export function selectDeployedVersion(
  state: ZeropsDataState,
  service: ServiceRef,
  record: ServiceRecord | undefined,
): Shown<ZeropsServiceDeployedVersion> {
  const facet = record?.deployment;
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
  const source = deploy.source;
  const started = serviceVariableOf(state.table, organization, service.serviceId, "appVersionId");
  if (!started.known) {
    // The push's own name stands until the variables answer; with none, the name waits for them.
    if (deploy.name !== null)
      return known({ activeId: deploy.id, source, name: deploy.name }, facet.stamp);
    return streamFailure(state, service) ?? UNREAD;
  }
  if (trimmed(started.content) !== deploy.id) {
    // Variables that may trail the service are being read again: what it runs is checked, not
    // nameless (`wantStaleVariables`).
    const trailing = trailingVariables(
      state.table,
      service.serviceId,
      movedAt(state.table, service.serviceId, deploy.id, facet.stamp),
    );
    if (trailing !== null) return streamFailure(state, service) ?? UNREAD;
    return known({ activeId: deploy.id, source, name: null }, facet.stamp);
  }
  const name = trimmed(
    serviceVariableOf(state.table, organization, service.serviceId, "appVersionName").content,
  );
  return known({ activeId: deploy.id, source, name }, facet.stamp);
}

/**
 * The service's variables that name another deploy than the one it runs, where they were heard
 * before it moved there: they may only trail it, so they are read again by id. Heard after, they
 * name a build started since (A11), and stand. `null` for none.
 *
 * It moved when its push first named the version it runs (`movedAt`): a later push that changes
 * nothing of what it runs moves nothing, and asks nothing again.
 */
function trailingVariables(
  table: EntityTableState,
  serviceId: string,
  moved: number,
): ReadonlyArray<string> | null {
  const started = serviceVariableHeard(table, serviceId, "appVersionId");
  if (started === null || started.asOf >= moved) return null;
  const name = serviceVariableHeard(table, serviceId, "appVersionName");
  return name === null ? [started.id] : [started.id, name.id];
}

/** The receipt the service moved to `deployId` at; its push's own where no move was recorded. */
const movedAt = (
  table: EntityTableState,
  serviceId: string,
  deployId: string,
  stamp: IngestionStamp,
): number => {
  const move = table.moves.get(serviceId);
  return move?.deployId === deployId ? move.asOf : stamp.receiptOrdinal;
};

/** What a service's row says it runs now, as the account's store holds it. */
export interface ServiceDeployObserved {
  readonly organization: OrganizationRef;
  readonly serviceId: string;
  readonly deployId: string;
}

/**
 * Each service whose row now names another version than the one recorded has moved there, as of
 * the next receipt; its variables that name another deploy, heard before the move, are read again
 * by id (F13, 2026-10-03): the platform rewrites them in place at a build's start, and no push of
 * theirs is promised. Once read, they are newer than the move, so each move asks once, never in a
 * loop. A row naming the version already recorded moves nothing and asks nothing.
 */
export function observeServiceDeploys(
  state: ZeropsDataState,
  deploys: ReadonlyArray<ServiceDeployObserved>,
  nowMs: number,
): ZeropsDataState {
  let table = state.table;
  let moves: Map<string, { readonly deployId: string; readonly asOf: number }> | null = null;
  // Every receipt so far was heard before the move; a read started from now on answers after it.
  const heard = state.lastReceiptOrdinal ?? 0;
  const asOf = heard + 1;
  for (const { organization, serviceId, deployId } of deploys) {
    if ((moves ?? table.moves).get(serviceId)?.deployId === deployId) continue;
    moves ??= new Map(table.moves);
    moves.set(serviceId, { deployId, asOf });
    const started = serviceVariableOf(table, organization, serviceId, "appVersionId");
    if (!started.known || trimmed(started.content) === deployId) continue;
    const ids = trailingVariables(table, serviceId, asOf);
    if (ids !== null)
      table = rereadTableRows(table, "user-data", organization, ids, heard, nowMs, [serviceId]);
  }
  if (moves === null) return state;
  return { ...state, table: { ...table, moves } };
}

/**
 * The deploy name the store states for a service, as a key a read can follow: `"?"` until the
 * store knows what the service runs, then the name it runs (`""` for a version without one).
 */
export function statedDeployKey(shown: Shown<ZeropsServiceDeployedVersion> | undefined): string {
  return shown?.state === "known" ? `=${shown.value.name ?? ""}` : "?";
}

/**
 * `ZCP_MATE_ENABLED` on the service: absent reads as off, the way zcp reads it. `"unread"` until
 * the organization's variables are listed; `"unknown"` when their stream failed — never `false`,
 * a fact a row offers Enable on (H9).
 */
/**
 * The new press's marker on a Mate's container (`MATE_SETUP_RUNTIMES`, pass 28): whether the
 * service carries it. `"unread"` until the organization's variables are listed; `"unknown"` when
 * their stream failed.
 */
export function selectSetupMarker(
  state: ZeropsDataState,
  service: ServiceRef,
  record: ServiceRecord | undefined,
): boolean | "unknown" | "unread" {
  const marker = serviceVariableOf(
    state.table,
    service.project.organization,
    service.serviceId,
    "MATE_SETUP_RUNTIMES",
  );
  // Its presence alone: the value is the tier's import document, and it goes nowhere.
  if (marker.known) {
    if (marker.content !== null) return true;
    return containerTooYoungToSay(state, service, record) ? "unread" : false;
  }
  return streamFailure(state, service) === null ? "unread" : "unknown";
}

/** How young a container is, at the list's answer, whose variables may still be on their way. */
export const SETUP_MARKER_YOUNG_MS = 5 * 60_000;

/**
 * A container made within {@link SETUP_MARKER_YOUNG_MS} of the variables list's answer, none of
 * whose variables the stream has delivered: its marker may be on its way, so absent says nothing.
 */
function containerTooYoungToSay(
  state: ZeropsDataState,
  service: ServiceRef,
  record: ServiceRecord | undefined,
): boolean {
  const delivered = serviceVariablesDelivered(
    state.table,
    service.project.organization,
    service.serviceId,
  );
  if (delivered.any || delivered.answeredAtMs === null) return false;
  const lifecycle = record?.lifecycle;
  const createdAt = lifecycle?.knowledge === "observed" ? lifecycle.fields.createdAt : undefined;
  const created =
    createdAt === null || createdAt === undefined ? Number.NaN : Date.parse(createdAt);
  return !Number.isNaN(created) && created > delivered.answeredAtMs - SETUP_MARKER_YOUNG_MS;
}

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
  return streamFailure(state, service) === null ? "unread" : "unknown";
}
