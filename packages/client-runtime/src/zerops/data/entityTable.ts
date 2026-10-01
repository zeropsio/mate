/**
 * The entity table: platform entities the account's socket streams by organization and the app
 * holds as the platform sends them, row for row (the legacy app's entity manager, `zef`). Each
 * kind is fed the same two ways the inventory is: a list (`listStream`) whose search states the
 * rows it admits and whose frames add and delete ids, and an update stream (`updateStream`) whose
 * frames carry whole rows, taken in place — an update never asks for a read.
 *
 * A row is held while its kind admits it (an active version; a variable the app reads) and no
 * list deleted it. A list whose search has answered makes its rows complete: a row it lacks is not
 * there. A search answer never overwrites a row pushed after the search began, nor brings back one
 * deleted after it began; a search that began before the one already applied says nothing.
 */
import type {
  AdmittedObservation,
  AppVersionRow,
  IngestionStamp,
  OrganizationRef,
  QueryCoverage,
  QueryKey,
  ReadStartOrdinal,
  ReceiptOrdinal,
  ServiceVariableRow,
  TableEntity,
  TableObservation,
  TableQueryDescriptor,
  TableRow,
  TableRowsOf,
} from "./types.ts";
import { queryKeyOf } from "./types.ts";
import { noOutcome, type DomainObservationOutcome } from "./inventory.ts";

/** The service variables the app reads: the Mate flag, and the deploy a service last started. */
export const SERVICE_VARIABLE_KEYS: ReadonlyArray<string> = [
  "ZCP_MATE_ENABLED",
  "appVersionId",
  "appVersionName",
];

interface HeldRow<Row> {
  readonly row: Row;
  /** The receipt the row is as current as: its push's, or the search's start for a search's row. */
  readonly asOf: number;
  /** The organization whose stream or search sent it. */
  readonly organizationId: string;
}

export interface TableListState {
  readonly key: QueryKey;
  readonly descriptor: TableQueryDescriptor;
  /** The search answer applied last; `null` until one was. */
  readonly answered: {
    readonly coverage: QueryCoverage;
    readonly stamp: IngestionStamp;
    readonly readStartOrdinal: ReadStartOrdinal;
  } | null;
}

export interface EntityTableState {
  readonly rows: {
    readonly [Entity in TableEntity]: ReadonlyMap<string, HeldRow<TableRowsOf[Entity]>>;
  };
  readonly lists: ReadonlyMap<QueryKey, TableListState>;
  /** Ids a list's stream deleted, with the receipt that deleted them. */
  readonly deleted: ReadonlyMap<string, ReceiptOrdinal>;
}

export interface EntityTableReduction {
  readonly state: EntityTableState;
  readonly outcome: DomainObservationOutcome;
}

export const makeInitialEntityTableState = (): EntityTableState => ({
  rows: { "app-version": new Map(), "user-data": new Map() },
  lists: new Map(),
  deleted: new Map(),
});

/** Whether a kind holds this row at all: an active version, a variable the app reads. */
function admits(entity: TableEntity, row: TableRow): boolean {
  return entity === "app-version"
    ? (row as AppVersionRow).status === "ACTIVE"
    : SERVICE_VARIABLE_KEYS.includes((row as ServiceVariableRow).key);
}

const outcomeOf = (
  observation: TableObservation,
  status: "applied" | "suppressed",
): DomainObservationOutcome => ({
  readRequestId:
    observation.kind === "table-rows-observed" && observation.source === "direct-read"
      ? observation.ticket.requestId
      : null,
  applied: status === "applied" ? ["table"] : [],
  suppressed: status === "suppressed" ? ["table"] : [],
  unresolvedRequiredFields: [],
});

function withRows(
  state: EntityTableState,
  entity: TableEntity,
  rows: ReadonlyMap<string, HeldRow<TableRow>>,
): EntityTableState {
  return { ...state, rows: { ...state.rows, [entity]: rows } };
}

