/**
 * The entity table: platform entities the account's socket streams by organization and the app
 * holds as the platform sends them, row for row (the legacy app's entity manager, `zef`). Each
 * kind is fed three ways:
 *
 * - its update stream (`updateStream`), whose frames carry whole rows, taken in place;
 * - its list's search (`listStream`'s registration answer, or a read), which states every row the
 *   list admits at the moment it ran;
 * - its list's membership frames, which carry bare ids and so prove nothing (S0.11): an id added
 *   or removed is read by id, batched, after a short grace (`tableRowsWanted`).
 *
 * Every row keeps the receipt it is as current as, and the wall time it came: an older answer
 * never overwrites a newer push, and a search never takes away a row pushed so recently its index
 * may not show it yet (`SEARCH_LAG_MS`) — that row is read by id instead. A row the platform
 * retired stays a tombstone until a search newer than it answers, so no older answer brings it
 * back. A list whose search has answered makes its organization's rows complete: a row it lacks
 * is not there.
 */
import type {
  AdmittedObservation,
  AppVersionRow,
  IngestionStamp,
  OrganizationRef,
  QueryCoverage,
  QueryKey,
  ReadStartOrdinal,
  ServiceVariableRow,
  TableEntity,
  TableObservation,
  TableQueryDescriptor,
  TableRow,
  TableRowsOf,
} from "./types.ts";
import { organizationKeyOf, queryKeyOf, tableEntityOf } from "./types.ts";
import { noOutcome, type DomainObservationOutcome } from "./inventory.ts";

/** The service variables the app reads: the Mate flag, and the deploy a service last started. */
export const SERVICE_VARIABLE_KEYS: ReadonlyArray<string> = [
  "ZCP_MATE_ENABLED",
  "appVersionId",
  "appVersionName",
];

/** How far a search's index may trail a push: a row pushed this soon before it is kept. */
export const SEARCH_LAG_MS = 10_000;

/**
 * How long a retired row is remembered against an answer that began before it: longer than any
 * read may take, so a tombstone this old outlives every read that could still bring it back.
 */
export const TOMBSTONE_MS = 120_000;

