import { describe, expect, it } from "@effect/vitest";

import {
  makeInitialEntityTableState,
  reduceTableObservation,
  releaseTableLists,
  retryAbsentTableRows,
  SEARCH_LAG_MS,
  serviceVariableOf,
  TOMBSTONE_MS,
  serviceVariablesDescriptor,
  tableRowsWanted,
  ABSENT_BACKOFF_MS,
  deferFailedTableRowRead,
  TABLE_READ_RETRY_MS,
  tableRowsDue,
  type EntityTableState,
} from "./entityTable.ts";
import type {
  OrganizationRef,
  QueryCoverage,
  RegistrationRequest,
  ServiceVariableRow,
  TableObservation,
  TableQueryDescriptor,
} from "./types.ts";
import {
  DispatchOrdinal,
  ReadStartOrdinal,
  ReceiptOrdinal,
  ZeropsOrganizationId,
  ZeropsRequestId,
  ZeropsWireSubscriptionName,
  queryKeyOf,
} from "./types.ts";
import { identity, organization } from "./__fixtures__/index.ts";

const other: OrganizationRef = {
  ...organization,
  organizationId: ZeropsOrganizationId.make("org-other"),
};
const variables = serviceVariablesDescriptor(organization, [
  "s-1",
  "s-2",
  "s-3",
  "service",
  "service-a",
  "app",
  "mate",
]);
const complete: QueryCoverage = {
  kind: "exhausted-traversal",
  traversedPages: 1,
  observedTotal: null,
  guarantee: "non-atomic",
};

const variable = (
  id: string,
  serviceId: string,
  key: string,
  content: string | null,
): ServiceVariableRow => ({ id, serviceId, projectId: "project-1", key, content });

/** A search answer that began at receipt `start`, at wall time `startMs`. */
const answered = (
  descriptor: TableQueryDescriptor,
  rows: ReadonlyArray<ServiceVariableRow>,
  start: number,
  startMs = start,
): TableObservation => ({
  kind: "table-rows-observed",
  entity: "user-data",
  rows,
  source: "direct-read",
  coverage: complete,
  ticket: {
    kind: "baseline",
    requestId: ZeropsRequestId.make(`read-${start}`),
    owner: { kind: "interest", identity: identity() },
    target: { kind: "query", descriptor },
    receiptOrdinalAtStart: ReceiptOrdinal.make(start),
    membershipReceiptOrdinalAtStart: ReceiptOrdinal.make(start),
    readStartOrdinal: ReadStartOrdinal.make(start),
    dispatchOrdinal: DispatchOrdinal.make(start),
    startedAtMs: startMs,
  } as never,
});
const pushed = (
  rows: ReadonlyArray<ServiceVariableRow>,
  owner: OrganizationRef = organization,
): TableObservation => ({
  kind: "table-rows-observed",
  entity: "user-data",
  rows,
  source: "native-push",
  registration: {
    identity: identity(),
    subscriptionName: ZeropsWireSubscriptionName.make("wire-user-data-updates"),
    descriptor: {
      kind: "table-updates",
      entity: "user-data",
      organization: owner,
      serviceIds: ["s-1", "s-2", "s-3", "service", "service-a", "app", "mate"],
    },
    baselineTicket: null,
  } as unknown as RegistrationRequest & { readonly descriptor: { readonly kind: "table-updates" } },
});
const membership = (
  descriptor: TableQueryDescriptor,
  operation: "add" | "remove",
  id: string,
): TableObservation => ({
  kind: "table-membership-observed",
  operation,
  id,
  registration: {
    identity: identity(),
    subscriptionName: ZeropsWireSubscriptionName.make("wire-list"),
    descriptor: { kind: "table-list", query: descriptor },
    baselineTicket: null,
  } as unknown as RegistrationRequest & { readonly descriptor: { readonly kind: "table-list" } },
});

/** Each step is admitted at its receipt `at`, at wall time `ms` (default `at`). */
type Step = readonly [at: number, observation: TableObservation, ms?: number];
const run = (
  steps: ReadonlyArray<Step>,
  initial: EntityTableState = makeInitialEntityTableState(),
): EntityTableState =>
  steps.reduce(
    (state, [at, input, ms]) =>
      reduceTableObservation(state, {
        stamp: { receiptOrdinal: ReceiptOrdinal.make(at), observedAtMs: ms ?? at },
        accessEvidence: null,
        input,
      }).state,
    initial,
  );

/** A variable the app reads, of service `s-1`, by its row id. */
const flag = (id: string, content = "1") => variable(id, "s-1", "ZCP_MATE_ENABLED", content);
/** What the table holds of a row: its content, `null` for a tombstone, `undefined` for none. */
const contentOf = (state: EntityTableState, id: string) => {
  const held = state.rows["user-data"].get(id);
  return held === undefined ? undefined : (held.row?.content ?? null);
};

