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
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { mergeUsage, type EnvironmentUsage, type MergedUsage } from "@t3tools/shared/usageMerge";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

export interface EnvironmentUsageStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isStale?: boolean;
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
  readonly usageSummary: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: UsageSummaryInput;
  }) => Atom.Atom<AsyncResult.AsyncResult<UsageSummary, unknown>>;
}

/**
 * Reads every connected environment's summary for one window: a Mate this
 * browser holds no socket to is not woken to report.
 *
 * Keyed by the serialised window so switching ranges does not thrash the atom
 * cache, and so each environment's query is shared with any other reader of the
 * same window.
 */
export function createUsageByWindowAtomFamily(sources: UsageByWindowSources) {
  return Atom.family((windowKey: string) =>
    Atom.make((get): readonly EnvironmentUsageStatus[] => {
      const { input, permitted } = JSON.parse(windowKey) as {
        input: UsageSummaryInput;
        permitted?: readonly EnvironmentId[];
      };
      const previous = Option.getOrNull(get.self<readonly EnvironmentUsageStatus[]>()) ?? [];
      const presentations = get(sources.presentationsAtom);

      const statuses: EnvironmentUsageStatus[] = [];
      for (const [environmentId, presentation] of presentations) {
        if (permitted !== undefined && !permitted.includes(environmentId)) continue;
        if (presentation.connection.phase !== "connected") {
          const retained = previous.find((status) => status.environmentId === environmentId);
          if (
            retained?.summary !== null &&
            retained?.summary !== undefined &&
            presentation.connection.phase !== "error"
          ) {
            statuses.push({ ...retained, isPending: false, isStale: true });
          }
          continue;
        }
        const result = get(sources.usageSummary({ environmentId, input }));
        statuses.push({
          environmentId,
          label: presentation.entry.target.label,
          isPending: result.waiting,
          error: result._tag === "Failure" ? "This environment could not report usage." : null,
          summary: Option.getOrNull(AsyncResult.value(result)),
        });
      }
      return statuses;
    }).pipe(Atom.withLabel(`web-usage:window:${windowKey}`)),
  );
}

const usageByWindowAtom = createUsageByWindowAtomFamily({
  presentationsAtom: environmentPresentations.presentationsAtom,
  usageSummary: serverEnvironment.usageSummary,
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
export function useUsage(
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

  // Refreshing only the derived atom would re-read the per-environment SWR
  // queries within their stale window and change nothing. Refresh each
  // environment's query so the button always rescans.
  const refresh = useCallback(() => {
    const { input } = JSON.parse(windowKey) as { input: UsageSummaryInput };
    for (const environment of environments) {
      appAtomRegistry.refresh(
        serverEnvironment.usageSummary({ environmentId: environment.environmentId, input }),
      );
    }
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
    isPartial: answeredCount > 0 && stillReporting > 0,
    refresh,
  };
}
