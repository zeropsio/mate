/**
 * mcpControl — the one hook a driver carries for the MCP tab
 * (`ProviderAdapterShape.mcp`), built from the few native calls each agent
 * has; the routing across instances is `mcpLive.ts`.
 *
 * - Claude Code: the SDK query's `mcpServerStatus()`, `reconnectMcpServer`,
 *   `toggleMcpServer` (the toggle also persists the project's disabled list).
 *   A server added or removed in a config reaches the next conversation.
 * - Codex: the app-server's `mcpServerStatus/list` for the thread and
 *   `config/mcpServer/reload`, which re-reads `config.toml`.
 * - OpenCode: its server's `/mcp` status, `connect`, `disconnect`, and `add`
 *   for a server added while it runs.
 * - The ACP agents (Cursor, Grok, Antigravity) carry no hook: `configured`.
 *
 * One of the inbound SPI files (`spi.md` §1a): it imports nothing from
 * `provider/**`, so the drivers can import it.
 *
 * @module spi/mcpControl
 */
import type { McpServerState, McpServerTool, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export interface McpLiveServer {
  readonly name: string;
  readonly state: McpServerState;
  readonly error?: string;
  readonly tools?: ReadonlyArray<McpServerTool>;
}

/** A config change the MCP tab just wrote, as one agent's running sessions should see it. */
export type McpConfigChange =
  | {
      readonly kind: "added";
      readonly name: string;
      /** The server as this agent's config holds it. */
      readonly entry: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: "removed"; readonly name: string }
  | { readonly kind: "enabled"; readonly name: string; readonly enabled: boolean };

export class ProviderMcpError extends Schema.TaggedError<ProviderMcpError>()("ProviderMcpError", {
  detail: Schema.String,
}) {}

/** The hook a driver's adapter carries (`ProviderAdapterShape.mcp`). */
export interface ProviderAdapterMcp {
  /** The thread's running session's servers; `undefined` when it has none running. */
  readonly status: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<McpLiveServer> | undefined>;
  readonly reconnect: (threadId: ThreadId, name: string) => Effect.Effect<void, ProviderMcpError>;
  readonly setEnabled: (
    threadId: ThreadId,
    name: string,
    enabled: boolean,
  ) => Effect.Effect<void, ProviderMcpError>;
  /** Best effort, every running session of the adapter. */
  readonly configChanged: (change: McpConfigChange) => Effect.Effect<void>;
}

const detailOf = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  if (typeof cause === "object" && cause !== null && "detail" in cause) {
    return String((cause as { detail: unknown }).detail);
  }
  return String(cause);
};

const fromPromise = <A>(run: () => Promise<A>): Effect.Effect<A, ProviderMcpError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new ProviderMcpError({ detail: detailOf(cause) }),
  });

const asMcpError = <A>(effect: Effect.Effect<A, Error>): Effect.Effect<A, ProviderMcpError> =>
  effect.pipe(Effect.mapError((cause) => new ProviderMcpError({ detail: detailOf(cause) })));

/**
 * One running session as a hook sees it. A `profiled` one runs a thread tool
 * profile (a crewmate): its MCP servers are the profile's, so no MCP tab
 * press or config change ever reaches it — a Codex reload would re-read
 * `config.toml` and bring zcp's server back past the profile's override.
 * Sessions with one `shareKey` share their MCP connections (one OpenCode
 * server): a change reaches one of them.
 */
export interface McpSession<R> {
  readonly runtime: R;
  readonly profiled: boolean;
  readonly shareKey?: unknown;
}

/** A crewmate's conversation: the MCP tab neither reconnects nor toggles its servers. */
export const CREW_KEEPS_MCP = new ProviderMcpError({
  detail: "A crewmate's tools are the crew's to set; its MCP servers can't be changed here.",
});

/** The sessions a config change reaches: none that is profiled, one per shared connection. */
const unprofiled = <R>(sessions: ReadonlyArray<McpSession<R>>): ReadonlyArray<R> => {
  const reached = new Map<unknown, R>();
  for (const session of sessions) {
    if (session.profiled) continue;
    const key = session.shareKey ?? session.runtime;
    if (!reached.has(key)) reached.set(key, session.runtime);
  }
  return [...reached.values()];
};

/** The thread's session for a press: none running, or a crewmate's, refuses. */
const pressable = <R>(session: McpSession<R> | undefined): Effect.Effect<R, ProviderMcpError> =>
  session === undefined
    ? Effect.fail(NOT_RUNNING)
    : session.profiled
      ? Effect.fail(CREW_KEEPS_MCP)
      : Effect.succeed(session.runtime);

/** No running session: no live state, and nothing to reconnect. */
export const NOT_RUNNING = new ProviderMcpError({
  detail: "No conversation is running on this agent.",
});

const ALL_LIVE_TIMEOUT = "5 seconds";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