interface HeldRow<Row> {
  /** `null`: the platform retired it (a tombstone). */
  readonly row: Row | null;
  /** The receipt the row is as current as: its push's, or the start of the read that said it. */
  readonly asOf: number;
  /** When it came, on the wall clock: a search started this long after it shows it. */
  readonly atMs: number;
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

/** An id a row is owed for: its list's frame named it, or a search could not confirm it. */
interface WantedRow {
  readonly entity: TableEntity;
  readonly organization: OrganizationRef;
  readonly id: string;
  /** The receipt that asked: a read that began before it answers nothing about it. */
  readonly since: number;
}

export interface EntityTableState {
  readonly rows: {
    readonly [Entity in TableEntity]: ReadonlyMap<string, HeldRow<TableRowsOf[Entity]>>;
  };
  readonly lists: ReadonlyMap<QueryKey, TableListState>;
  readonly wanted: ReadonlyMap<string, WantedRow>;
}

export interface EntityTableReduction {
  readonly state: EntityTableState;
  readonly outcome: DomainObservationOutcome;
}

export const makeInitialEntityTableState = (): EntityTableState => ({
  rows: { "app-version": new Map(), "user-data": new Map() },
  lists: new Map(),
  wanted: new Map(),
});

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

/** The one list each organization holds of a kind. */
const listDescriptorOf = (entity: TableEntity, organization: OrganizationRef) =>
  entity === "app-version"
    ? activeVersionsDescriptor(organization)
    : serviceVariablesDescriptor(organization);

/** Whether a kind holds this row at all: an active version, a variable the app reads. */
function admits(entity: TableEntity, row: TableRow): boolean {
  return entity === "app-version"
    ? (row as AppVersionRow).status === "ACTIVE"
    : SERVICE_VARIABLE_KEYS.includes((row as ServiceVariableRow).key);
}

const wantedKey = (entity: TableEntity, id: string) => `${entity}:${id}`;

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

type Rows = Map<string, HeldRow<TableRow>>;

const rowsOf = (state: EntityTableState, entity: TableEntity): Rows =>
  new Map(state.rows[entity] as ReadonlyMap<string, HeldRow<TableRow>>);

const withRows = (state: EntityTableState, entity: TableEntity, rows: Rows): EntityTableState => ({
  ...state,
  rows: { ...state.rows, [entity]: rows },
});

/** The organization's list of a kind, held from its first frame so a release finds it. */
function withList(state: EntityTableState, descriptor: TableQueryDescriptor): EntityTableState {
  const key = queryKeyOf(descriptor);
  if (state.lists.has(key)) return state;
  const lists = new Map(state.lists);
  lists.set(key, { key, descriptor, answered: null });
  return { ...state, lists };
}

export function reduceTableObservation(
  initial: EntityTableState,
  admitted: AdmittedObservation,
): EntityTableReduction {
  const observation = admitted.input;
  if (
    observation.kind !== "table-rows-observed" &&
    observation.kind !== "table-membership-observed"
  )
    return { state: initial, outcome: noOutcome() };
  const receipt = admitted.stamp.receiptOrdinal;
  const atMs = admitted.stamp.observedAtMs;

  // A list's frame names an id, nothing more: it is read by id, and the row stands meanwhile.
  if (observation.kind === "table-membership-observed") {
    const descriptor = observation.registration.descriptor.query;
    const entity = tableEntityOf(descriptor);
    const state = withList(initial, descriptor);
    const held = state.rows[entity].get(observation.id);
    // An id added whose row a push already brought is proven by that push.
    if (observation.operation === "add" && held?.row != null)
      return { state, outcome: outcomeOf(observation, "applied") };
    const wanted = new Map(state.wanted);
    wanted.set(wantedKey(entity, observation.id), {
      entity,
      organization: descriptor.organization,
      id: observation.id,
      since: receipt,
    });
    return { state: { ...state, wanted }, outcome: outcomeOf(observation, "applied") };
  }

  const entity = observation.entity;
  if (observation.source === "native-push") {
    const organization = observation.registration.descriptor.organization;
    const state = withList(initial, listDescriptorOf(entity, organization));
    const rows = rowsOf(state, entity);
    const wanted = new Map(state.wanted);
    for (const row of observation.rows) {
      // A variable the app does not read is none of the table's business, ever.
      if (entity === "user-data" && !admits(entity, row) && !rows.has(row.id)) continue;
      rows.set(row.id, {
        row: admits(entity, row) ? row : null,
        asOf: receipt,
        atMs,
        organizationId: organization.organizationId,
      });
      wanted.delete(wantedKey(entity, row.id));
    }
    for (const [id, held] of rows) {
      if (held.row === null && held.atMs < atMs - TOMBSTONE_MS) rows.delete(id);
    }
    return {
      state: { ...withRows(state, entity, rows), wanted },
      outcome: outcomeOf(observation, "applied"),
    };
  }

  const ticket = observation.ticket;
  const descriptor = ticket.target.descriptor;
  const startedAt = ticket.receiptOrdinalAtStart;
  const organizationId = descriptor.organization.organizationId;
  const listDescriptor = listDescriptorOf(entity, descriptor.organization);
  const key = queryKeyOf(listDescriptor);
  const state = withList(initial, listDescriptor);
  const rows = rowsOf(state, entity);
  const wanted = new Map(state.wanted);
  const said = new Map(observation.rows.map((row) => [row.id, row] as const));
  /** Sets what the read said of one id, unless something newer than the read already did. */
  const settle = (id: string, row: TableRow | null) => {
    const held = rows.get(id);
    if (held !== undefined && held.asOf > startedAt) return;
    if (row === null && held === undefined) return;
    rows.set(id, {
      row: row !== null && admits(entity, row) ? row : null,
      asOf: startedAt,
      atMs: ticket.startedAtMs,
      organizationId,
    });
  };

  // A read of named ids: settles those ids, and stops asking for them.
  if (descriptor.ids !== undefined) {
    for (const id of descriptor.ids) {
      settle(id, said.get(id) ?? null);
      const owed = wanted.get(wantedKey(entity, id));
      if (owed !== undefined && owed.since <= startedAt) wanted.delete(wantedKey(entity, id));
    }
    return {
      state: { ...withRows(state, entity, rows), wanted },
      outcome: outcomeOf(observation, "applied"),
    };
  }

  // The list's whole search.
  const list = state.lists.get(key);
  if (list?.answered != null && list.answered.readStartOrdinal >= ticket.readStartOrdinal)
    return { state: initial, outcome: outcomeOf(observation, "suppressed") };
  for (const [id, held] of rows) {
    if (held.organizationId !== organizationId || said.has(id) || held.asOf > startedAt) continue;
    if (held.row === null) {
      // A tombstone the answer agrees with: nothing older can bring it back now.
      rows.delete(id);
      continue;
    }
    // Pushed so recently the index may not show it yet: kept, and read by id.
    if (held.atMs > ticket.startedAtMs - SEARCH_LAG_MS) {
      if (!wanted.has(wantedKey(entity, id)))
        wanted.set(wantedKey(entity, id), {
          entity,
          organization: descriptor.organization,
          id,
          since: startedAt,
        });
      continue;
    }
    rows.delete(id);
  }
  for (const row of observation.rows) settle(row.id, row);
  for (const [entryKey, owed] of wanted) {
    if (owed.entity === entity && said.has(owed.id) && owed.since <= startedAt)
      wanted.delete(entryKey);
  }
  const lists = new Map(state.lists);
  lists.set(key, {
    key,
    descriptor: listDescriptor,
    answered: {
      coverage: observation.coverage,
      stamp: admitted.stamp,
      readStartOrdinal: ticket.readStartOrdinal,
    },
  });
  return {
    state: { ...withRows(state, entity, rows), lists, wanted },
    outcome: outcomeOf(observation, "applied"),
  };
}

/**
 * Lets go of lists nothing demands any more, and of every row and wanted id of their
 * organization's kind: a table no stream keeps current says nothing.
 */
export function releaseTableLists(
  state: EntityTableState,
  released: ReadonlySet<QueryKey>,
): EntityTableState {
  const gone = [...state.lists.values()].filter((list) => released.has(list.key));
  if (gone.length === 0) return state;
  const lists = new Map(state.lists);
  let next: EntityTableState = state;
  const wanted = new Map(state.wanted);
  for (const list of gone) {
    lists.delete(list.key);
    const entity = tableEntityOf(list.descriptor);
    const organization = organizationKeyOf(list.descriptor.organization);
    const organizationId = list.descriptor.organization.organizationId;
    const kept: Rows = new Map();
    for (const [id, held] of rowsOf(next, entity)) {
      if (held.organizationId !== organizationId) kept.set(id, held);
    }
    next = withRows(next, entity, kept);
    for (const [entryKey, owed] of wanted) {
      if (owed.entity === entity && organizationKeyOf(owed.organization) === organization)
        wanted.delete(entryKey);
    }
  }
  return { ...next, lists, wanted };
}

/** Asks for rows the table is owed and does not hold (a service runs a version it lacks). */
export function wantTableRows(
  state: EntityTableState,
  entity: TableEntity,
  organization: OrganizationRef,
  ids: ReadonlyArray<string>,
  since: number,
): EntityTableState {
  const missing = ids.filter(
    (id) => state.rows[entity].get(id) === undefined && !state.wanted.has(wantedKey(entity, id)),
  );
  if (missing.length === 0) return state;
  const wanted = new Map(state.wanted);
  for (const id of missing) wanted.set(wantedKey(entity, id), { entity, organization, id, since });
  return { ...state, wanted };
}

/** The ids each organization's kind is owed a read of, batched. */
export function tableRowsWanted(state: EntityTableState): ReadonlyArray<{
  readonly entity: TableEntity;
  readonly organization: OrganizationRef;
  readonly ids: ReadonlyArray<string>;
}> {
  const batches = new Map<
    string,
    { entity: TableEntity; organization: OrganizationRef; ids: string[] }
  >();
  for (const owed of state.wanted.values()) {
    const key = `${owed.entity}:${organizationKeyOf(owed.organization)}`;
    const batch = batches.get(key) ?? {
      entity: owed.entity,
      organization: owed.organization,
      ids: [],
    };
    batch.ids.push(owed.id);
    batches.set(key, batch);
  }
  return [...batches.values()];
}

/** The organization's list of a kind has answered in full: a row the table lacks is not there. */
function answered(state: EntityTableState, descriptor: TableQueryDescriptor): boolean {
  return state.lists.get(queryKeyOf(descriptor))?.answered?.coverage.kind === "exhausted-traversal";
}

/**
 * An active version of the organization: `known` once its list answered, with `row` `null` for a
 * version that is not active (or not the organization's).
 */
export function activeVersionOf(
  state: EntityTableState,
  organization: OrganizationRef,
  versionId: string,
): { readonly known: boolean; readonly row: AppVersionRow | null } {
  const held = state.rows["app-version"].get(versionId);
  return {
    known: answered(state, activeVersionsDescriptor(organization)),
    row: held?.organizationId === organization.organizationId ? held.row : null,
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
    if (row === null || row.serviceId === null) continue;
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

/** Whether the organization's variables list has answered in full. */
export function serviceVariablesAnswered(
  state: EntityTableState,
  organization: OrganizationRef,
): boolean {
  return answered(state, serviceVariablesDescriptor(organization));
}
