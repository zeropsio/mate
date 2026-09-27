/**
 * claudeThreadProfile — the Claude extension of the thread tool policy SPI.
 *
 * The second of the two files the ported zone may import from `spi/`; like
 * `threadToolPolicy.ts` it imports nothing from `provider/**`. It holds what
 * only Claude has — settings, the SessionStart and PostCompact hooks — and,
 * from a thread's profile and extension, the options the Claude adapter
 * adds to its session. Codex gets its own extension file.
 *
 * @module claudeThreadProfile
 */
import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { type InstallSlot, makeInstallSlot } from "./threadToolPolicy.ts";

export interface ClaudeThreadExtension {
  readonly settings: { readonly autoMemoryEnabled: false; readonly disableAllHooks: false };
  /** The returned text becomes the session's `additionalContext`. */
  readonly onSessionStart: (event: {
    readonly source: "startup" | "resume" | "compact" | "clear";
    readonly sessionId: string;
    readonly transcriptPath: string;
  }) => Effect.Effect<string | undefined>;
  readonly onPostCompact: (event: { readonly summary: string }) => Effect.Effect<void>;
}

export interface ClaudeThreadExtensions {
  readonly extensionFor: (threadId: ThreadId) => Effect.Effect<ClaudeThreadExtension | undefined>;
}

export class ClaudeThreadExtensionRegistry extends Context.Service<
  ClaudeThreadExtensionRegistry,
  InstallSlot<ClaudeThreadExtensions>
>()("t3/spi/claudeThreadProfile/ClaudeThreadExtensionRegistry") {
  static readonly layer = Layer.effect(
    ClaudeThreadExtensionRegistry,
    makeInstallSlot<ClaudeThreadExtensions>(),
  );
}
