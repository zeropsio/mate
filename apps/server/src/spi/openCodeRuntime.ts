/**
 * openCodeRuntime — the owned, narrow OpenCode capability
 * `textGeneration/OpenCodeTextGeneration.ts` uses, cut down from the
 * driver's full `OpenCodeRuntimeShape` (`provider/opencodeRuntime.ts`,
 * 8 members: server lifecycle, CLI passthrough, and inventory/skill loading)
 * plus the shared local-server lifecycle owner (`provider/OpenCodeServerOwner.ts`,
 * a per-instance `Context.Service` the driver constructs and provides).
 * `OpenCodeTextGeneration.ts` only ever connects to an externally-configured
 * server (`connectToOpenCodeServer`), borrows the shared local server
 * (`openCodeServerOwnerCapability`'s `withServer`), and talks to either over
 * the SDK client (`createOpenCodeSdkClient`) — the other five driver members
 * (`startOpenCodeServerProcess`, `runOpenCodeCommand`, `loadOpenCodeInventory`,
 * `loadOpenCodeSkills`, `loadInventoryFromCli`, `loadSkillsFromCli`) serve
 * other callers (the shared server owner spawns its own process directly
 * from the ported zone; the OpenCode provider check loads inventory/skills)
 * and are deliberately NOT part of this capability.
 *
 * `openCodeRuntimeCapability` is an Effect whose R channel is still exactly
 * `OpenCodeRuntime.OpenCodeRuntime` (the driver's own Context.Service tag) —
 * unchanged so that `provider/Drivers/OpenCodeDriver.ts` (ported zone, not
 * touched by this slice) keeps providing it via `OpenCodeRuntimeLive` with
 * zero changes. `openCodeServerOwnerCapability` is likewise keyed on the
 * driver's own `OpenCodeServerOwner.OpenCodeServerOwner` tag, which the
 * driver constructs per instance (`OpenCodeServerOwner.make`, bound to that
 * instance's binary path/directory/password) and provides alongside the
 * runtime tag. What's owned in both cases is the NARROWING:
 * `OpenCodeTextGeneration.ts` never names either driver tag or their full
 * shapes — it only sees `OpenCodeRuntimeCapability`/`OpenCodeServerOwnerCapability`.
 *
 * The three parsing/formatting helpers below (`openCodeRuntimeErrorDetail`,
 * `parseOpenCodeModelSlug`, `toOpenCodeFileParts`) are pure logic the driver
 * owns; they're wrapped the same way as the other SPI capability modules.
 *
 * @module openCodeRuntime
 */
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import {
  OpenCodeRuntime,
  OpenCodeRuntimeError,
  openCodeRuntimeErrorDetail as driverOpenCodeRuntimeErrorDetail,
  parseOpenCodeModelSlug as driverParseOpenCodeModelSlug,
  toOpenCodeFileParts as driverToOpenCodeFileParts,
  type ParsedOpenCodeModelSlug,
} from "../provider/opencodeRuntime.ts";
import { OpenCodeServerOwner } from "../provider/OpenCodeServerOwner.ts";

export type { ParsedOpenCodeModelSlug };

/** A running (owned or externally-managed) OpenCode server connection. */
export interface OpenCodeServerConnection {
  readonly url: string;
  readonly serverPassword?: string;
  readonly version: string;
}

/** The narrow OpenCode capability `OpenCodeTextGeneration.ts` depends on. */
interface OpenCodeRuntimeCapability {
  /**
   * Connects to an externally-configured OpenCode server. Callers format the
   * error via `openCodeRuntimeErrorDetail` rather than narrowing on
   * `OpenCodeRuntimeError`'s tag/fields directly.
   */
  readonly connectToOpenCodeServer: (input: {
    readonly binaryPath: string;
    readonly directory: string;
    readonly serverUrl?: string | null;
    readonly serverPassword?: string;
  }) => Effect.Effect<OpenCodeServerConnection, OpenCodeRuntimeError, Scope.Scope>;

  /** Builds an OpenCode SDK client bound to a running server's base URL. */
  readonly createOpenCodeSdkClient: (input: {
    readonly baseUrl: string;
    readonly directory: string;
    readonly serverPassword?: string;
  }) => OpencodeClient;
}

function narrowServerConnection(connection: {
  readonly url: string;
  readonly serverPassword?: string;
  readonly version: string;
}): OpenCodeServerConnection {
  return {
    url: connection.url,
    ...(connection.serverPassword !== undefined
      ? { serverPassword: connection.serverPassword }
      : {}),
    version: connection.version,
  };
}

function toOpenCodeRuntimeCapability(shape: OpenCodeRuntime["Service"]): OpenCodeRuntimeCapability {
  return {
    connectToOpenCodeServer: (input) =>
      Effect.map(shape.connectToOpenCodeServer(input), narrowServerConnection),
    createOpenCodeSdkClient: shape.createOpenCodeSdkClient,
  };
}

/** Resolves the narrow OpenCode capability from the driver's runtime service. */
export const openCodeRuntimeCapability: Effect.Effect<
  OpenCodeRuntimeCapability,
  never,
  OpenCodeRuntime
> = Effect.map(OpenCodeRuntime, toOpenCodeRuntimeCapability);

/**
 * The narrow shared-local-server-lifecycle capability `OpenCodeTextGeneration.ts`
 * depends on for the (non-externally-configured) local server path — one lazy
 * server per provider instance, borrowed for the duration of `use` and released
 * (and, once idle, closed) afterward. Wraps `provider/OpenCodeServerOwner.ts`'s
 * `withServer`.
 */
interface OpenCodeServerOwnerCapability {
  readonly withServer: <A, E, R>(
    use: (server: OpenCodeServerConnection) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | OpenCodeRuntimeError, R>;
}

/** Resolves the shared local-server-owner capability from its driver-provided service. */
export const openCodeServerOwnerCapability: Effect.Effect<
  OpenCodeServerOwnerCapability,
  never,
  OpenCodeServerOwner
> = Effect.map(OpenCodeServerOwner, (shape) => ({
  withServer: (use) => shape.withServer((server) => use(narrowServerConnection(server))),
}));

/** Formats an OpenCode runtime/SDK failure cause into a display-ready detail string. */
export function openCodeRuntimeErrorDetail(cause: unknown): string {
  return driverOpenCodeRuntimeErrorDetail(cause);
}

/** Parses a `provider/model` slug; `null` when the slug is missing or malformed. */
export function parseOpenCodeModelSlug(
  slug: string | null | undefined,
): ParsedOpenCodeModelSlug | null {
  return driverParseOpenCodeModelSlug(slug);
}

/** Converts eligible chat attachments into OpenCode's native file parts. */
export function toOpenCodeFileParts(
  input: Parameters<typeof driverToOpenCodeFileParts>[0],
): ReturnType<typeof driverToOpenCodeFileParts> {
  return driverToOpenCodeFileParts(input);
}
