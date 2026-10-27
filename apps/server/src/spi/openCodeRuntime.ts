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
 * shapes — it only sees `OpenCodeRuntimeCapability`/`OpenCodeServerOwnerCapability`,
 * so a driver-side rename/removal of a member it doesn't use fails
 * `openCodeRuntime.test.ts`, not the text-generation spawn/prompt call sites.
 *
 * The three parsing/formatting helpers below (`openCodeRuntimeErrorDetail`,
 * `parseOpenCodeModelSlug`, `toOpenCodeFileParts`) are pure logic the driver
 * owns; they're wrapped the same way as the other SPI capability modules.
 *
 * @module openCodeRuntime
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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

// Re-exported as a value (not just a type) so a test double outside the
// ported zone can construct a real failure — `Effect.catchTags` and the
// capability's declared error channel both key off this class's identity,
// not just its `_tag` string, so a plain `{ _tag: "OpenCodeRuntimeError" }`
// object literal does not satisfy `OpenCodeRuntimeCapability`'s types.
export { OpenCodeRuntimeError };
export type { ParsedOpenCodeModelSlug };

/** A running (owned or externally-managed) OpenCode server connection. */
export interface OpenCodeServerConnection {
  readonly url: string;
  readonly serverPassword?: string;
  readonly version: string;
}

/** The narrow OpenCode capability `OpenCodeTextGeneration.ts` depends on. */
export interface OpenCodeRuntimeCapability {
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
 * A test double factory: serves a caller-supplied fake `OpenCodeRuntimeCapability`
 * by satisfying the real `OpenCodeRuntime.OpenCodeRuntime` tag underneath it (the
 * four members `OpenCodeTextGeneration.ts` never calls die loudly if exercised —
 * an unexpected new dependency on one of them fails fast instead of silently
 * succeeding). For a test that builds `makeOpenCodeTextGeneration` directly and
 * needs its R channel satisfied without standing up the real OpenCode driver.
 */
export const OpenCodeRuntimeCapabilityTest = {
  make: (capability: OpenCodeRuntimeCapability): Layer.Layer<OpenCodeRuntime> =>
    Layer.succeed(OpenCodeRuntime, {
      startOpenCodeServerProcess: () =>
        Effect.die(
          "OpenCodeRuntimeCapabilityTest double: startOpenCodeServerProcess not configured",
        ),
      // `exitCode`/`external` are unused by `OpenCodeRuntimeCapability` (they only
      // matter to `OpenCodeServerOwner`'s real lifecycle management); placeholder
      // values here keep the fake satisfying the driver's full shape.
      connectToOpenCodeServer: (input) =>
        Effect.map(capability.connectToOpenCodeServer(input), (connection) => ({
          ...connection,
          exitCode: null,
          external: true,
        })),
      createOpenCodeSdkClient: capability.createOpenCodeSdkClient,
      runOpenCodeCommand: () =>
        Effect.die("OpenCodeRuntimeCapabilityTest double: runOpenCodeCommand not configured"),
      loadOpenCodeInventory: () =>
        Effect.die("OpenCodeRuntimeCapabilityTest double: loadOpenCodeInventory not configured"),
      loadOpenCodeSkills: () =>
        Effect.die("OpenCodeRuntimeCapabilityTest double: loadOpenCodeSkills not configured"),
      loadInventoryFromCli: () =>
        Effect.die("OpenCodeRuntimeCapabilityTest double: loadInventoryFromCli not configured"),
      loadSkillsFromCli: () =>
        Effect.die("OpenCodeRuntimeCapabilityTest double: loadSkillsFromCli not configured"),
    } satisfies OpenCodeRuntime["Service"]),
};

/**
 * The narrow shared-local-server-lifecycle capability `OpenCodeTextGeneration.ts`
 * depends on for the (non-externally-configured) local server path — one lazy
 * server per provider instance, borrowed for the duration of `use` and released
 * (and, once idle, closed) afterward. Wraps `provider/OpenCodeServerOwner.ts`'s
 * `withServer`.
 */
export interface OpenCodeServerOwnerCapability {
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

/** A test double factory for `openCodeServerOwnerCapability`, mirroring `OpenCodeRuntimeCapabilityTest`. */
export const OpenCodeServerOwnerCapabilityTest = {
  make: (capability: OpenCodeServerOwnerCapability): Layer.Layer<OpenCodeServerOwner> =>
    Layer.succeed(OpenCodeServerOwner, {
      // `isRunning`/`exitCode` are unused by `OpenCodeServerOwnerCapability` (they
      // only matter to the real owner's own reuse/idle-close bookkeeping);
      // placeholder values here keep the fake satisfying the driver's full shape.
      withServer: (use) =>
        capability.withServer((connection) =>
          use({ ...connection, isRunning: Effect.succeed(true), exitCode: Effect.never }),
        ),
    }),
};

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
