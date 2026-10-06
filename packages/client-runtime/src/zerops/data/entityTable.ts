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
import { organizationKeyOf, queryKeyOf } from "./types.ts";
import { noOutcome, type DomainObservationOutcome } from "./inventory.ts";

/**
 * The service variables the app reads: the Mate flag, the deploy a service last started, and the
 * new press's marker on a Mate's container (`MATE_SETUP_RUNTIMES`), whose presence alone is read.
 */
export const SERVICE_VARIABLE_KEYS: ReadonlyArray<string> = [
  "ZCP_MATE_ENABLED",
  "appVersionId",
  "appVersionName",
  "MATE_SETUP_RUNTIMES",
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
  /** A push (or a list's final removal) is newer than any index for `SEARCH_LAG_MS`. */
  readonly source: "push" | "read";
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
  readonly serviceIds: ReadonlyArray<string>;
  readonly id: string;
  /** The receipt that asked: a read that began before it answers nothing about it. */
  readonly since: number;
  /** When it may be read: past the index's lag, or past its back-off once found absent. */
  readonly dueAtMs: number;
  /** How often a read found it absent though the table is owed it (`ABSENT_BACKOFF_MS`). */
  readonly absent: number;
  /** When it was first owed: a read before `SEARCH_LAG_MS` past it may not show it yet. */
  readonly firstAtMs: number;
}

/**
 * How long a row the table is owed and a read found absent waits before it is asked about
 * again: 30 s, then 2 min, then every 10 min. It never loops, and it reads unknown meanwhile.
 */
export const ABSENT_BACKOFF_MS: ReadonlyArray<number> = [30_000, 120_000, 600_000];

/** How long a failed read by id waits before the rows it asked about are asked again. */
export const TABLE_READ_RETRY_MS = 30_000;

export interface EntityTableState {
  readonly rows: {
    readonly [Entity in TableEntity]: ReadonlyMap<string, HeldRow<TableRowsOf[Entity]>>;
  };
  readonly lists: ReadonlyMap<QueryKey, TableListState>;
  readonly wanted: ReadonlyMap<string, WantedRow>;
  /**
   * When each service last moved to the version it runs, by service id: the receipt its push
   * first named that version at. Variables heard before it may trail it (`deployedVersion.ts`).
   */
  readonly moves: ReadonlyMap<string, { readonly deployId: string; readonly asOf: number }>;
}

export interface EntityTableReduction {
  readonly state: EntityTableState;
  readonly outcome: DomainObservationOutcome;
}

export const makeInitialEntityTableState = (): EntityTableState => ({
  rows: { "user-data": new Map() },
  lists: new Map(),
  wanted: new Map(),
  moves: new Map(),
});

export const serviceVariablesDescriptor = (
  organization: OrganizationRef,
  serviceIds: ReadonlyArray<string>,
): TableQueryDescriptor => ({
  kind: "service-variables-of-services",
  organization,
  serviceIds,
  keys: SERVICE_VARIABLE_KEYS,
  schemaVersion: 1,
});

/** Whether the table holds this row at all: a variable the app reads. */
const admits = (row: TableRow): boolean => SERVICE_VARIABLE_KEYS.includes(row.key);

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

