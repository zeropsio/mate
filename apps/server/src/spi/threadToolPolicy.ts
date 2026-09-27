/**
 * threadToolPolicy — the provider-neutral thread tool policy SPI.
 *
 * One of the two files the ported zone may import from `spi/` (the other is
 * `claudeThreadProfile.ts`); neither imports anything from `provider/**`, so
 * the two directories never import each other. A driver asks the installed
 * policy for a thread's profile when it starts a session: none installed, or
 * no profile for the thread, and the driver runs exactly as it would without
 * this file.
 *
 * A profile carries what a gated thread runs with: the context appended to
 * the system prompt, the context window, an optional spend cap, optional
 * model and effort overrides, a per-call tool decision, and in-process tools.
 * Each driver translates it; Claude's translation is `claudeThreadProfile.ts`.
 *
 * @module threadToolPolicy
 */
import type { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as JsonSchema from "effect/JsonSchema";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";

export type ToolDecision =
  | { readonly kind: "allow"; readonly updatedInput?: Record<string, unknown> }
  | { readonly kind: "deny"; readonly reason: string };

export interface ThreadTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema.JsonSchema;
  readonly run: (
    input: unknown,
  ) => Effect.Effect<{ readonly text: string; readonly isError: boolean }>;
}

export interface ThreadToolProfile {
  /** Appended after the driver's own runtime instructions. */
  readonly sessionContext: string;
  /** Tokens; each driver maps it (Claude: `autoCompactWindow`). */
  readonly contextWindow: number;
  readonly maxBudgetUsd?: number;
  /**
   * Model slug as `ModelSelection.model` carries it. Applied when the
   * session starts and again on every turn, so a change takes effect at the
   * thread's next turn without a new conversation.
   */
  readonly model?: string;
  /** The effort option's value; applies only when a model is known. */
  readonly effort?: string;
  /**
   * The thread never changes files. Its gate refuses every write either
   * way; a driver with a sandbox also runs the thread in a read-only one.
   */
  readonly readOnly?: boolean;
  /**
   * How to write calls so the gate allows them as they are, for a driver
   * that cannot run a call the gate rewrote (Codex answers an approval with
   * a decision only). Such a driver adds it after `sessionContext`.
   */
  readonly exactCallsContext?: string;
  readonly decideTool: (call: {
    readonly toolName: string;
    readonly input: unknown;
    readonly toolUseId: string;
  }) => Effect.Effect<ToolDecision>;
  readonly tools: ReadonlyArray<ThreadTool>;
}

export interface ThreadToolPolicy {
  readonly profileFor: (thread: {
    readonly threadId: ThreadId;
    readonly instanceId: ProviderInstanceId;
    readonly cwd?: string;
  }) => Effect.Effect<ThreadToolProfile | undefined>;
}

export interface InstallSlot<P> {
  /** Makes `entry` current for the life of the caller's scope; a later install wins. */
  readonly install: (entry: P) => Effect.Effect<void, never, Scope.Scope>;
  readonly current: Effect.Effect<Option.Option<P>>;
}

/**
 * The one-entry slot behind both registries. Closing an install's scope
 * clears the slot only while that entry is still the current one, so an
 * earlier install's release never removes a later one.
 */
export const makeInstallSlot = <P>(): Effect.Effect<InstallSlot<P>> =>
  Effect.map(Ref.make(Option.none<P>()), (slot) => ({
    install: (entry) =>
      Effect.acquireRelease(Ref.set(slot, Option.some(entry)), () =>
        Ref.update(slot, (current) =>
          Option.isSome(current) && current.value === entry ? Option.none() : current,
        ),
      ),
    current: Ref.get(slot),
  }));

/** A thread's profile, from whatever policy is installed now; none installed means none. */
export const threadProfileFor = (
  policies: Option.Option<InstallSlot<ThreadToolPolicy>>,
  thread: Parameters<ThreadToolPolicy["profileFor"]>[0],
): Effect.Effect<ThreadToolProfile | undefined> =>
  Option.isNone(policies)
    ? Effect.succeed(undefined)
    : Effect.flatMap(policies.value.current, (policy) =>
        Option.isNone(policy) ? Effect.succeed(undefined) : policy.value.profileFor(thread),
      );

export class ThreadToolPolicyRegistry extends Context.Service<
  ThreadToolPolicyRegistry,
  InstallSlot<ThreadToolPolicy>
>()("t3/spi/threadToolPolicy/ThreadToolPolicyRegistry") {
  static readonly layer = Layer.effect(
    ThreadToolPolicyRegistry,
    makeInstallSlot<ThreadToolPolicy>(),
  );
}
