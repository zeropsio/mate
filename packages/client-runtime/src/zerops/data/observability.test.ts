import { describe, expect, it } from "@effect/vitest";

import { reduceObservabilityObservation } from "./observability.ts";
import type { ObservabilityState } from "./observability.ts";
import { DEFAULT_ZEROPS_DATA_POLICY } from "./policy.ts";
import { selectHistory, selectUsage } from "./projection.ts";
import { makeInitialZeropsDataState, reduceZeropsDataState } from "./state.ts";
import type { AdmittedObservation, RegistrationRequest } from "./types.ts";
import {
  ZeropsContainerId,
  ZeropsWireSubscriptionName,
  currentMetricKeyOf,
  historyBucketKeyOf,
  historySeriesKeyOf,
  queryKeyOf,
} from "./types.ts";
import {
  desiredInterest,
  directTicket,
  identity,
  project,
  scope,
  service,
  stamp,
} from "./__fixtures__/index.ts";

const reduce = (
  state: ReturnType<typeof makeInitialZeropsDataState>,
  input: Parameters<typeof reduceZeropsDataState>[1],
) => reduceZeropsDataState(state, input, DEFAULT_ZEROPS_DATA_POLICY).state;

describe("Zerops observability model", () => {
  it("replaces current samples by query instead of merging stale containers", () => {
    const id = identity();
    const ref = service();
    const descriptor = {
      kind: "current-metrics-of-project" as const,
      project: project(),
      groupBy: "containerId" as const,
      schemaVersion: 1 as const,
    };
    const ticket = directTicket({ kind: "query", descriptor }, id, 1, 1, 1);
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    const sample = (container: string, used: number) => ({
      key: {
        service: ref,
        containerId: ZeropsContainerId.make(container),
        groupBy: "containerId" as const,
        schemaVersion: 1 as const,
      },
      cpu: { used, limit: 10 },
      virtualCpu: null,
      memoryGb: { used, limit: 20 },
      diskGb: { used, limit: 30 },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(2),
        accessEvidence: null,
        input: {
          kind: "current-metrics-replaced",
          source: "direct-read",
          ticket,
          samples: [sample("a", 1), sample("b", 2)],
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 2,
            guarantee: "non-atomic",
          },
        },
      },
    });
    const newer = directTicket({ kind: "query", descriptor }, id, 2, 2, 2);
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(3),
        accessEvidence: null,
        input: {
          kind: "current-metrics-replaced",
          source: "direct-read",
          ticket: newer,
          samples: [sample("b", 4)],
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 1,
            guarantee: "non-atomic",
          },
        },
      },
    });
    expect(state.observability.current.get(queryKeyOf(descriptor))?.samples).toHaveLength(1);
    expect(selectUsage(state, ref).value).toEqual({
      containers: 1,
      cpu: { used: 4, limit: 10 },
      memoryGb: { used: 4, limit: 20 },
      diskGb: { used: 4, limit: 30 },
    });
  });

  it("corrects history by full bucket key and replaces an admitted window", () => {
    const id = identity();
    const ref = service();
    const series = {
      service: ref,
      groupBy: "serviceStackId" as const,
      window: { timeGroupBy: "1h" as const, limit: 24, timeZone: "UTC" },
      schemaVersion: 1 as const,
    };
    const descriptor = {
      kind: "metric-history-of-project" as const,
      project: project(),
      groupBy: "serviceStackId" as const,
      window: series.window,
      schemaVersion: 1 as const,
    };
    const ticket = directTicket({ kind: "query", descriptor }, id, 1, 1, 1);
    const bucket = (from: string, till: string, used: number) => ({
      key: { series, from, till },
      containers: 1,
      cpu: { used, limit: 10 },
      virtualCpu: null,
      memoryGb: null,
      diskGb: null,
    });
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(2),
        accessEvidence: null,
        input: {
          kind: "metric-history-window-observed",
          source: "direct-read",
          ticket,
          operation: "replace-window",
          buckets: [bucket("a", "b", 1), bucket("b", "c", 2)],
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 2,
            guarantee: "non-atomic",
          },
        },
      },
    });
    const registration = {
      identity: id,
      subscriptionName: ZeropsWireSubscriptionName.make("history-wire"),
      descriptor: { kind: "metric-history", query: descriptor },
      baselineTicket: ticket,
    } as RegistrationRequest & {
      readonly descriptor: { readonly kind: "metric-history"; readonly query: typeof descriptor };
    };
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(3),
        accessEvidence: null,
        input: {
          kind: "metric-history-window-observed",
          source: "native-push",
          registration,
          operation: "correct-buckets",
          buckets: [bucket("b", "c", 9)],
          coverage: {
            kind: "partial-window",
            offset: 1,
            limit: 1,
            traversedPages: 1,
            observedTotal: 2,
          },
        },
      },
    });
    const view = selectHistory(state, series);
    expect(
      view.series.buckets.get(historyBucketKeyOf({ series, from: "a", till: "b" }))?.cpu?.used,
    ).toBe(1);
    expect(
      view.series.buckets.get(historyBucketKeyOf({ series, from: "b", till: "c" }))?.cpu?.used,
    ).toBe(9);
    expect(state.observability.history.has(historySeriesKeyOf(series))).toBe(true);

    const emptyTicket = directTicket({ kind: "query", descriptor }, id, 2, 3, 4);
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(4),
        accessEvidence: null,
        input: {
          kind: "metric-history-window-observed",
          source: "direct-read",
          ticket: emptyTicket,
          operation: "replace-window",
          buckets: [],
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 0,
            guarantee: "non-atomic",
          },
        },
      },
    });
    const empty = selectHistory(state, series);
    expect(empty.series.status).toBe("observed");
    expect(empty.series.buckets.size).toBe(0);
    expect(empty.series.coverage).toMatchObject({ observedTotal: 0 });
  });

  it("documents that a delayed admitted unversioned native sample can regress a direct result", () => {
    const id = identity();
    const ref = service();
    const descriptor = {
      kind: "current-metrics-of-project" as const,
      project: project(),
      groupBy: "containerId" as const,
      schemaVersion: 1 as const,
    };
    const ticket = directTicket({ kind: "query", descriptor }, id, 1, 1, 1);
    const registration = {
      identity: id,
      subscriptionName: ZeropsWireSubscriptionName.make("metric-wire"),
      descriptor: { kind: "current-metrics", query: descriptor },
      baselineTicket: ticket,
    } as RegistrationRequest & {
      readonly descriptor: { readonly kind: "current-metrics"; readonly query: typeof descriptor };
    };
    const sample = (used: number) => ({
      key: {
        service: ref,
        containerId: ZeropsContainerId.make("a"),
        groupBy: "containerId" as const,
        schemaVersion: 1 as const,
      },
      cpu: { used, limit: 10 },
      virtualCpu: null,
      memoryGb: null,
      diskGb: null,
    });
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(2),
        accessEvidence: null,
        input: {
          kind: "current-metrics-replaced",
          source: "direct-read",
          ticket,
          samples: [sample(9)],
          coverage: {
            kind: "partial-window",
            offset: 0,
            limit: 1,
            traversedPages: 1,
            observedTotal: 1,
          },
        },
      },
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(3),
        accessEvidence: null,
        input: {
          kind: "current-metrics-replaced",
          source: "native-push",
          registration,
          samples: [sample(1)],
          coverage: {
            kind: "partial-window",
            offset: 0,
            limit: 1,
            traversedPages: 1,
            observedTotal: 1,
          },
        },
      },
    });
    expect(
      state.observability.current
        .get(queryKeyOf(descriptor))
        ?.samples.get(currentMetricKeyOf(sample(1).key))?.cpu?.used,
    ).toBe(1);
  });
});

