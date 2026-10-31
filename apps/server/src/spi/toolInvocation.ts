/** Native execution identity, separate from the model's tool arguments. */
import type { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { makeInstallSlot, type InstallSlot } from "./threadToolPolicy.ts";

export interface ToolInvocationIdentity {
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly sessionId: string;
  readonly messageId: string;
  readonly callId: string;
}

export interface ToolInvocation {
  /** Routing only: a reopened provider thread is not a new native call. */
  readonly threadId: ThreadId;
  readonly identity: ToolInvocationIdentity;
  /** Resolve only after the engine has durably captured this invocation. */
  readonly resolveTurn: () => Effect.Effect<string | undefined>;
}

export interface ToolInvocationResult {
  readonly text: string;
  readonly isError: boolean;
}

export type ToolInvocationExecute = (
  input: unknown,
  invocation: ToolInvocation,
) => Effect.Effect<ToolInvocationResult>;

export interface ToolInvocationExecutor {
  /** Durable identity and authority binding before a native permission wait; no domain effect. */
  readonly prepare: ToolInvocationExecute;
  readonly execute: ToolInvocationExecute;
  /** Actual executable readiness, not a requested profile or a static version claim. */
  readonly ready: Effect.Effect<boolean>;
  readonly invalidateReadiness: Effect.Effect<void>;
}

/** One owned executor, installed only for its actual runtime's lifetime. */
export class ToolInvocationRegistry extends Context.Service<
  ToolInvocationRegistry,
  InstallSlot<ToolInvocationExecutor>
>()("t3/spi/toolInvocation/ToolInvocationRegistry") {
  static readonly layer = Layer.effect(
    ToolInvocationRegistry,
    makeInstallSlot<ToolInvocationExecutor>(),
  );
}