export function reduceTableObservation(
  state: EntityTableState,
  admitted: AdmittedObservation,
): EntityTableReduction {
  const observation = admitted.input;
  if (
    observation.kind !== "table-rows-observed" &&
    observation.kind !== "table-membership-observed"
  )
    return { state, outcome: noOutcome() };
  const receipt = admitted.stamp.receiptOrdinal;

  if (observation.kind === "table-membership-observed") {
    const entity: TableEntity =
      observation.registration.descriptor.query.kind === "active-versions-of-organization"
        ? "app-version"
        : "user-data";
    if (observation.operation === "add") {
      if (!state.deleted.has(observation.id))
        return { state, outcome: outcomeOf(observation, "applied") };
      const deleted = new Map(state.deleted);
      deleted.delete(observation.id);
      return { state: { ...state, deleted }, outcome: outcomeOf(observation, "applied") };
    }
    const rows = new Map<string, HeldRow<TableRow>>(state.rows[entity]);
    rows.delete(observation.id);
    const deleted = new Map(state.deleted);
    deleted.set(observation.id, receipt);
    return {
      state: { ...withRows(state, entity, rows), deleted },
      outcome: outcomeOf(observation, "applied"),
    };
  }

  const entity = observation.entity;
  const rows = new Map<string, HeldRow<TableRow>>(state.rows[entity]);
  if (observation.source === "native-push") {
    const organizationId = observation.registration.descriptor.organization.organizationId;
    for (const row of observation.rows) {
      if (admits(entity, row)) rows.set(row.id, { row, asOf: receipt, organizationId });
      else rows.delete(row.id);
    }
    return { state: withRows(state, entity, rows), outcome: outcomeOf(observation, "applied") };
  }

  const ticket = observation.ticket;
  const descriptor = ticket.target.descriptor;
  const key = queryKeyOf(descriptor);
  const list = state.lists.get(key);
  if (list?.answered != null && list.answered.readStartOrdinal >= ticket.readStartOrdinal)
    return { state, outcome: outcomeOf(observation, "suppressed") };
  const startedAt = ticket.receiptOrdinalAtStart;
  const organizationId = descriptor.organization.organizationId;
  const answered = new Set(observation.rows.map((row) => row.id));
  for (const [id, held] of rows) {
    if (held.organizationId === organizationId && held.asOf <= startedAt && !answered.has(id))
      rows.delete(id);
  }
  for (const row of observation.rows) {
    if (!admits(entity, row)) continue;
    const deletedAt = state.deleted.get(row.id);
    if (deletedAt !== undefined && deletedAt > startedAt) continue;
    const held = rows.get(row.id);
    if (held !== undefined && held.asOf > startedAt) continue;
    rows.set(row.id, { row, asOf: startedAt, organizationId });
  }
  // A deletion older than this answer's start is in the answer already.
  const deleted = new Map([...state.deleted].filter(([, at]) => at > startedAt));
  const lists = new Map(state.lists);
  lists.set(key, {
    key,
    descriptor,
    answered: {
      coverage: observation.coverage,
      stamp: admitted.stamp,
      readStartOrdinal: ticket.readStartOrdinal,
    },
  });
  return {
    state: { ...withRows(state, entity, rows), lists, deleted },
    outcome: outcomeOf(observation, "applied"),
  };
}

/**
 * Lets go of lists nothing demands any more, and of the rows their organization's kind held: a
 * table no stream keeps current says nothing.
 */
export function releaseTableLists(
  state: EntityTableState,
  released: ReadonlySet<QueryKey>,
): EntityTableState {
  const gone = [...state.lists.values()].filter((list) => released.has(list.key));
  if (gone.length === 0) return state;
  const lists = new Map(state.lists);
  let next: EntityTableState = state;
  for (const list of gone) {
    lists.delete(list.key);
    const entity: TableEntity =
      list.descriptor.kind === "active-versions-of-organization" ? "app-version" : "user-data";
    const organizationId = list.descriptor.organization.organizationId;
    const kept = new Map<string, HeldRow<TableRow>>();
    for (const [id, held] of next.rows[entity] as ReadonlyMap<string, HeldRow<TableRow>>) {
      if (held.organizationId !== organizationId) kept.set(id, held);
    }
    next = withRows(next, entity, kept);
  }
  return { ...next, lists };
}

/** The organization's list of a kind has been answered: a row the table lacks is not there. */
function answered(state: EntityTableState, descriptor: TableQueryDescriptor): boolean {
  return state.lists.get(queryKeyOf(descriptor))?.answered?.coverage.kind === "exhausted-traversal";
}

export const activeVersionsDescriptor = (organization: OrganizationRef): TableQueryDescriptor => ({
  kind: "active-versions-of-organization",
  organization,
  schemaVersion: 1,
});

export const serviceVariablesDescriptor = (
  organization: OrganizationRef,
): TableQueryDescriptor => ({
  kind: "service-variables-of-organization",
  organization,
  keys: SERVICE_VARIABLE_KEYS,
  schemaVersion: 1,
});

/**
 * An active version of the organization: `known` once its list answered, with `row` `null` for a
 * version that is not active (or not the organization's).
 */
export function activeVersionOf(
  state: EntityTableState,
  organization: OrganizationRef,
  versionId: string,
): { readonly known: boolean; readonly row: AppVersionRow | null } {
  return {
    known: answered(state, activeVersionsDescriptor(organization)),
    row: state.rows["app-version"].get(versionId)?.row ?? null,
  };
}

/** Each service's variables the app reads, by service id: indexed once per table state. */
const variablesIndex = new WeakMap<
  ReadonlyMap<string, HeldRow<ServiceVariableRow>>,
  ReadonlyMap<string, ReadonlyMap<string, ServiceVariableRow>>
>();

function variablesByService(
  state: EntityTableState,
): ReadonlyMap<string, ReadonlyMap<string, ServiceVariableRow>> {
  const rows = state.rows["user-data"];
  const cached = variablesIndex.get(rows);
  if (cached !== undefined) return cached;
  const index = new Map<string, Map<string, ServiceVariableRow>>();
  for (const { row } of rows.values()) {
    if (row.serviceId === null) continue;
    let byKey = index.get(row.serviceId);
    if (byKey === undefined) {
      byKey = new Map();
      index.set(row.serviceId, byKey);
    }
    byKey.set(row.key, row);
  }
  variablesIndex.set(rows, index);
  return index;
}

/**
 * One of a service's variables the app reads: `known` once its organization's list answered and
 * the key is one the list holds, with `content` `null` for a variable the service does not have.
 */
export function serviceVariableOf(
  state: EntityTableState,
  organization: OrganizationRef,
  serviceId: string,
  key: string,
): { readonly known: boolean; readonly content: string | null } {
  return {
    known:
      SERVICE_VARIABLE_KEYS.includes(key) &&
      answered(state, serviceVariablesDescriptor(organization)),
    content: variablesByService(state).get(serviceId)?.get(key)?.content ?? null,
  };
}
