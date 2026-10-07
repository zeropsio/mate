import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
/**
 * Multi-environment usage state.
 *
 * Every connected environment answers the same typed query; the client merges
 * the results; one this browser is not connected to is left out, not asked.
 * Raw transcripts never leave the machine that produced them.
 *
 * @module state/usage
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import {
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type UsageSummary,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { mergeUsage, type EnvironmentUsage, type MergedUsage } from "@t3tools/shared/usageMerge";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";
import {
  providerUsageReport,
  mateFeedAtom,
  retainedMateFeedAtom,
  mateFeedReadsAtom,
} from "@t3tools/client-runtime/data";

export interface EnvironmentUsageStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isStale: boolean;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly summary: UsageSummary | null;
}

/** What the window's atom reads: each environment's presentation, and its summary query. */
export interface UsageByWindowSources {
  readonly presentationsAtom: Atom.Atom<
    ReadonlyMap<
      EnvironmentId,
      {
        readonly entry: { readonly target: { readonly label: string } };
        readonly connection: { readonly phase: EnvironmentConnectionPhase };
      }
    >
  >;
  readonly retainedUsageSummary: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: UsageSummaryInput;
  }) => Atom.Atom<Known<UsageSummary>>;
  readonly usageSummary: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: UsageSummaryInput;
  }) => Atom.Atom<Known<UsageSummary>>;
}

/**
 * Reads every connected environment's summary for one window: a Mate this
 * browser holds no socket to is not woken to report.
 *
 * Keyed by the serialised window so switching ranges does not thrash the atom
 * cache, and so each environment's query is shared with any other reader of the
 * same window.
 */
export function createUsageWindowReadAtoms(sources: UsageByWindowSources) {
  return Atom.family((windowKey: string) =>
    Atom.make((get): readonly EnvironmentUsageStatus[] => {
      const { input, permitted } = JSON.parse(windowKey) as {
        input: UsageSummaryInput;
        permitted?: readonly EnvironmentId[];
      };
      const presentations = get(sources.presentationsAtom);

      const statuses: EnvironmentUsageStatus[] = [];
      for (const [environmentId, presentation] of presentations) {
        if (permitted !== undefined && !permitted.includes(environmentId)) continue;
        if (presentation.connection.phase === "error") continue;
        const connected = presentation.connection.phase === "connected";
        const result = get(
          (connected ? sources.usageSummary : sources.retainedUsageSummary)({
            environmentId,
            input,
          }),
        );
        if (!connected && result.state !== "known" && result.state !== "failed") continue;
        statuses.push({
          environmentId,
          label: presentation.entry.target.label,
          ...providerUsageReport(result, connected),
        });
      }
      return statuses;
    }).pipe(Atom.withLabel(`web-usage:window:${windowKey}`)),
  );
}

const providerPricesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const overrides = get(serverEnvironment.configValueAtom(environmentId))?.settings
      .usagePriceOverrides;
    return JSON.stringify(
      overrides == null
        ? []
        : Object.keys(overrides)
            .sort()
            .map((model) => [
              model,
              overrides[model]?.inputCostPerMillionTokens,
              overrides[model]?.outputCostPerMillionTokens,
              overrides[model]?.cacheReadCostPerMillionTokens,
              overrides[model]?.cacheWriteCostPerMillionTokens,
            ]),
    );
  }),
);
const summaryAtom = Atom.family((key: string) => {
  const [environmentId, input] = JSON.parse(key) as [EnvironmentId, UsageSummaryInput];
  const scope = {
    family: "mateUsage" as const,
    environmentId,
    input: input as unknown as Readonly<Record<string, unknown>>,
  };
  const source = mateFeedAtom(scope);
  const invalidation = Atom.make((get) => {
    const prices = get(providerPricesAtom(environmentId));
    const host = get(mateFeedReadsAtom);
    const previous = get.self<string>();
    if (Option.isSome(previous) && previous.value !== prices) host?.revalidate(scope);
    return prices;
  });
  return Atom.make((get) => {
    get(invalidation);
    return get(source);
  });
});
const retainedSummaryAtom = Atom.family((key: string) => {
  const [environmentId, input] = JSON.parse(key) as [
    EnvironmentId,
    Readonly<Record<string, unknown>>,
  ];
  return retainedMateFeedAtom({ family: "mateUsage", environmentId, input });
});
const usageByWindowAtom = createUsageWindowReadAtoms({
  presentationsAtom: environmentPresentations.presentationsAtom,
  retainedUsageSummary: (target) =>
    retainedSummaryAtom(JSON.stringify([target.environmentId, target.input])),
  usageSummary: (target) => summaryAtom(JSON.stringify([target.environmentId, target.input])),
});

export interface UsageView {
  /** The environments the predicate includes, merged. */
  readonly merged: MergedUsage;
  /** Every answered environment, merged: what the scope is chosen from. */
  readonly overall: MergedUsage;
  readonly environments: readonly EnvironmentUsageStatus[];
  /** True until at least one environment has answered. */
  readonly isPending: boolean;
  /**
   * True while environments that have not failed are still answering. Failed
   * environments are reported through their own error rows: totals will not
   * improve by waiting on them, so they must not read as "still reporting".
   */
  readonly isPartial: boolean;
  readonly refresh: () => void;
}

/**
 * `include` narrows `merged` to a scope; it must be stable across renders
 * (memoised) or every render re-merges.
 */
export function useProviderUsage(
  input: UsageSummaryInput,
  include?: (environmentId: EnvironmentId) => boolean,
  permitted?: ReadonlySet<EnvironmentId>,
): UsageView {
  const windowKey = useMemo(
    () =>
      JSON.stringify({
        permitted: permitted === undefined ? undefined : [...permitted].toSorted(),
        input: {
          sinceDay: input.sinceDay,
          untilDay: input.untilDay,
          timeZone: input.timeZone,
          resolution: input.resolution,
          sinceTime: input.sinceTime,
          untilTime: input.untilTime,
        },
      }),
    [
      permitted,
      input.sinceDay,
      input.untilDay,
      input.timeZone,
      input.resolution,
      input.sinceTime,
      input.untilTime,
    ],
  );
  const atom = usageByWindowAtom(windowKey);
  const environments = useAtomValue(atom);

  const refresh = useCallback(() => {
    const host = appAtomRegistry.get(mateFeedReadsAtom);
    const { input } = JSON.parse(windowKey) as { input: Readonly<Record<string, unknown>> };
    for (const environment of environments)
      host?.retry({ family: "mateUsage", environmentId: environment.environmentId, input });
  }, [environments, windowKey]);

  const answered = useMemo(
    (): readonly EnvironmentUsage[] =>
      environments.flatMap((environment) =>
        environment.summary === null
          ? []
          : [
              {
                environmentId: environment.environmentId,
                label: environment.label,
                summary: environment.summary,
              },
            ],
      ),
    [environments],
  );
  const overall = useMemo(() => mergeUsage(answered, USAGE_CONTRACT_VERSION), [answered]);
  const merged = useMemo(
    () => (include === undefined ? overall : mergeUsage(answered, USAGE_CONTRACT_VERSION, include)),
    [answered, include, overall],
  );

  const answeredCount = environments.filter((environment) => environment.summary !== null).length;
  const stillReporting = environments.filter(
    (environment) => environment.summary === null && environment.error === null,
  ).length;

  return {
    merged,
    overall,
    environments,
    isPending: answeredCount === 0 && stillReporting > 0,
    isPartial:
      answeredCount > 0 &&
      environments.some(
        (environment) => environment.isPending || environment.error !== null || environment.isStale,
      ),
    refresh,
  };
}