describe("history replace-window descriptor matching", () => {
  it("clears a stored series by its own key fields, not a hardcoded groupBy/schemaVersion literal", () => {
    // Forces a schemaVersion the current type system does not otherwise allow, to prove
    // replace-window compares the descriptor against series.key rather than a hardcoded
    // literal. Today groupBy/schemaVersion have exactly one legal value each, so this is
    // the only way to distinguish the two implementations without changing the type.
    const forcedSchemaVersion = 2 as unknown as 1;
    const ref = service();
    const window = { timeGroupBy: "1h" as const, limit: 24, timeZone: "UTC" };
    const seriesKey = {
      service: ref,
      groupBy: "serviceStackId" as const,
      window,
      schemaVersion: forcedSchemaVersion,
    };
    const descriptor = {
      kind: "metric-history-of-project" as const,
      project: ref.project,
      groupBy: "serviceStackId" as const,
      window,
      schemaVersion: forcedSchemaVersion,
    };
    const seriesMapKey = historySeriesKeyOf(seriesKey);
    const bucketKey = { series: seriesKey, from: "a", till: "b" };
    const initialState: ObservabilityState = {
      current: new Map(),
      history: new Map([
        [
          seriesMapKey,
          {
            status: "observed",
            key: seriesKey,
            buckets: new Map([
              [
                historyBucketKeyOf(bucketKey),
                {
                  key: bucketKey,
                  containers: 1,
                  cpu: { used: 1, limit: 2 },
                  virtualCpu: null,
                  memoryGb: null,
                  diskGb: null,
                },
              ],
            ]),
            coverage: {
              kind: "exhausted-traversal",
              traversedPages: 1,
              observedTotal: 1,
              guarantee: "non-atomic",
            },
            stamp: stamp(1),
          },
        ],
      ]),
      historyAdmission: new Map(),
    };
    const ticket = directTicket({ kind: "query", descriptor } as never, identity(), 2, 2, 2);
    const admitted: AdmittedObservation = {
      stamp: stamp(2),
      accessEvidence: null,
      input: {
        kind: "metric-history-window-observed",
        source: "direct-read",
        ticket,
        operation: "replace-window",
        buckets: [],
        coverage: {
          kind: "exhausted-traversal",
          traversedPages: 1,
          observedTotal: 0,
          guarantee: "non-atomic",
        },
      } as never,
    };
    const result = reduceObservabilityObservation(initialState, admitted);
    expect(result.state.history.get(seriesMapKey)?.buckets.size).toBe(0);
  });
});

