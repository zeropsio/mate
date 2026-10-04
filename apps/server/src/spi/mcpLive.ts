/**
 * mcpLive — how a running session's MCP servers stand, as its agent reports
 * them, and the nudges that reach it after the MCP tab changed a config.
 *
 * The drivers carry one optional, additive hook (`ProviderAdapterShape.mcp`)
 * built here from the few native calls each agent has, so the mapping and the
 * routing stay owned and a port of a driver only has to keep those calls:
 *
 * - Claude Code: the SDK query's `mcpServerStatus()`, `reconnectMcpServer`,
 *   `toggleMcpServer` (the toggle also persists the project's disabled list).
 *   A server added or removed in a config reaches the next conversation.
 * - Codex: the app-server's `mcpServerStatus/list` for the thread and
 *   `config/mcpServer/reload`, which re-reads `config.toml` — the nudge after
 *   every write, and the closest it has to a reconnect.
 * - OpenCode: its server's `/mcp` status, `connect`, `disconnect`, and `add`
 *   for a server added while it runs.
 * - The ACP agents (Cursor, Grok, Antigravity) carry no hook: `configured`.
 *
 * @module spi/mcpLive
 */
import type { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import {
  type McpConfigChange,
  type McpLiveServer,
  NOT_RUNNING,
  ProviderMcpError,
} from "./mcpControl.ts";

export * from "./mcpControl.ts";

// ── Routing ──────────────────────────────────────────────────────────────

/** The live side of the MCP tab, across every configured provider instance. */
export class McpLive extends Context.Service<
  McpLive,
  {
    /** The thread's running session: its driver and its servers; `undefined` when none runs. */
    readonly status: (
      threadId: ThreadId,
    ) => Effect.Effect<
      | { readonly driver: ProviderDriverKind; readonly servers: ReadonlyArray<McpLiveServer> }
      | undefined
    >;
    readonly reconnect: (threadId: ThreadId, name: string) => Effect.Effect<void, ProviderMcpError>;
    readonly setEnabled: (
      threadId: ThreadId,
      name: string,
      enabled: boolean,
    ) => Effect.Effect<void, ProviderMcpError>;
    /** The drivers installed here, each once: the agents an added server is written for. */
    readonly installedDrivers: Effect.Effect<ReadonlyArray<ProviderDriverKind>>;
    /** Every running session of every instance of `driver`, best effort. */
    readonly configChanged: (
      driver: ProviderDriverKind,
      change: McpConfigChange,
    ) => Effect.Effect<void>;
  }
>()("t3/spi/mcpLive") {}

/** How long a reconnect or a toggle may take before the tab hears it failed. */
const LIVE_CALL_TIMEOUT = "15 seconds";

const answeredInTime = <A>(effect: Effect.Effect<A, ProviderMcpError>) =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: LIVE_CALL_TIMEOUT,
      orElse: () =>
        Effect.fail(new ProviderMcpError({ detail: "the agent did not answer in 15 seconds" })),
    }),
  );

export const layer = Layer.effect(
  McpLive,
  Effect.gen(function* () {
    const registry = yield* ProviderInstanceRegistry;
    const providers = yield* ProviderRegistry;
    const running = Effect.fn("McpLive.running")(function* (threadId: ThreadId) {
      for (const instance of yield* registry.listInstances) {
        if (yield* instance.adapter.hasSession(threadId)) return instance;
      }
      return undefined;
    });
    const hookOf = (threadId: ThreadId) =>
      running(threadId).pipe(
        Effect.flatMap((instance) =>
          instance?.adapter.mcp === undefined
            ? Effect.fail(NOT_RUNNING)
            : Effect.succeed(instance.adapter.mcp),
        ),
      );
    return {
      status: (threadId) =>
        Effect.gen(function* () {
          const instance = yield* running(threadId);
          const hook = instance?.adapter.mcp;
          if (instance === undefined || hook === undefined) return undefined;
          const servers = yield* hook.status(threadId);
          return servers === undefined ? undefined : { driver: instance.driverKind, servers };
        }),
      reconnect: (threadId, name) =>
        hookOf(threadId).pipe(
          Effect.flatMap((hook) => answeredInTime(hook.reconnect(threadId, name))),
        ),
      setEnabled: (threadId, name, enabled) =>
        hookOf(threadId).pipe(
          Effect.flatMap((hook) => answeredInTime(hook.setEnabled(threadId, name, enabled))),
        ),
      installedDrivers: providers.getProviders.pipe(
        Effect.map((snapshots) => [
          ...new Set(snapshots.filter((snapshot) => snapshot.installed).map((s) => s.driver)),
        ]),
      ),
      configChanged: (driver, change) =>
        registry.listInstances.pipe(
          Effect.flatMap((instances) =>
            Effect.forEach(
              instances.filter((instance) => instance.driverKind === driver),
              (instance) => instance.adapter.mcp?.configChanged(change) ?? Effect.void,
              { concurrency: "unbounded", discard: true },
            ),
          ),
        ),
    } satisfies McpLive["Service"];
  }),
);