function toolOf(
  name: unknown,
  description: unknown,
  annotations: unknown,
): McpServerTool | undefined {
  const toolName = optionalString(name)?.trim();
  if (toolName === undefined) return undefined;
  const notes = isRecord(annotations) ? annotations : {};
  const readOnly = notes["readOnly"] ?? notes["readOnlyHint"];
  const destructive = notes["destructive"] ?? notes["destructiveHint"];
  const text = optionalString(description);
  return {
    name: toolName,
    ...(text !== undefined ? { description: text } : {}),
    ...(typeof readOnly === "boolean" ? { readOnly } : {}),
    ...(typeof destructive === "boolean" ? { destructive } : {}),
  };
}

const definedTools = (tools: ReadonlyArray<McpServerTool | undefined>): McpServerTool[] =>
  tools.filter((tool): tool is McpServerTool => tool !== undefined);

// ── Claude Code ──────────────────────────────────────────────────────────

/** The fields of the Claude SDK's `McpServerStatus` this reads. */
export interface ClaudeMcpStatus {
  readonly name: string;
  readonly status: string;
  readonly error?: string | undefined;
  readonly tools?:
    | ReadonlyArray<{
        readonly name: string;
        readonly description?: string | undefined;
        readonly annotations?: unknown;
      }>
    | undefined;
}

const CLAUDE_STATES: Readonly<Record<string, McpServerState>> = {
  connected: "connected",
  pending: "connecting",
  "needs-auth": "needs-auth",
  failed: "failed",
  disabled: "disabled",
};

export function claudeMcpLiveServers(statuses: ReadonlyArray<ClaudeMcpStatus>): McpLiveServer[] {
  return statuses.map((status) => {
    const error = optionalString(status.error);
    return {
      name: status.name,
      state: CLAUDE_STATES[status.status] ?? "configured",
      ...(error !== undefined ? { error } : {}),
      ...(status.tools !== undefined
        ? {
            tools: definedTools(
              status.tools.map((tool) => toolOf(tool.name, tool.description, tool.annotations)),
            ),
          }
        : {}),
    };
  });
}

/** The calls of a running Claude SDK query the hook uses. */
export interface ClaudeMcpQuery {
  readonly mcpServerStatus?: () => Promise<ReadonlyArray<ClaudeMcpStatus>>;
  readonly reconnectMcpServer?: (name: string) => Promise<void>;
  readonly toggleMcpServer?: (name: string, enabled: boolean) => Promise<void>;
}

export function claudeMcpControl(sessions: {
  readonly get: (threadId: ThreadId) => McpSession<ClaudeMcpQuery> | undefined;
  readonly all: () => ReadonlyArray<McpSession<ClaudeMcpQuery>>;
}): ProviderAdapterMcp {
  return {
    status: (threadId) => {
      const query = sessions.get(threadId)?.runtime;
      const read = query?.mcpServerStatus;
      if (read === undefined) return Effect.undefined;
      return fromPromise(() => read.call(query)).pipe(
        Effect.map(claudeMcpLiveServers),
        Effect.timeout(ALL_LIVE_TIMEOUT),
        Effect.catch(() => Effect.undefined),
      );
    },
    reconnect: (threadId, name) =>
      Effect.flatMap(pressable(sessions.get(threadId)), (query) => {
        const reconnect = query.reconnectMcpServer;
        return reconnect === undefined
          ? Effect.fail(NOT_RUNNING)
          : fromPromise(() => reconnect.call(query, name));
      }),
    setEnabled: (threadId, name, enabled) =>
      Effect.flatMap(pressable(sessions.get(threadId)), (query) => {
        const toggle = query.toggleMcpServer;
        return toggle === undefined
          ? Effect.fail(NOT_RUNNING)
          : fromPromise(() => toggle.call(query, name, enabled));
      }),
    configChanged: (change) =>
      change.kind !== "enabled"
        ? Effect.void
        : Effect.forEach(
            unprofiled(sessions.all()),
            (query) => {
              const toggle = query.toggleMcpServer;
              return toggle === undefined
                ? Effect.void
                : fromPromise(() => toggle.call(query, change.name, change.enabled)).pipe(
                    Effect.ignore,
                  );
            },
            { concurrency: "unbounded", discard: true },
          ),
  };
}

// ── Codex ────────────────────────────────────────────────────────────────

const CODEX_STATES: Readonly<Record<string, McpServerState>> = {
  starting: "connecting",
  connected: "connected",
  authenticationRequired: "needs-auth",
  failed: "failed",
  cancelled: "failed",
  disabled: "disabled",
};

/** `mcpServerStatus/list`'s `data` for a thread. */
export function codexMcpLiveServers(response: unknown): McpLiveServer[] {
  const data = isRecord(response) && Array.isArray(response["data"]) ? response["data"] : [];
  const servers: McpLiveServer[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    const name = optionalString(entry["name"]);
    if (name === undefined) continue;
    const runtime = optionalString(entry["runtimeStatus"]);
    const state: McpServerState =
      runtime !== undefined && runtime in CODEX_STATES
        ? CODEX_STATES[runtime]!
        : entry["authStatus"] === "notLoggedIn"
          ? "needs-auth"
          : "configured";
    const error = optionalString(entry["toolsError"]);
    const tools = isRecord(entry["tools"])
      ? definedTools(
          Object.values(entry["tools"]).map((tool) =>
            isRecord(tool)
              ? toolOf(tool["name"], tool["description"], tool["annotations"])
              : undefined,
          ),
        )
      : undefined;
    servers.push({
      name,
      state,
      ...(error !== undefined ? { error } : {}),
      ...(tools !== undefined && (state === "connected" || tools.length > 0) ? { tools } : {}),
    });
  }
  return servers;
}