/** Whether two states of a row say the same: a tombstone, or every field alike. */
const sameRow = (left: TableRow | null, right: TableRow | null): boolean => {
  if (left === null || right === null) return left === right;
  const a = left as unknown as Record<string, unknown>;
  const b = right as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
};

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
    const entity = "user-data";
    const state = withList(initial, descriptor);
    const held = state.rows[entity].get(observation.id);
    // An id added whose row a push already brought is proven by that push.
    if (observation.operation === "add" && held?.row != null)
      return { state, outcome: outcomeOf(observation, "applied") };
    const wanted = new Map(state.wanted);
    // A variable's removal is final: only a newer push brings it back.
    if (observation.operation === "remove") {
      wanted.delete(wantedKey(entity, observation.id));
      if (held === undefined)
        return { state: { ...state, wanted }, outcome: outcomeOf(observation, "applied") };
      const rows = rowsOf(state, entity);
      rows.set(observation.id, { ...held, row: null, asOf: receipt, atMs, source: "push" });
      return {
        state: { ...withRows(state, entity, rows), wanted },
        outcome: outcomeOf(observation, "applied"),
      };
    }
    wanted.set(wantedKey(entity, observation.id), {
      entity,
      organization: descriptor.organization,
      serviceIds: descriptor.serviceIds,
      id: observation.id,
      since: receipt,
      dueAtMs: atMs,
      absent: 0,
      firstAtMs: wanted.get(wantedKey(entity, observation.id))?.firstAtMs ?? atMs,
    });
    return { state: { ...state, wanted }, outcome: outcomeOf(observation, "applied") };
  }

  const entity = observation.entity;
  if (observation.source === "native-push") {
    const organization = observation.registration.descriptor.organization;
    const state = withList(
      initial,
      serviceVariablesDescriptor(organization, observation.registration.descriptor.serviceIds),
    );
    const rows = rowsOf(state, entity);
    const wanted = new Map(state.wanted);
    for (const row of observation.rows) {
      // A variable the app does not read is none of the table's business, ever.
      if (!admits(row) && !rows.has(row.id)) continue;
      rows.set(row.id, {
        row: admits(row) ? row : null,
        asOf: receipt,
        atMs,
        source: "push",
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
  const listDescriptor = serviceVariablesDescriptor(descriptor.organization, descriptor.serviceIds);
  const key = queryKeyOf(listDescriptor);
  const state = withList(initial, listDescriptor);
  const rows = rowsOf(state, entity);
  const wanted = new Map(state.wanted);
  const said = new Map(observation.rows.map((row) => [row.id, row] as const));
  const startMs = ticket.startedAtMs;
  /** One more look at a row a push stated too recently for the index to agree yet. */
  const lookAgain = (id: string, held: HeldRow<TableRow>) => {
    const owed = wanted.get(wantedKey(entity, id));
    wanted.set(wantedKey(entity, id), {
      entity,
      organization: descriptor.organization,
      serviceIds: owed?.serviceIds ?? descriptor.serviceIds,
      id,
      since: startedAt,
      dueAtMs: Math.max(owed?.dueAtMs ?? 0, held.atMs + SEARCH_LAG_MS),
      absent: owed?.absent ?? 0,
      firstAtMs: owed?.firstAtMs ?? atMs,
    });
  };
  /**
   * Sets what the read said of one id (`null`: absent), unless something newer than the read
   * did: a push after it began, or one so recent before it that the index may not show it yet.
   */
  const settle = (id: string, answer: TableRow | null) => {
    const held = rows.get(id);
    const admitted = answer !== null && admits(answer) ? answer : null;
    if (held !== undefined && held.asOf > startedAt) return;
    if (held === undefined && admitted === null) return;
    // A push the index may not show yet keeps its content, whatever the answer says of it.
    if (held !== undefined && held.source === "push" && held.atMs > startMs - SEARCH_LAG_MS) {
      if (!sameRow(held.row, admitted)) lookAgain(id, held);
      return;
    }
    rows.set(id, { row: admitted, asOf: startedAt, atMs: startMs, source: "read", organizationId });
    // An id asked for after the read began is something the read cannot answer.
    if ((wanted.get(wantedKey(entity, id))?.since ?? 0) <= startedAt)
      wanted.delete(wantedKey(entity, id));
  };

  // A read of named ids: settles those ids. One the table is owed and the read found absent is
  // asked about again on a widening back-off, never at once.
  if (descriptor.ids !== undefined) {
    for (const id of descriptor.ids) {
      const owed = wanted.get(wantedKey(entity, id));
      if (owed !== undefined && owed.since > startedAt) continue;
      const answer = said.get(id) ?? null;
      if (answer === null && rows.get(id) === undefined) {
        if (owed === undefined) continue;
        // Too soon after it was first owed for the index to show it: one more look, not absent.
        if (startMs < owed.firstAtMs + SEARCH_LAG_MS) {
          wanted.set(wantedKey(entity, id), { ...owed, dueAtMs: owed.firstAtMs + SEARCH_LAG_MS });
          continue;
        }
        wanted.set(wantedKey(entity, id), {
          ...owed,
          dueAtMs: atMs + ABSENT_BACKOFF_MS[Math.min(owed.absent, ABSENT_BACKOFF_MS.length - 1)]!,
          absent: owed.absent + 1,
        });
        continue;
      }
      settle(id, answer);
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
    if (
      held.organizationId !== organizationId ||
      (held.row !== null &&
        (held.row.serviceId === null || !descriptor.serviceIds.includes(held.row.serviceId))) ||
      said.has(id) ||
      held.asOf > startedAt
    )
      continue;
    if (held.row === null) {
      // A tombstone the answer agrees with: nothing older can bring it back now.
      rows.delete(id);
      continue;
    }
    if (held.source === "push" && held.atMs > startMs - SEARCH_LAG_MS) {
      lookAgain(id, held);
      continue;
    }
    rows.delete(id);
  }
  for (const row of observation.rows) settle(row.id, row);
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
    const entity = "user-data";
    const organization = organizationKeyOf(list.descriptor.organization);
    const organizationId = list.descriptor.organization.organizationId;
    const kept: Rows = new Map();
    for (const [id, held] of rowsOf(next, entity)) {
      const remains = [...lists.values()].some(
        (remaining) =>
          !released.has(remaining.key) &&
          remaining.descriptor.organization.organizationId === organizationId &&
          (held.row === null ||
            (held.row.serviceId !== null &&
              remaining.descriptor.serviceIds.includes(held.row.serviceId))),
      );
      const belongs =
        held.row === null ||
        (held.row.serviceId !== null && list.descriptor.serviceIds.includes(held.row.serviceId));
      if (held.organizationId !== organizationId || !belongs || remains) kept.set(id, held);
    }
    next = withRows(next, entity, kept);
    for (const [entryKey, owed] of wanted) {
      if (
        owed.entity === entity &&
        organizationKeyOf(owed.organization) === organization &&
        ![...lists.values()].some(
          (remaining) =>
            !released.has(remaining.key) &&
            organizationKeyOf(remaining.descriptor.organization) === organization,
        )
      )
        wanted.delete(entryKey);
    }
  }
  return { ...next, lists, wanted };
}

/**
 * Asks again for rows the table holds that may trail what they describe: a service's variables
 * heard before it moved to another version. One already asked about waits out its own read.
 */
export function rereadTableRows(
  state: EntityTableState,
  entity: TableEntity,
  organization: OrganizationRef,
  ids: ReadonlyArray<string>,
  since: number,
  nowMs: number,
  serviceIds: ReadonlyArray<string>,
): EntityTableState {
  return want(
    state,
    entity,
    organization,
    ids.filter((id) => state.rows[entity].get(id) !== undefined),
    since,
    nowMs,
    serviceIds,
  );
}

function want(
  state: EntityTableState,
  entity: TableEntity,
  organization: OrganizationRef,
  ids: ReadonlyArray<string>,
  since: number,
  nowMs: number,
  serviceIds: ReadonlyArray<string>,
): EntityTableState {
  const asked = ids.filter((id) => !state.wanted.has(wantedKey(entity, id)));
  if (asked.length === 0) return state;
  const wanted = new Map(state.wanted);
  for (const id of asked)
    wanted.set(wantedKey(entity, id), {
      entity,
      organization,
      serviceIds,
      id,
      since,
      dueAtMs: nowMs,
      absent: 0,
      firstAtMs: nowMs,
    });
  return { ...state, wanted };
}

/** The ids each organization's kind is owed a read of, batched, with the earliest one due. */
export function tableRowsWanted(state: EntityTableState): ReadonlyArray<{
  readonly entity: TableEntity;
  readonly organization: OrganizationRef;
  readonly ids: ReadonlyArray<string>;
  readonly dueAtMs: number;
}> {
  const batches = new Map<
    string,
    { entity: TableEntity; organization: OrganizationRef; ids: string[]; dueAtMs: number }
  >();
  for (const owed of state.wanted.values()) {
    const key = `${owed.entity}:${organizationKeyOf(owed.organization)}`;
    const batch = batches.get(key) ?? {
      entity: owed.entity,
      organization: owed.organization,
      ids: [],
      dueAtMs: owed.dueAtMs,
    };
    batch.ids.push(owed.id);
    batch.dueAtMs = Math.min(batch.dueAtMs, owed.dueAtMs);
    batches.set(key, batch);
  }
  return [...batches.values()];
}

/** The ids of one organization's kind that may be read now. */
export function tableRowsDue(
  state: EntityTableState,
  entity: TableEntity,
  organization: OrganizationRef,
  nowMs: number,
  serviceIds: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const key = organizationKeyOf(organization);
  return [...state.wanted.values()].flatMap((owed) =>
    owed.entity === entity &&
    organizationKeyOf(owed.organization) === key &&
    owed.dueAtMs <= nowMs &&
    owed.serviceIds.some((id) => serviceIds.includes(id))
      ? [owed.id]
      : [],
  );
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

/** The organization's variables list has answered in full: a row the table lacks is not there. */
function answered(
  state: EntityTableState,
  organization: OrganizationRef,
  serviceId: string,
): boolean {
  return [...state.lists.values()].some(
    (list) =>
      organizationKeyOf(list.descriptor.organization) === organizationKeyOf(organization) &&
      list.descriptor.serviceIds.includes(serviceId) &&
      list.answered?.coverage.kind === "exhausted-traversal",
  );
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
    known: SERVICE_VARIABLE_KEYS.includes(key) && answered(state, organization, serviceId),
    content: variablesByService(state).get(serviceId)?.get(key)?.content ?? null,
  };
}

/**
 * One of a service's variables as the table heard it: its row's id and the receipt it is as
 * current as; `null` for a variable the table holds none of.
 */
export function serviceVariableHeard(
  state: EntityTableState,
  serviceId: string,
  key: string,
): { readonly id: string; readonly asOf: number } | null {
  const row = variablesByService(state).get(serviceId)?.get(key);
  const asOf = row === undefined ? null : rowHeard(state, "user-data", row.id);
  return row === undefined || asOf === null ? null : { id: row.id, asOf };
}

/** The receipt a row the table holds is as current as; `null` for one it holds none of. */
export function rowHeard(state: EntityTableState, entity: TableEntity, id: string): number | null {
  const held = state.rows[entity].get(id);
  return held?.row == null ? null : held.asOf;
}

/**
 * Whether the organization's variables list delivered any variable of this service the app reads,
 * and when that list last answered (`null` before it did).
 */
export function serviceVariablesDelivered(
  state: EntityTableState,
  organization: OrganizationRef,
  serviceId: string,
): { readonly any: boolean; readonly answeredAtMs: number | null } {
  return {
    any: (variablesByService(state).get(serviceId)?.size ?? 0) > 0,
    answeredAtMs:
      [...state.lists.values()].find(
        (list) =>
          organizationKeyOf(list.descriptor.organization) === organizationKeyOf(organization) &&
          list.descriptor.serviceIds.includes(serviceId),
      )?.answered?.stamp.observedAtMs ?? null,
  };
}

/** A manual action asks about absent rows in its service scope now, past their back-off. */
export function retryAbsentTableRows(
  state: EntityTableState,
  organization: OrganizationRef,
  serviceIds: ReadonlyArray<string>,
  nowMs: number,
): EntityTableState {
  const wanted = new Map(state.wanted);
  let changed = false;
  for (const [key, owed] of wanted) {
    if (
      owed.absent === 0 ||
      organizationKeyOf(owed.organization) !== organizationKeyOf(organization) ||
      !owed.serviceIds.some((id) => serviceIds.includes(id))
    )
      continue;
    wanted.set(key, { ...owed, absent: 0, dueAtMs: nowMs });
    changed = true;
  }
  return changed ? { ...state, wanted } : state;
}

/**
 * A read by id that failed: the rows it asked about, still owed and asked nothing newer since, wait
 * `TABLE_READ_RETRY_MS` before the next batch asks again, never a loop.
 */
export function deferFailedTableRowRead(
  state: EntityTableState,
  entity: TableEntity,
  organization: OrganizationRef,
  ids: ReadonlyArray<string>,
  startedAtReceipt: number,
  atMs: number,
): EntityTableState {
  const wanted = new Map(state.wanted);
  let changed = false;
  for (const id of ids) {
    const key = wantedKey(entity, id);
    const owed = wanted.get(key);
    if (
      owed === undefined ||
      owed.since > startedAtReceipt ||
      organizationKeyOf(owed.organization) !== organizationKeyOf(organization)
    )
      continue;
    wanted.set(key, { ...owed, dueAtMs: Math.max(owed.dueAtMs, atMs + TABLE_READ_RETRY_MS) });
    changed = true;
  }
  return changed ? { ...state, wanted } : state;
}