describe("the entity table's lists", () => {
  it("keeps another organization's rows when one organization's search answers", () => {
    const state = run([
      [
        2,
        answered(
          serviceVariablesDescriptor(other, [
            "s-1",
            "s-2",
            "s-3",
            "service",
            "service-a",
            "app",
            "mate",
          ]),
          [flag("u-9")],
          1,
        ),
      ],
      [4, answered(variables, [], 3, 10_000_000)],
    ]);
    expect(contentOf(state, "u-9")).toBe("1");
  });

  it("forgets a removed row once no read could still bring it back", () => {
    const state = run([
      [2, answered(variables, [flag("u-1")], 1)],
      [3, membership(variables, "remove", "u-1"), 1_000],
      [4, pushed([flag("u-2")]), 1_000 + TOMBSTONE_MS + 1],
    ]);
    expect([...state.rows["user-data"].keys()]).toEqual(["u-2"]);
  });

  it("settles a row it asked about by the read of it, and stops asking", () => {
    const byId = { ...variables, ids: ["u-1"] } as TableQueryDescriptor;
    const state = run([
      [2, answered(variables, [], 1, 1_000), 1_000],
      [3, membership(variables, "add", "u-1"), 2_000],
      [6, answered(byId, [flag("u-1")], 5, 1_000 + SEARCH_LAG_MS + 1), 20_000],
    ]);
    expect(contentOf(state, "u-1")).toBe("1");
    expect(tableRowsWanted(state)).toEqual([]);
  });

  it("forgets a list nothing demands any more, every row it kept and every row it waits on", () => {
    const state = run([
      [2, pushed([flag("u-0")])],
      [3, answered(variables, [flag("u-1")], 2)],
      [4, membership(variables, "add", "u-2")],
    ]);
    const released = releaseTableLists(state, new Set([queryKeyOf(variables)]));
    expect(serviceVariableOf(released, organization, "s-1", "ZCP_MATE_ENABLED")).toEqual({
      known: false,
      content: null,
    });
    expect(released.rows["user-data"].size).toBe(0);
    expect(tableRowsWanted(released)).toEqual([]);
  });

  it("forgets a list that never answered, and the rows pushed for it", () => {
    const state = run([[2, pushed([flag("u-0")])]]);
    const released = releaseTableLists(state, new Set([queryKeyOf(variables)]));
    expect(released.rows["user-data"].size).toBe(0);
  });

  it("knows no list whose search answered only a window of it", () => {
    const partial = answered(variables, [flag("u-1")], 1);
    const state = run([
      [
        2,
        {
          ...partial,
          coverage: {
            kind: "partial-window",
            offset: 0,
            limit: 1,
            traversedPages: 1,
            observedTotal: 5,
          },
        } as TableObservation,
      ],
    ]);
    expect(serviceVariableOf(state, organization, "s-1", "appVersionId").known).toBe(false);
  });
});