/** The calls of a running Codex session the hook uses. */
export interface CodexMcpRuntime {
  readonly listMcpServers?: Effect.Effect<unknown, Error> | undefined;
  readonly reloadMcpServers?: Effect.Effect<void, Error> | undefined;
}

export function codexMcpControl(sessions: {
  readonly get: (threadId: ThreadId) => McpSession<CodexMcpRuntime> | undefined;
  readonly all: () => ReadonlyArray<McpSession<CodexMcpRuntime>>;
}): ProviderAdapterMcp {
  const reload = (threadId: ThreadId) =>
    Effect.flatMap(pressable(sessions.get(threadId)), (runtime) =>
      runtime.reloadMcpServers === undefined
        ? Effect.fail(NOT_RUNNING)
        : asMcpError(runtime.reloadMcpServers),
    );
  return {
    status: (threadId) => {
      const listMcpServers = sessions.get(threadId)?.runtime.listMcpServers;
      if (listMcpServers === undefined) return Effect.undefined;
      return listMcpServers.pipe(
        Effect.map(codexMcpLiveServers),
        Effect.timeout(ALL_LIVE_TIMEOUT),
        Effect.catch(() => Effect.undefined),
      );
    },
    // Codex reconnects by re-reading its config; the config already holds `enabled`.
    reconnect: (threadId) => reload(threadId),
    setEnabled: (threadId) => reload(threadId),
    configChanged: () =>
      Effect.forEach(
        unprofiled(sessions.all()),
        (runtime) => Effect.ignore(runtime.reloadMcpServers ?? Effect.void),
        {
          concurrency: "unbounded",
          discard: true,
        },
      ),
  };
}

// ── OpenCode ─────────────────────────────────────────────────────────────

/** `GET /mcp`: each server's status by name. */
export function openCodeMcpLiveServers(response: unknown): McpLiveServer[] {
  if (!isRecord(response)) return [];
  return Object.entries(response).map(([name, value]) => {
    const status = isRecord(value) ? value["status"] : undefined;
    const error = isRecord(value) ? optionalString(value["error"]) : undefined;
    const state: McpServerState =
      status === "connected"
        ? "connected"
        : status === "disabled"
          ? "disabled"
          : status === "failed"
            ? "failed"
            : status === "needs_auth" || status === "needs_client_registration"
              ? "needs-auth"
              : "configured";
    return { name, state, ...(error !== undefined ? { error } : {}) };
  });
}

/** The calls of a running OpenCode server the hook uses (its SDK's `mcp`, results unwrapped). */
export interface OpenCodeMcpClient {
  readonly status: () => Promise<unknown>;
  readonly connect: (name: string) => Promise<unknown>;
  readonly disconnect: (name: string) => Promise<unknown>;
  readonly add: (name: string, config: Readonly<Record<string, unknown>>) => Promise<unknown>;
}

export function openCodeMcpControl(sessions: {
  readonly get: (threadId: ThreadId) => McpSession<OpenCodeMcpClient> | undefined;
  /** Sessions on one server (one `shareKey`) share its MCP connections. */
  readonly all: () => ReadonlyArray<McpSession<OpenCodeMcpClient>>;
}): ProviderAdapterMcp {
  const withClient = (threadId: ThreadId, run: (client: OpenCodeMcpClient) => Promise<unknown>) =>
    Effect.flatMap(pressable(sessions.get(threadId)), (client) =>
      fromPromise(() => run(client)).pipe(Effect.asVoid),
    );
  return {
    status: (threadId) => {
      const client = sessions.get(threadId)?.runtime;
      if (client === undefined) return Effect.undefined;
      return fromPromise(() => client.status()).pipe(
        Effect.map(openCodeMcpLiveServers),
        Effect.timeout(ALL_LIVE_TIMEOUT),
        Effect.catch(() => Effect.undefined),
      );
    },
    reconnect: (threadId, name) =>
      withClient(threadId, async (client) => {
        await client.disconnect(name).catch(() => undefined);
        return client.connect(name);
      }),
    setEnabled: (threadId, name, enabled) =>
      withClient(threadId, (client) => (enabled ? client.connect(name) : client.disconnect(name))),
    configChanged: (change) =>
      Effect.forEach(
        unprofiled(sessions.all()),
        (client) =>
          fromPromise(() =>
            change.kind === "added"
              ? client.add(change.name, change.entry)
              : change.kind === "removed" || !change.enabled
                ? client.disconnect(change.name)
                : client.connect(change.name),
          ).pipe(Effect.ignore),
        { concurrency: "unbounded", discard: true },
      ),
  };
}
