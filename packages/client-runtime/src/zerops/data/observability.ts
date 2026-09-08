import type {
  AdmittedObservation,
  CurrentMetricMapKey,
  CurrentMetricObservation,
  CurrentMetricSample,
  HistoryBucketMapKey,
  HistoryMetricObservation,
  HistoryMetricBucket,
  HistorySeriesMapKey,
  HistorySeriesState,
  QueryCoverage,
  QueryKey,
  ReceiptOrdinal,
  ReadContribution,
  ReadStartOrdinal,
} from "./types.ts";
import { currentMetricKeyOf, historyBucketKeyOf, historySeriesKeyOf, queryKeyOf } from "./types.ts";
import { noOutcome, type DomainObservationOutcome } from "./inventory.ts";

export interface CurrentMetricQueryState {
  readonly key: QueryKey;
  readonly samples: ReadonlyMap<CurrentMetricMapKey, CurrentMetricSample>;
  readonly coverage: QueryCoverage;
  readonly stamp: AdmittedObservation["stamp"];
  readonly lastAppliedReadStartOrdinal: ReadStartOrdinal | null;
  readonly lastNativeReceiptOrdinal: ReceiptOrdinal | null;
}

export interface HistoryAdmission {
  readonly lastAppliedReadStartOrdinal: ReadStartOrdinal | null;
  readonly lastNativeReceiptOrdinal: ReceiptOrdinal | null;
}

export interface ObservabilityState {
  readonly current: ReadonlyMap<QueryKey, CurrentMetricQueryState>;
  readonly history: ReadonlyMap<HistorySeriesMapKey, HistorySeriesState>;
  readonly historyAdmission: ReadonlyMap<HistorySeriesMapKey, HistoryAdmission>;
}

export interface ObservabilityReduction {
  readonly state: ObservabilityState;
  readonly outcome: DomainObservationOutcome;
}

export const makeInitialObservabilityState = (): ObservabilityState => ({
  current: new Map(),
  history: new Map(),
  historyAdmission: new Map(),
});

const metricOutcome = (
  observation: CurrentMetricObservation | HistoryMetricObservation,
  contribution: ReadContribution,
  status: "applied" | "suppressed",
): DomainObservationOutcome => ({
  readRequestId: observation.source === "direct-read" ? observation.ticket.requestId : null,
  applied: status === "applied" ? [contribution] : [],
  suppressed: status === "suppressed" ? [contribution] : [],
  unresolvedRequiredFields: [],
});

function reduceCurrent(
  state: ObservabilityState,
  admitted: AdmittedObservation,
  observation: CurrentMetricObservation,
): ObservabilityReduction {
  const descriptor =
    observation.source === "direct-read"
      ? observation.ticket.target.descriptor
      : observation.registration.descriptor.query;
  const key = queryKeyOf(descriptor);
  const existing = state.current.get(key);
  if (
    observation.source === "direct-read" &&
    ((existing?.lastAppliedReadStartOrdinal !== null &&
      existing?.lastAppliedReadStartOrdinal !== undefined &&
      existing.lastAppliedReadStartOrdinal >= observation.ticket.readStartOrdinal) ||
      (existing?.lastNativeReceiptOrdinal !== null &&
        existing?.lastNativeReceiptOrdinal !== undefined &&
        existing.lastNativeReceiptOrdinal > observation.ticket.receiptOrdinalAtStart))
  ) {
    return { state, outcome: metricOutcome(observation, "current-metrics", "suppressed") };
  }
  const samples = new Map<CurrentMetricMapKey, CurrentMetricSample>();
  for (const sample of observation.samples) samples.set(currentMetricKeyOf(sample.key), sample);
  const next: CurrentMetricQueryState = {
    key,
    samples,
    coverage: observation.coverage,
    stamp: admitted.stamp,
    lastAppliedReadStartOrdinal:
      observation.source === "direct-read"
        ? observation.ticket.readStartOrdinal
        : (existing?.lastAppliedReadStartOrdinal ?? null),
    lastNativeReceiptOrdinal:
      observation.source === "native-push"
        ? admitted.stamp.receiptOrdinal
        : (existing?.lastNativeReceiptOrdinal ?? null),
  };
  const current = new Map(state.current);
  current.set(key, next);
  return {
    state: { ...state, current },
    outcome: metricOutcome(observation, "current-metrics", "applied"),
  };
}