describe("the entity table's service variables", () => {
  it("holds only the variables the app reads, by service", () => {
    const state = run([
      [
        2,
        answered(
          variables,
          [
            variable("u-1", "s-1", "ZCP_MATE_ENABLED", "1"),
            variable("u-2", "s-1", "appVersionId", "v-1"),
          ],
          1,
        ),
      ],
      [3, pushed([variable("u-3", "s-2", "SOME_SECRET", "x")])],
      [4, pushed([variable("u-4", "s-2", "ZCP_MATE_ENABLED", "0")])],
    ]);
    expect(serviceVariableOf(state, organization, "s-1", "ZCP_MATE_ENABLED")).toEqual({
      known: true,
      content: "1",
    });
    expect(serviceVariableOf(state, organization, "s-2", "ZCP_MATE_ENABLED")).toEqual({
      known: true,
      content: "0",
    });
    expect(serviceVariableOf(state, organization, "s-2", "SOME_SECRET")).toEqual({
      known: false,
      content: null,
    });
    expect(serviceVariableOf(state, organization, "s-3", "ZCP_MATE_ENABLED")).toEqual({
      known: true,
      content: null,
    });
    expect(state.rows["user-data"].has("u-3")).toBe(false);
  });

  it("takes a variable's list removal as final, and only a newer push brings it back", () => {
    const removed = run([
      [2, answered(variables, [variable("u-1", "s-1", "ZCP_MATE_ENABLED", "1")], 1)],
      [3, membership(variables, "remove", "u-1")],
    ]);
    expect(serviceVariableOf(removed, organization, "s-1", "ZCP_MATE_ENABLED").content).toBe(null);
    expect(tableRowsWanted(removed)).toEqual([]);
    const back = reduceTableObservation(removed, {
      stamp: { receiptOrdinal: ReceiptOrdinal.make(4), observedAtMs: 4 },
      accessEvidence: null,
      input: pushed([variable("u-1", "s-1", "ZCP_MATE_ENABLED", "1")]),
    }).state;
    expect(serviceVariableOf(back, organization, "s-1", "ZCP_MATE_ENABLED").content).toBe("1");
  });

  it("keeps a variable deleted for good, whatever older answer comes after", () => {
    const byId = { ...variables, ids: ["u-1"] } as TableQueryDescriptor;
    const state = run([
      [2, answered(variables, [variable("u-1", "s-1", "ZCP_MATE_ENABLED", "1")], 1)],
      [3, membership(variables, "remove", "u-1")],
      [5, answered(byId, [], 4)],
      // Another organization's answer prunes nothing of this one's.
      [
        6,
        answered(
          serviceVariablesDescriptor(other, [
            "s-1",
            "s-2",
            "s-3",
            "service",
            "service-a",
            "app",
            "mate",
          ]),
          [],
          6,
        ),
      ],
      // A search that began before the deletion was read says nothing of it.
      [7, answered(variables, [variable("u-1", "s-1", "ZCP_MATE_ENABLED", "1")], 3)],
    ]);
    expect(serviceVariableOf(state, organization, "s-1", "ZCP_MATE_ENABLED")).toEqual({
      known: true,
      content: null,
    });
  });

  it("knows no variable before its list's search answered", () => {
    const state = run([[2, pushed([variable("u-1", "s-1", "ZCP_MATE_ENABLED", "1")])]]);
    expect(serviceVariableOf(state, organization, "s-1", "ZCP_MATE_ENABLED")).toEqual({
      known: false,
      content: "1",
    });
  });
});

describe("the entity table's reads by id", () => {
  const byId = (ids: ReadonlyArray<string>) => ({ ...variables, ids }) as TableQueryDescriptor;
  const dueOf = (state: EntityTableState, id: string) =>
    tableRowsWanted(state).find(({ ids }) => ids.includes(id))?.dueAtMs ?? null;
  /** The table owed `ids` from receipt `since`, at wall time `nowMs`: its list named them. */
  const owed = (
    ids: ReadonlyArray<string>,
    since: number,
    nowMs: number,
    initial?: EntityTableState,
  ) =>
    run(
      ids.map((id): Step => [since, membership(variables, "add", id), nowMs]),
      initial,
    );

  it("keeps a row pushed within the index's lag when a read by id does not return it", () => {
    // The reviewer's case: a push, a full search that lags it, then a read by id that lags it too.
    const state = run([
      [2, answered(variables, [], 1, 0), 0],
      [3, pushed([flag("u-1")]), 1_000],
      [5, answered(variables, [], 4, 3_000), 3_000],
      [7, answered(byId(["u-1"]), [], 6, 4_000), 4_000],
    ]);
    expect(contentOf(state, "u-1")).toBe("1");
    expect(dueOf(state, "u-1")).toBe(1_000 + SEARCH_LAG_MS);
  });

  it("retires a row a read by id no longer returns once the lag has passed", () => {
    const state = run([
      [2, answered(variables, [], 1, 0), 0],
      [3, pushed([flag("u-1")]), 1_000],
      [5, answered(byId(["u-1"]), [], 4, 1_000 + SEARCH_LAG_MS), 1_000 + SEARCH_LAG_MS],
    ]);
    expect(contentOf(state, "u-1")).toBe(null);
    expect(dueOf(state, "u-1")).toBe(null);
  });

  it("keeps asking for an id its list named after a full search began", () => {
    const state = run([
      [2, answered(variables, [], 1, 0), 0],
      [5, membership(variables, "add", "u-2"), 5_000],
      // A full search that began at receipt 4, before the list named u-2.
      [6, answered(variables, [flag("u-2")], 4, 4_000), 6_000],
    ]);
    expect(dueOf(state, "u-2")).not.toBe(null);
  });

  it("asks again about a row it was owed and found absent, on a widening back-off", () => {
    let state = owed(["u-9"], 1, 0);
    state = run([[2, answered(variables, [], 1, 0), 0]], state);
    const due: Array<number | null> = [];
    for (const [at, ms] of [
      [3, SEARCH_LAG_MS],
      [4, 40_000],
      [5, 200_000],
      [6, 900_000],
    ] as const) {
      state = run([[at, answered(byId(["u-9"]), [], at - 1, ms), ms]], state);
      due.push(dueOf(state, "u-9"));
    }
    expect(due).toEqual([SEARCH_LAG_MS + 30_000, 160_000, 800_000, 1_500_000]);
  });

  it("does not call an id absent before the index could show it, and looks again after the lag", () => {
    let state = owed(["u-9"], 1, 5_000);
    state = run([[3, answered(byId(["u-9"]), [], 2, 6_000), 6_000]], state);
    expect(dueOf(state, "u-9")).toBe(5_000 + SEARCH_LAG_MS);
    state = run([[5, answered(byId(["u-9"]), [], 4, 15_000), 15_000]], state);
    expect(dueOf(state, "u-9")).toBe(15_000 + 30_000);
  });

  it("never lets an answer that lags a push replace the push's content", () => {
    const byIdVariables = byId(["u-1"]);
    for (const lagging of [
      answered(variables, [flag("u-1", "0")], 4, 2_000),
      answered(byIdVariables, [flag("u-1", "0")], 4, 2_000),
    ]) {
      const state = run([
        [2, answered(variables, [flag("u-1", "0")], 1, 0), 0],
        [3, pushed([flag("u-1", "1")]), 1_000],
        [5, lagging, 2_500],
      ]);
      expect(serviceVariableOf(state, organization, "s-1", "ZCP_MATE_ENABLED").content).toBe("1");
      expect(dueOf(state, "u-1")).toBe(1_000 + SEARCH_LAG_MS);
    }
  });

  it("reads an absent row unknown, and asks about it again after its back-off", () => {
    const state = run(
      [[3, answered({ ...variables, ids: ["missing"] }, [], 2, 20_000), 20_000]],
      owed(["missing"], 1, 0),
    );
    expect(tableRowsDue(state, "user-data", organization, 20_000, ["s-1"])).toEqual([]);
    expect(
      tableRowsDue(state, "user-data", organization, 20_000 + ABSENT_BACKOFF_MS[0]!, ["s-1"]),
    ).toEqual(["missing"]);
  });

  it("asks again after a failed read's wait, never delaying an id owed since it began", () => {
    let state = owed(["old"], 1, 0);
    state = owed(["new"], 3, 0, state);
    state = deferFailedTableRowRead(state, "user-data", organization, ["old", "new"], 2, 5);
    expect(tableRowsDue(state, "user-data", organization, 10, ["s-1"])).toEqual(["new"]);
    expect(
      tableRowsDue(state, "user-data", organization, 5 + TABLE_READ_RETRY_MS, ["s-1"]),
    ).toEqual(["old", "new"]);
  });
});

