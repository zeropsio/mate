/**
 * The engine's `ProviderUsageFeed` from the provider registry: what each instance's last probe
 * read of the account it is signed in to. An instance reports only while signed in and with its
 * windows read; a probe that failed, or an account that keeps no windows, says nothing of a limit.
 *
 * @module engineProviderUsage
 */
import type { ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ProviderUsageFeed, type InstanceUsage } from "./engine/ports.ts";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";

const millis = (iso: string | undefined): number | null => {
  if (iso === undefined) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
};

/** One instance's usage as the engine reads it, or none when its snapshot cannot say. */
export const usageReportOf = (provider: ServerProvider): InstanceUsage | undefined => {
  const limits = provider.usageLimits;
  if (provider.auth.status !== "authenticated" || limits === undefined) return undefined;
  if (limits.unavailable !== undefined || limits.windows.length === 0) return undefined;
  const checkedAt = millis(limits.checkedAt);
  if (checkedAt === null) return undefined;
  return {
    instanceId: provider.instanceId,
    usage: {
      checkedAt,
      windows: limits.windows.map((window) => ({
        usedPercent: window.usedPercent,
        resetsAt: millis(window.resetsAt),
      })),
    },
  };
};

const reportsOf = (providers: ReadonlyArray<ServerProvider>): ReadonlyArray<InstanceUsage> =>
  providers.flatMap((provider) => {
    const report = usageReportOf(provider);
    return report === undefined ? [] : [report];
  });

export const serverProviderUsage = Layer.effect(
  ProviderUsageFeed,
  Effect.map(ProviderRegistry, (registry) =>
    ProviderUsageFeed.of({
      reports: Stream.concat(Stream.fromEffect(registry.getProviders), registry.streamChanges).pipe(
        Stream.map(reportsOf),
      ),
    }),
  ),
);
