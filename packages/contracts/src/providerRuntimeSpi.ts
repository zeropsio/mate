/**
 * The provider runtime SPI — the declared contract between the ported
 * driver zone (`apps/server/src/provider/**`, `./provider*.ts` in this
 * package) and everything owned that consumes provider events
 * (`apps/server/src/spi/**` and, through it, the Zerops feeds).
 *
 * This module re-exports the event union rather than moving or renaming it:
 * `./providerRuntime.ts` stays upstream's file, edited on every port; this
 * file is the one owned place that names a version for what that union
 * currently guarantees, plus the owned enrichment `apps/server/src/spi/`
 * adds on top of it.
 *
 * SPI changelog:
 * - 2.0 (2026-08-29, SPI-1): declared. Surface = `ProviderRuntimeEventV2`
 *   (49 `type`-discriminated members) + the `streamEvents` port. No typed
 *   `toolCall` view yet (SPI-4); no versioned adapter gate reads this
 *   constant yet — it exists so a later slice has one to check against.
 * - 2.1 (2026-08-29, SPI-4): every `SpiEvent` the bus emits now carries an
 *   optional `toolCall: SpiToolCall`, populated on `item.started` /
 *   `item.updated` / `item.completed` when the driver's `payload.data`
 *   shape is recognized (`apps/server/src/spi/toolCall.ts`) — ANY tool, not
 *   only a `zerops_*` one. A tool-lifecycle item
 *   (`isToolLifecycleItemType(payload.itemType)`) whose shape is NOT
 *   recognized never resolves to a silent `undefined`: the bus also exposes
 *   `enrichmentFailures: Stream<SpiEnrichmentFailure>` and logs a warning,
 *   once per (provider, itemType, reason) signature
 *   (`apps/server/src/spi/ProviderRuntimeEventBus.ts`). Owned code under
 *   `apps/server/src/zerops/**` reads `event.toolCall` only — it never reads
 *   `payload.data` again.
 * - (no version bump, 2026-08-29, SPI-5): `apps/server/src/spi/driverHomes.ts`,
 *   `driverLaunch.ts`, `acpSupport.ts`, `openCodeRuntime.ts`, and
 *   `claudeProvider.ts` add small owned, typed capabilities (each with a
 *   contract test) wrapping the driver-internal filesystem/home-dir,
 *   launch-arg, ACP session, and model/effort surfaces `textGeneration/**`
 *   and `usage/**` previously imported from `provider/**` directly. Additive
 *   server-side wrapping only — `ProviderRuntimeEventV2` is unchanged.
 * - 2.2 (2026-09-04, S8b): `SpiToolCall.result` gains an optional `images`
 *   array (`apps/server/src/spi/toolCall.ts`'s `readContentText`-adjacent
 *   image reader), read from the MCP result's `{type: "image", mimeType,
 *   data}` content blocks — the `zerops_browser` screenshot is the first
 *   consumer. One image over 256 KB of base64 is dropped rather than
 *   truncated (`imagesDropped: true` records that it happened); the existing
 *   48 KB `resultText` cap is unaffected — the two caps are independent.
 *   Additive: a reader that does not know about `images` still gets `text`
 *   exactly as before.
 *
 * @module providerRuntimeSpi
 */
import type { EventId } from "./baseSchemas.ts";
import type { ProviderDriverKind } from "./providerInstance.ts";
import type { CanonicalItemType, ProviderRuntimeEvent } from "./providerRuntime.ts";

/**
 * The current SPI version. Bump this — and add a changelog entry above —
 * whenever a change to `ProviderRuntimeEventV2` (or the owned `toolCall`
 * enrichment) changes what owned code may depend on (a new member, a
 * renamed field, a narrowed payload shape).
 */
export const PROVIDER_RUNTIME_SPI_VERSION = "2.2";

/**
 * One image content block an MCP tool result carried, e.g. a
 * `zerops_browser` screenshot. `data` is base64, capped at 256 KB — a larger
 * image is dropped, never truncated (see {@link SpiToolCall.result}'s
 * `imagesDropped`). `width`/`height` are the block's own device-pixel
 * dimensions when the tool reported them; absent otherwise.
 */
export interface SpiToolCallImage {
  readonly mimeType: string;
  readonly data: string;
  readonly width?: number;
  readonly height?: number;
}

/**
 * The generic view of one tool call an item lifecycle payload's
 * driver-specific `data` describes — ANY tool, not only a `zerops_*` one.
 *
 * `name` has the `mcp__<server>__` prefix stripped when the driver reports
 * one that way (Claude embeds it in the wire name); `server` is that
 * prefix's middle segment, or the driver's separate server field (Codex),
 * when the call went through MCP — absent for a driver-native tool (Claude's
 * Bash, a subagent Task, ...). `result` is present once the call has
 * returned; absent on `item.started` and on an `item.updated` still in
 * flight.
 */
export interface SpiToolCall {
  readonly name: string;
  readonly rawName: string;
  readonly server?: string;
  readonly arguments?: unknown;
  readonly result?: {
    readonly text: string;
    readonly failed: boolean;
    /** Image content blocks the result carried, each under the 256 KB cap. Absent when none did. */
    readonly images?: ReadonlyArray<SpiToolCallImage>;
    /** `true` when at least one image content block was dropped for exceeding the cap. */
    readonly imagesDropped?: boolean;
  };
}

/**
 * The event type owned code depends on. `toolCall` is owned enrichment
 * (`apps/server/src/spi/toolCall.ts`) layered on top of what the driver
 * itself emits — populated by the bus, never decoded from `payload.data` by
 * anything outside that one file.
 */
export type SpiEvent = ProviderRuntimeEvent & { readonly toolCall?: SpiToolCall };

/**
 * Reported on the bus's `enrichmentFailures` side channel (and logged, once
 * per (provider, itemType, reason) signature) when an item the driver marked
 * as a tool (`isToolLifecycleItemType(payload.itemType)`) carries a `data`
 * shape `apps/server/src/spi/toolCall.ts` does not recognize — the signal
 * that a ported driver changed a tool-call shape and stopped reaching
 * `event.toolCall`, instead of that happening silently.
 */
export interface SpiEnrichmentFailure {
  readonly eventId: EventId;
  readonly provider: ProviderDriverKind;
  readonly itemType: CanonicalItemType;
  readonly reason: string;
}