describe("multi-service metric history", () => {
  it("keeps each series identity and clears omitted services when replacing a nonempty window", () => {
    const id = identity();
    const window = { timeGroupBy: "1h" as const, limit: 24, timeZone: "UTC" };
    const descriptor = {
      kind: "metric-history-of-project" as const,
      project: project(),
      groupBy: "serviceStackId" as const,
      window,
      schemaVersion: 1 as const,
    };
    const series = (name: string) => ({
      service: service(name),
      groupBy: "serviceStackId" as const,
      window,
      schemaVersion: 1 as const,
    });
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    const replace = (ordinal: number, names: ReadonlyArray<string>) => {
      state = reduce(state, {
        kind: "observation",
        observation: {
          stamp: stamp(ordinal),
          accessEvidence: null,
          input: {
            kind: "metric-history-window-observed",
            source: "direct-read",
            ticket: directTicket({ kind: "query", descriptor }, id, ordinal, ordinal, ordinal),
            operation: "replace-window",
            coverage: {
              kind: "partial-window",
              offset: 0,
              limit: 24,
              traversedPages: 1,
              observedTotal: null,
            },
            buckets: names.map((name) => ({
              key: {
                series: series(name),
                from: "2026-09-08T00:00:00Z",
                till: "2026-09-08T01:00:00Z",
              },
              containers: 1,
              cpu: { used: 1, limit: 2 },
              virtualCpu: null,
              memoryGb: null,
              diskGb: null,
            })),
          },
        },
      });
    };
    replace(1, ["a", "b"]);
    expect(selectHistory(state, series("b")).series.key).toEqual(series("b"));
    expect(selectHistory(state, series("b")).series.buckets.size).toBe(1);
    replace(2, ["a"]);
    expect(selectHistory(state, series("a")).series.buckets.size).toBe(1);
    expect(selectHistory(state, series("b")).series.buckets.size).toBe(0);
    expect(selectHistory(state, series("b")).series.key).toEqual(series("b"));
  });
});