it("releases one project's variables without discarding another project's rows", () => {
  const first = serviceVariablesDescriptor(organization, ["s-1"]);
  const second = serviceVariablesDescriptor(organization, ["s-2"]);
  const state = run([
    [2, answered(first, [variable("u-1", "s-1", "ZCP_MATE_ENABLED", "1")], 1, 0), 0],
    [4, answered(second, [variable("u-2", "s-2", "ZCP_MATE_ENABLED", "1")], 3, 20_000), 20_000],
  ]);
  const released = releaseTableLists(state, new Set([queryKeyOf(first)]));
  expect(serviceVariableOf(released, organization, "s-2", "ZCP_MATE_ENABLED").content).toBe("1");
  expect(serviceVariableOf(released, organization, "s-1", "ZCP_MATE_ENABLED").content).toBeNull();
});

it.each(["unopened-a", "unopened-b"])(
  "a variables list for another service does not answer %s",
  (serviceId) => {
    const state = run([[2, answered(variables, [], 1, 0), 0]]);
    expect(serviceVariableOf(state, organization, serviceId, "ZCP_MATE_ENABLED").known).toBe(false);
  },
);

it.each(["s-1", "s-2"])(
  "manual metadata again asks at once only about absent rows for %s",
  (serviceId) => {
    const query = serviceVariablesDescriptor(organization, [serviceId]);
    const other = serviceVariablesDescriptor(organization, ["other-service"]);
    const failed = run([
      [1, membership(query, "add", "missing"), 0],
      [3, answered({ ...query, ids: ["missing"] }, [], 2, 20_000), 20_000],
      [4, membership(other, "add", "other-missing"), 0],
      [6, answered({ ...other, ids: ["other-missing"] }, [], 5, 30_000), 30_000],
    ]);
    const both = [serviceId, "other-service"];
    expect(tableRowsDue(failed, "user-data", organization, 40_000, both)).toEqual([]);
    const retried = retryAbsentTableRows(failed, organization, [serviceId], 40_000);
    expect(tableRowsDue(retried, "user-data", organization, 40_000, both)).toEqual(["missing"]);
    expect(
      tableRowsDue(retried, "user-data", organization, 30_000 + ABSENT_BACKOFF_MS[0]!, [
        "other-service",
      ]),
    ).toEqual(["other-missing"]);
  },
);