function reduceHistory(
  state: ObservabilityState,
  admitted: AdmittedObservation,
  observation: HistoryMetricObservation,
): ObservabilityReduction {
  const first = observation.buckets[0];
  const descriptor =
    observation.source === "direct-read"
      ? observation.ticket.target.descriptor
      : observation.registration.descriptor.query;
  if (first === undefined && observation.operation === "correct-buckets") {
    return { state, outcome: metricOutcome(observation, "metric-history", "applied") };
  }

  const affectedSeries = new Map<
    HistorySeriesMapKey,
    Map<HistoryBucketMapKey, HistoryMetricBucket>
  >();
  for (const bucket of observation.buckets) {
    const seriesKey = historySeriesKeyOf(bucket.key.series);
    const buckets = affectedSeries.get(seriesKey) ?? new Map();
    buckets.set(historyBucketKeyOf(bucket.key), bucket);
    affectedSeries.set(seriesKey, buckets);
  }

  if (observation.operation === "replace-window") {
    for (const [seriesKey, series] of state.history) {
      if (
        queryKeyOf({
          kind: "metric-history-of-project",
          project: series.key.service.project,
          groupBy: series.key.groupBy,
          window: series.key.window,
          schemaVersion: series.key.schemaVersion,
        }) === queryKeyOf(descriptor) &&
        !affectedSeries.has(seriesKey)
      )
        affectedSeries.set(seriesKey, new Map());
    }
  }

  let history: Map<HistorySeriesMapKey, HistorySeriesState> | null = null;
  let historyAdmission: Map<HistorySeriesMapKey, HistoryAdmission> | null = null;
  let suppressed = false;
  for (const [seriesKey, incoming] of affectedSeries) {
    const existing = state.history.get(seriesKey);
    const admission = state.historyAdmission.get(seriesKey) ?? {
      lastAppliedReadStartOrdinal: null,
      lastNativeReceiptOrdinal: null,
    };
    if (
      observation.source === "direct-read" &&
      ((admission.lastAppliedReadStartOrdinal !== null &&
        admission.lastAppliedReadStartOrdinal >= observation.ticket.readStartOrdinal) ||
        (admission.lastNativeReceiptOrdinal !== null &&
          admission.lastNativeReceiptOrdinal > observation.ticket.receiptOrdinalAtStart))
    ) {
      suppressed = true;
      continue;
    }
    const series = incoming.values().next().value?.key.series ?? existing?.key;
    if (series === undefined) continue;
    const buckets =
      observation.operation === "replace-window"
        ? new Map(incoming)
        : new Map(existing?.buckets ?? []);
    if (observation.operation === "correct-buckets") {
      for (const [bucketKey, bucket] of incoming) buckets.set(bucketKey, bucket);
    }
    history ??= new Map(state.history);
    historyAdmission ??= new Map(state.historyAdmission);
    history.set(seriesKey, {
      status: "observed",
      key: series,
      buckets,
      coverage: observation.coverage as Exclude<QueryCoverage, { readonly kind: "none" }>,
      stamp: admitted.stamp,
    });
    historyAdmission.set(seriesKey, {
      lastAppliedReadStartOrdinal:
        observation.source === "direct-read"
          ? observation.ticket.readStartOrdinal
          : admission.lastAppliedReadStartOrdinal,
      lastNativeReceiptOrdinal:
        observation.source === "native-push"
          ? admitted.stamp.receiptOrdinal
          : admission.lastNativeReceiptOrdinal,
    });
  }
  if (history === null) {
    return {
      state,
      outcome: metricOutcome(observation, "metric-history", suppressed ? "suppressed" : "applied"),
    };
  }
  return {
    state: { ...state, history, historyAdmission: historyAdmission ?? state.historyAdmission },
    outcome: metricOutcome(observation, "metric-history", "applied"),
  };
}

export function reduceObservabilityObservation(
  state: ObservabilityState,
  admitted: AdmittedObservation,
): ObservabilityReduction {
  if (admitted.input.kind === "current-metrics-replaced") {
    return reduceCurrent(state, admitted, admitted.input);
  }
  if (admitted.input.kind === "metric-history-window-observed") {
    return reduceHistory(state, admitted, admitted.input);
  }
  return { state, outcome: noOutcome() };
}
