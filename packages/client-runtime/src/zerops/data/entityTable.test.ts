import { describe, expect, it } from "@effect/vitest";

import {
  activeVersionOf,
  makeInitialEntityTableState,
  reduceTableObservation,
  releaseTableLists,
  serviceVariableOf,
  SERVICE_VARIABLE_KEYS,
  type EntityTableState,
} from "./entityTable.ts";
import type {
  AppVersionRow,
  QueryCoverage,
  RegistrationRequest,
  ServiceVariableRow,
  TableObservation,
  TableQueryDescriptor,
} from "./types.ts";
import { ReceiptOrdinal, ZeropsWireSubscriptionName, queryKeyOf } from "./types.ts";
import { directTicket, identity, organization, stamp } from "./__fixtures__/index.ts";

const versions: TableQueryDescriptor = {
  kind: "active-versions-of-organization",
  organization,
  schemaVersion: 1,
};
const variables: TableQueryDescriptor = {
  kind: "service-variables-of-organization",
  organization,
  keys: SERVICE_VARIABLE_KEYS,
  schemaVersion: 1,
};
const complete: QueryCoverage = {
  kind: "exhausted-traversal",
  traversedPages: 1,
  observedTotal: null,
  guarantee: "non-atomic",
};

const version = (id: string, status = "ACTIVE", source = "CLI"): AppVersionRow => ({
  id,
  serviceId: `service-of-${id}`,
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

const baseline = (
  descriptor: TableQueryDescriptor,
  rows: ReadonlyArray<AppVersionRow | ServiceVariableRow>,
  start: number,
): TableObservation => ({
  kind: "table-rows-observed",
  entity: descriptor.kind === "active-versions-of-organization" ? "app-version" : "user-data",
  rows,
  source: "direct-read",
  coverage: complete,
  ticket: {
    ...directTicket({ kind: "query", descriptor }, identity(), start, start, start),
    membershipReceiptOrdinalAtStart: ReceiptOrdinal.make(start),
  } as never,
});
const pushed = (
  entity: "app-version" | "user-data",
  rows: ReadonlyArray<AppVersionRow | ServiceVariableRow>,
): TableObservation => ({
  kind: "table-rows-observed",
  entity,
  rows,
  source: "native-push",
  registration: {
    identity: identity(),
    subscriptionName: ZeropsWireSubscriptionName.make(`wire-${entity}-updates`),
    descriptor: { kind: "table-updates", entity, organization },
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

const run = (steps: ReadonlyArray<[number, TableObservation]>): EntityTableState =>
  steps.reduce(
    (state, [ordinal, input]) =>
      reduceTableObservation(state, { stamp: stamp(ordinal), accessEvidence: null, input }).state,
    makeInitialEntityTableState(),
  );

describe("the entity table", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly steps: ReadonlyArray<[number, TableObservation]>;
    readonly versions: Record<string, string | null | "unknown">;
  }> = [
    {
      name: "is unknown until its list's search answered",
      steps: [[2, pushed("app-version", [version("v-1")])]],
      versions: { "v-1": "unknown" },
    },
    {
      name: "holds what the search answered, and knows a version it lacks is not active",
      steps: [[2, baseline(versions, [version("v-1"), version("v-2", "ACTIVE", "NONE")], 1)]],
      versions: { "v-1": "CLI", "v-2": "NONE", "v-3": null },
    },
    {
      name: "takes an update frame's row in place, without reading",
      steps: [
        [2, baseline(versions, [version("v-1")], 1)],
        [3, pushed("app-version", [version("v-2", "ACTIVE", "GIT")])],
      ],
      versions: { "v-1": "CLI", "v-2": "GIT" },
    },
    {
      name: "lets go of a version an update says is no longer active",
      steps: [
        [2, baseline(versions, [version("v-1")], 1)],
        [3, pushed("app-version", [version("v-1", "BACKUP")])],
      ],
      versions: { "v-1": null },
    },
    {
      name: "lets go of a version its list's stream deleted",
      steps: [
        [2, baseline(versions, [version("v-1")], 1)],
        [3, membership(versions, "remove", "v-1")],
      ],
      versions: { "v-1": null },
    },
    {
      name: "keeps a row pushed after the search began over the search's older answer",
      steps: [
        [3, pushed("app-version", [version("v-1", "ACTIVE", "GIT")])],
        [4, baseline(versions, [version("v-1", "ACTIVE", "CLI")], 2)],
      ],
      versions: { "v-1": "GIT" },
    },
    {
      name: "does not bring back a version deleted after the search began",
      steps: [
        [3, membership(versions, "remove", "v-1")],
        [4, baseline(versions, [version("v-1")], 2)],
      ],
      versions: { "v-1": null },
    },
    {
      name: "drops a held version a later search no longer names",
      steps: [
        [2, baseline(versions, [version("v-1"), version("v-2")], 1)],
        [4, baseline(versions, [version("v-2")], 3)],
      ],
      versions: { "v-1": null, "v-2": "CLI" },
    },
    {
      name: "ignores a search answer that began before the one it already applied",
      steps: [
        [3, baseline(versions, [version("v-2")], 2)],
        [4, baseline(versions, [version("v-1")], 1)],
      ],
      versions: { "v-1": null, "v-2": "CLI" },
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, () => {
      const state = run(testCase.steps);
      for (const [id, expected] of Object.entries(testCase.versions)) {
        const answer = activeVersionOf(state, organization, id);
        expect(answer.known ? (answer.row?.source ?? null) : "unknown").toBe(expected);
      }
    });
  }

  it("holds only the variables the app reads, by service", () => {
    const state = run([
      [
        2,
        baseline(
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

  it("forgets a list nothing demands any more, and the rows it kept current", () => {
    const state = run([[2, baseline(versions, [version("v-1")], 1)]]);
    const released = releaseTableLists(state, new Set([queryKeyOf(versions)]));
    expect(activeVersionOf(released, organization, "v-1")).toEqual({ known: false, row: null });
  });

  it("knows no list whose search answered only a window of it", () => {
    const partial = baseline(versions, [version("v-1")], 1);
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
    expect(activeVersionOf(state, organization, "v-2").known).toBe(false);
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
