import type { ServerConfig, ServerConfigStreamEvent } from "@t3tools/contracts";
import * as Option from "effect/Option";

export interface ServerConfigProjection {
  readonly config: ServerConfig;
  readonly latestEvent: ServerConfigStreamEvent;
  readonly source: "cache" | "live";
}

/**
 * Cached config keeps the provider and model catalog available across reconnects.
 * Usage-limit sources are current machine state, so a cache could restore a
 * set the machine no longer reports. Replay sends it as a separate event.
 */
export function withoutUsageLimitSources(config: ServerConfig): ServerConfig {
  if (config.usageLimitSources === undefined) return config;
  const { usageLimitSources: _sources, ...rest } = config;
  return rest;
}

export function applyServerConfigProjection(
  current: Option.Option<ServerConfigProjection>,
  event: ServerConfigStreamEvent,
): Option.Option<ServerConfigProjection> {
  switch (event.type) {
    case "snapshot": {
      // Wire snapshots never contain usage-limit sources. Keep the previous
      // set until a capable server sends its authoritative update. A legacy
      // server cannot send a later removal, so a downgrade must clear the set.
      const carriedSources =
        event.config.environment.capabilities.usageLimitSources === true && Option.isSome(current)
          ? current.value.config.usageLimitSources
          : undefined;
      return Option.some({
        config:
          carriedSources === undefined
            ? event.config
            : { ...event.config, usageLimitSources: carriedSources },
        latestEvent: event,
        source: "live" as const,
      });
    }
    case "keybindingsUpdated":
      return Option.map(current, (projection) => ({
        config: {
          ...projection.config,
          keybindings: event.payload.keybindings,
          issues: event.payload.issues,
        },
        latestEvent: event,
        source: "live",
      }));
    case "providerStatuses":
      return Option.map(current, (projection) => ({
        config: {
          ...projection.config,
          providers: event.payload.providers,
        },
        latestEvent: event,
        source: "live",
      }));
    case "settingsUpdated":
      return Option.map(current, (projection) => ({
        config: {
          ...projection.config,
          settings: event.payload.settings,
        },
        latestEvent: event,
        source: "live",
      }));
    case "usageLimitSourcesUpdated":
      return Option.map(current, (projection) => ({
        config: {
          ...projection.config,
          usageLimitSources: event.payload.sources.length > 0 ? event.payload.sources : undefined,
        },
        latestEvent: event,
        source: "live",
      }));
  }
}
