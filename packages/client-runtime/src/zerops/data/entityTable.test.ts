import { describe, expect, it } from "@effect/vitest";

import {
  activeVersionOf,
  askedAbsent,
  activeVersionsDescriptor,
  makeInitialEntityTableState,
  reduceTableObservation,
  releaseTableLists,
  retryAbsentTableRows,
  SEARCH_LAG_MS,
  serviceVariableOf,
  TOMBSTONE_MS,
  serviceVariablesDescriptor,
  tableRowsWanted,
  finishTableRowRead,
  wantTableRows,
  type EntityTableState,
} from "./entityTable.ts";
import type {
  AppVersionRow,
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
const versions = activeVersionsDescriptor(organization, [
  "s-1",
  "s-2",
  "s-3",
  "service",
  "service-a",
  "app",
  "mate",
]);
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

const version = (id: string, status = "ACTIVE", source = "CLI"): AppVersionRow => ({
  id,
  serviceId: "s-1",
  projectId: "project-1",
  status,
  source,
});
const variable = (
  id: string,
  serviceId: string,
  key: string,
  content: string | null,
): ServiceVariableRow => ({ id, serviceId, projectId: "project-1", key, content });

/** A search answer that began at receipt `start`, at wall time `startMs`. */
const answered = (
  descriptor: TableQueryDescriptor,
  rows: ReadonlyArray<AppVersionRow | ServiceVariableRow>,
  start: number,
  startMs = start,
): TableObservation => ({
  kind: "table-rows-observed",
  entity: descriptor.kind === "active-versions-of-services" ? "app-version" : "user-data",
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
  entity: "app-version" | "user-data",
  rows: ReadonlyArray<AppVersionRow | ServiceVariableRow>,
  owner: OrganizationRef = organization,
): TableObservation => ({
  kind: "table-rows-observed",
  entity,
  rows,
  source: "native-push",
  registration: {
    identity: identity(),
    subscriptionName: ZeropsWireSubscriptionName.make(`wire-${entity}-updates`),
    descriptor: {
      kind: "table-updates",
      entity,
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

const sourceOf = (state: EntityTableState, id: string, owner = organization) => {
  const answer = activeVersionOf(state, owner, id, "s-1");
  return answer.known ? (answer.row?.source ?? null) : "unknown";
};

describe("the entity table's active versions", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly steps: ReadonlyArray<Step>;
    readonly versions: Record<string, string | null | "unknown">;
    readonly wanted?: ReadonlyArray<string>;
  }> = [
    {
      name: "is unknown until its list's search answered",
      steps: [[2, pushed("app-version", [version("v-1")])]],
      versions: { "v-1": "unknown" },
    },
    {
      name: "holds what the search answered, and knows a version it lacks is not active",
      steps: [[2, answered(versions, [version("v-1"), version("v-2", "ACTIVE", "NONE")], 1)]],
      versions: { "v-1": "CLI", "v-2": "NONE", "v-3": null },
    },
    {
      name: "takes an update frame's row in place, without reading",
      steps: [
        [2, answered(versions, [version("v-1")], 1)],
        [3, pushed("app-version", [version("v-2", "ACTIVE", "GIT")])],
      ],
      versions: { "v-1": "CLI", "v-2": "GIT" },
    },
    {
      name: "takes a version inactive at first once a push activates it",
      steps: [
        [2, answered(versions, [], 1)],
        [3, pushed("app-version", [version("v-1", "BUILDING")])],
        [4, pushed("app-version", [version("v-1", "ACTIVE")])],
      ],
      versions: { "v-1": "CLI" },
    },
    {
      name: "lets go of a version an update says is no longer active",
      steps: [
        [2, answered(versions, [version("v-1")], 1)],
        [3, pushed("app-version", [version("v-1", "BACKUP")])],
      ],
      versions: { "v-1": null },
    },
    {
      name: "asks for a row its list added without one, and keeps nothing it cannot prove",
      steps: [
        [2, answered(versions, [], 1)],
        [3, membership(versions, "add", "v-1")],
      ],
      versions: { "v-1": null },
      wanted: ["v-1"],
    },
    {
      name: "asks again about a version its list removed, and keeps the row until it knows",
      steps: [
        [2, answered(versions, [version("v-1")], 1)],
        [3, membership(versions, "remove", "v-1")],
      ],
      versions: { "v-1": "CLI" },
      wanted: ["v-1"],
    },
    {
      name: "keeps a row pushed after the search began over the search's older answer",
      steps: [
        [3, pushed("app-version", [version("v-1", "ACTIVE", "GIT")])],
        [4, answered(versions, [version("v-1", "ACTIVE", "CLI")], 2)],
      ],
      versions: { "v-1": "GIT" },
    },
    {
      name: "keeps a recent push until a fresh answer, without a delayed reread",
      steps: [
        [2, pushed("app-version", [version("v-1")]), 1_000],
        [4, answered(versions, [], 3, 1_000 + SEARCH_LAG_MS - 1)],
      ],
      versions: { "v-1": "CLI" },
    },
    {
      name: "drops a row pushed long before a search that no longer names it",
      steps: [
        [2, pushed("app-version", [version("v-1")]), 1_000],
        [4, answered(versions, [], 3, 1_000 + SEARCH_LAG_MS)],
      ],
      versions: { "v-1": null },
    },
    {
      name: "does not bring back a version an update retired after the search began",
      steps: [
        [3, pushed("app-version", [version("v-1", "BACKUP")])],
        [4, answered(versions, [version("v-1")], 2)],
      ],
      versions: { "v-1": null },
    },
    {
      name: "ignores a search answer that began before the one it already applied",
      steps: [
        [3, answered(versions, [version("v-2")], 2)],
        [4, answered(versions, [version("v-1")], 1)],
      ],
      versions: { "v-1": null, "v-2": "CLI" },
    },
    {
      name: "keeps each organization's versions to its own search",
      steps: [
        [2, answered(versions, [version("v-1")], 1)],
        [3, pushed("app-version", [version("v-9")], other)],
        [
          4,
          answered(
            activeVersionsDescriptor(other, [
              "s-1",
              "s-2",
              "s-3",
              "service",
              "service-a",
              "app",
              "mate",
            ]),
            [version("v-9")],
            3,
          ),
        ],
        [6, answered(versions, [], 5, 10_000_000)],
      ],
      versions: { "v-1": null },
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      const state = run(testCase.steps);
      for (const [id, expected] of Object.entries(testCase.versions)) {
        expect(sourceOf(state, id)).toBe(expected);
      }
      expect(
        tableRowsWanted(state).flatMap((wanted) =>
          wanted.entity === "app-version" ? wanted.ids : [],
        ),
      ).toEqual(testCase.wanted ?? []);
    });
  }

  it("keeps another organization's versions when one organization's search answers", () => {
    const state = run([
      [
        2,
        answered(
          activeVersionsDescriptor(other, [
            "s-1",
            "s-2",
            "s-3",
            "service",
            "service-a",
            "app",
            "mate",
          ]),
          [version("v-9")],
          1,
        ),
      ],
      [4, answered(versions, [], 3, 10_000_000)],
    ]);
    expect(sourceOf(state, "v-9", other)).toBe("CLI");
  });

  it("forgets a retired version once no read could still bring it back", () => {
    const state = run([
      [2, answered(versions, [], 1)],
      [3, pushed("app-version", [version("v-1", "BUILDING")]), 1_000],
      [4, pushed("app-version", [version("v-2")]), 1_000 + TOMBSTONE_MS + 1],
    ]);
    expect([...state.rows["app-version"].keys()]).toEqual(["v-2"]);
  });

  it("settles a row it asked about by the read of it, and stops asking", () => {
    const byId = { ...versions, ids: ["v-1", "v-2"] } as TableQueryDescriptor;
    const state = run([
      [2, answered(versions, [version("v-2")], 1, 1_000), 1_000],
      [3, membership(versions, "add", "v-1"), 2_000],
      [4, membership(versions, "remove", "v-2"), 2_000],
      [6, answered(byId, [version("v-1")], 5, 1_000 + SEARCH_LAG_MS + 1), 20_000],
    ]);
    expect(sourceOf(state, "v-1")).toBe("CLI");
    expect(sourceOf(state, "v-2")).toBe(null);
    expect(tableRowsWanted(state)).toEqual([]);
  });

  it("forgets a list nothing demands any more, every row it kept and every row it waits on", () => {
    const state = run([
      [2, pushed("app-version", [version("v-0")])],
      [3, answered(versions, [version("v-1")], 2)],
      [4, membership(versions, "add", "v-2")],
    ]);
    const released = releaseTableLists(state, new Set([queryKeyOf(versions)]));
    expect(activeVersionOf(released, organization, "v-1", "s-1")).toEqual({
      known: false,
      row: null,
    });
    expect(released.rows["app-version"].size).toBe(0);
    expect(tableRowsWanted(released)).toEqual([]);
  });

  it("forgets a list that never answered, and the rows pushed for it", () => {
    const state = run([[2, pushed("app-version", [version("v-0")])]]);
    const released = releaseTableLists(state, new Set([queryKeyOf(versions)]));
    expect(released.rows["app-version"].size).toBe(0);
  });

  it("knows no list whose search answered only a window of it", () => {
    const partial = answered(versions, [version("v-1")], 1);
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
    expect(activeVersionOf(state, organization, "v-2", "s-1").known).toBe(false);
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
      [3, pushed("user-data", [variable("u-3", "s-2", "SOME_SECRET", "x")])],
      [4, pushed("user-data", [variable("u-4", "s-2", "ZCP_MATE_ENABLED", "0")])],
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
      input: pushed("user-data", [variable("u-1", "s-1", "ZCP_MATE_ENABLED", "1")]),
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
    const state = run([
      [2, pushed("user-data", [variable("u-1", "s-1", "ZCP_MATE_ENABLED", "1")])],
    ]);
    expect(serviceVariableOf(state, organization, "s-1", "ZCP_MATE_ENABLED")).toEqual({
      known: false,
      content: "1",
    });
  });
});

describe("the entity table's reads by id", () => {
  const byId = (ids: ReadonlyArray<string>) => ({ ...versions, ids }) as TableQueryDescriptor;
  const dueOf = (state: EntityTableState, id: string) =>
    tableRowsWanted(state).find(({ ids }) => ids.includes(id))?.dueAtMs ?? null;

  it("keeps a row pushed within the index's lag when a read by id does not return it", () => {
    // The reviewer's case: a push, a full search that lags it, then a read by id that lags it too.
    const state = run([
      [2, answered(versions, [], 1, 0), 0],
      [3, pushed("app-version", [version("v-1")]), 1_000],
      [5, answered(versions, [], 4, 3_000), 3_000],
      [7, answered(byId(["v-1"]), [], 6, 4_000), 4_000],
    ]);
    expect(sourceOf(state, "v-1")).toBe("CLI");
    expect(dueOf(state, "v-1")).toBeNull();
  });

  it("retires a row a read by id no longer returns once the lag has passed", () => {
    const state = run([
      [2, answered(versions, [], 1, 0), 0],
      [3, pushed("app-version", [version("v-1")]), 1_000],
      [5, answered(byId(["v-1"]), [], 4, 1_000 + SEARCH_LAG_MS), 1_000 + SEARCH_LAG_MS],
    ]);
    expect(sourceOf(state, "v-1")).toBe(null);
    expect(dueOf(state, "v-1")).toBe(null);
  });

  it("does not bring back a row a push retired within the lag", () => {
    const state = run([
      [2, answered(versions, [version("v-1")], 1, 0), 0],
      [3, pushed("app-version", [version("v-1", "BACKUP")]), 1_000],
      [4, membership(versions, "remove", "v-1"), 1_100],
      [6, answered(byId(["v-1"]), [version("v-1")], 5, 2_000), 2_000],
    ]);
    expect(sourceOf(state, "v-1")).toBe(null);
  });

  it("keeps asking for an id its list named after a full search began", () => {
    const state = run([
      [2, answered(versions, [], 1, 0), 0],
      [5, membership(versions, "add", "v-2"), 5_000],
      // A full search that began at receipt 4, before the list named v-2.
      [6, answered(versions, [version("v-2")], 4, 4_000), 6_000],
    ]);
    expect(dueOf(state, "v-2")).not.toBe(null);
  });

  it("never lets an answer that lags a push replace the push's content", () => {
    const flag = (content: string) => variable("u-1", "s-1", "ZCP_MATE_ENABLED", content);
    const byIdVariables = { ...variables, ids: ["u-1"] } as TableQueryDescriptor;
    for (const lagging of [
      answered(variables, [flag("0")], 4, 2_000),
      answered(byIdVariables, [flag("0")], 4, 2_000),
    ]) {
      const state = run([
        [2, answered(variables, [flag("0")], 1, 0), 0],
        [3, pushed("user-data", [flag("1")]), 1_000],
        [5, lagging, 2_500],
      ]);
      expect(serviceVariableOf(state, organization, "s-1", "ZCP_MATE_ENABLED").content).toBe("1");
      expect(dueOf(state, "u-1")).toBeNull();
    }
  });
});

it("leaves an absent table row failed with no automatic next read", () => {
  const requested = wantTableRows(
    makeInitialEntityTableState(),
    "app-version",
    organization,
    ["missing"],
    1,
    0,
    ["s-1"],
  );
  const state = run(
    [[3, answered({ ...versions, ids: ["missing"] }, [], 2, 20_000), 20_000]],
    requested,
  );
  expect(askedAbsent(state, "app-version", "missing")).toEqual({ retryAtMs: null });
  expect(tableRowsWanted(state)).toEqual([]);
});

it("releases one project's metadata without discarding another project's rows", () => {
  const first = activeVersionsDescriptor(organization, ["s-1"]);
  const second = activeVersionsDescriptor(organization, ["s-2"]);
  const state = run([
    [2, answered(first, [{ ...version("v-1"), serviceId: "s-1" }], 1, 0), 0],
    [4, answered(second, [{ ...version("v-2"), serviceId: "s-2" }], 3, 20_000), 20_000],
  ]);
  const released = releaseTableLists(state, new Set([queryKeyOf(first)]));
  expect(activeVersionOf(released, organization, "v-2", "s-2").row?.id).toBe("v-2");
  expect(activeVersionOf(released, organization, "v-1", "s-1").row).toBeNull();
});

it.each(["unopened-a", "unopened-b"])(
  "a version list for another service does not answer %s",
  (serviceId) => {
    const state = run([[2, answered(versions, [], 1, 0), 0]]);
    expect(activeVersionOf(state, organization, "unlisted-version", serviceId).known).toBe(false);
  },
);

it.each(["s-1", "s-2"])("manual metadata again retries only absent rows for %s", (serviceId) => {
  const query = activeVersionsDescriptor(organization, [serviceId]);
  const other = activeVersionsDescriptor(organization, ["other-service"]);
  const failed = run([
    [1, membership(query, "add", "missing"), 0],
    [3, answered({ ...query, ids: ["missing"] }, [], 2, 10), 10],
    [4, membership(other, "add", "other-missing"), 20],
    [6, answered({ ...other, ids: ["other-missing"] }, [], 5, 30), 30],
  ]);
  expect(tableRowsWanted(failed)).toEqual([]);
  const retried = retryAbsentTableRows(failed, organization, [serviceId], 40);
  expect(tableRowsWanted(retried).flatMap((batch) => batch.ids)).toEqual(["missing"]);
  expect(askedAbsent(retried, "app-version", "other-missing")).toEqual({ retryAtMs: null });
});

it("ends owed IDs unavailable after one read without consuming newer evidence", () => {
  let state = wantTableRows(
    makeInitialEntityTableState(),
    "app-version",
    organization,
    ["old"],
    1,
    0,
    ["s-1"],
  );
  state = wantTableRows(state, "app-version", organization, ["new"], 3, 0, ["s-1"]);
  state = finishTableRowRead(state, "app-version", organization, ["old", "new"], 2);
  expect(tableRowsWanted(state).flatMap((batch) => batch.ids)).toEqual(["new"]);
  expect(askedAbsent(state, "app-version", "old")).toEqual({ retryAtMs: null });
  const again = retryAbsentTableRows(state, organization, ["s-1"], 10);
  expect(tableRowsWanted(again).flatMap((batch) => batch.ids)).toEqual(["old", "new"]);
});
