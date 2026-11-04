/**
 * mcpControl — the one hook a driver carries for the MCP tab
 * (`ProviderAdapterShape.mcp`), built from the few native calls each agent
 * has; the routing across instances is `mcpLive.ts`.
 *
 * - Claude Code: the SDK query's `mcpServerStatus()`, `reconnectMcpServer`,
 *   `toggleMcpServer` (the toggle also persists the project's disabled list),
 *   and `setMcpServers`, which hands a running conversation the servers added
 *   since it started (the next one reads them from its config).
 * - Codex: the app-server's `mcpServerStatus/list` for the thread and
 *   `config/mcpServer/reload`, which re-reads `config.toml`.
 * - OpenCode: its server's `/mcp` status, `connect`, `disconnect`, and `add`
 *   for a server added while it runs.
 * - The ACP agents (Cursor, Grok, Antigravity) carry no hook: `configured`.
 *
 * Signing in to a remote server is each agent's own OAuth flow, started here
 * and finished with the address the person's browser landed on: Claude Code's
 * `mcp_authenticate` takes the Mate's public sign-in page as its redirect;
 * Codex (`mcpServer/oauth/login`) and OpenCode (`/mcp/{name}/auth`) redirect
 * to their own listener inside the container, which the landing is relayed to.
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
  /** Whether the agent holds an OAuth sign-in for it, where the agent says. */
  readonly signedIn?: boolean;
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

/**
 * A sign-in the agent started for one server: the person opens `url`, and the
 * provider sends their browser to the redirect URI the URL names, carrying a
 * one-time code. Where that is the agent's own `listener` inside the
 * container, the landing's query is first carried there, as the browser would
 * have; `finish` then hands the agent the landing and succeeds once the agent
 * holds the server's tokens.
 */
export interface McpSignInStart {
  readonly url: string;
  readonly listener?: URL;
  readonly finish: (landed: URL) => Effect.Effect<void, ProviderMcpError>;
}

/** The hook a driver's adapter carries (`ProviderAdapterShape.mcp`). */
export interface ProviderAdapterMcp {
  /**
   * Starts the agent's own OAuth sign-in for a server of the thread's running
   * session. `redirectUri` is the Mate's public sign-in page, which an agent
   * that can register its own redirect sends the browser to; the others keep
   * their listener inside the container. Absent: the agent has no sign-in.
   */
  readonly signIn?: (
    threadId: ThreadId,
    name: string,
    redirectUri: string | undefined,
  ) => Effect.Effect<McpSignInStart | "signed-in", ProviderMcpError>;
  /** Drops the agent's sign-in to a server; the server then asks for one again. */
  readonly signOut?: (threadId: ThreadId, name: string) => Effect.Effect<void, ProviderMcpError>;
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

/** Why a landing carries no code: the provider's own refusal, or none at all. */
export function landingRefusal(landed: URL): string {
  const said = landed.searchParams.get("error_description") ?? landed.searchParams.get("error");
  return said !== null && said.trim() !== ""
    ? `the sign-in was refused: ${said.trim()}`
    : "that address carries no sign-in code";
}

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
  /**
   * Replaces the servers handed to the running query beside its config's. A
   * method, so the SDK's narrower server type still fits: the entries are the
   * ones the MCP tab wrote into Claude's own config, in its shape.
   */
  setMcpServers?(servers: Record<string, Readonly<Record<string, unknown>>>): Promise<unknown>;
  /**
   * The CLI's `mcp_authenticate` (present on the SDK's query, not yet in its
   * types): starts a server's OAuth flow, sending the browser to
   * `redirectUri` where the provider accepts it and to the CLI's own
   * localhost listener otherwise.
   */
  readonly mcpAuthenticate?: (name: string, redirectUri?: string) => Promise<unknown>;
  /** The CLI's `mcp_oauth_callback_url`: settles once the tokens are exchanged. */
  readonly mcpSubmitOAuthCallbackUrl?: (name: string, callbackUrl: string) => Promise<unknown>;
  /** The CLI's `mcp_clear_auth`: revokes a remote server's tokens and reconnects it. */
  readonly mcpClearAuth?: (name: string) => Promise<unknown>;
}

/** Signing in is the agent's own: it has no call for it, or answered something unknown. */
const NO_SIGN_IN = new ProviderMcpError({
  detail: "This agent can't sign in to MCP servers from Mate.",
});

/**
 * The servers the MCP tab added to each running Claude query since it started:
 * `setMcpServers` replaces the whole set, so each call carries the earlier ones.
 */
const claudeAddedServers = new WeakMap<
  ClaudeMcpQuery,
  Record<string, Readonly<Record<string, unknown>>>
>();

/** One running query hears an added or removed server; one it started with stays to the next. */
const claudeSetChanged = (
  query: ClaudeMcpQuery,
  change: Extract<McpConfigChange, { kind: "added" | "removed" }>,
): Effect.Effect<void> => {
  const set = query.setMcpServers;
  const added = claudeAddedServers.get(query) ?? {};
  if (set === undefined || (change.kind === "removed" && !(change.name in added))) {
    return Effect.void;
  }
  const next = { ...added };
  if (change.kind === "added") next[change.name] = change.entry;
  else delete next[change.name];
  return fromPromise(() => set.call(query, next)).pipe(
    Effect.tap(() => Effect.sync(() => claudeAddedServers.set(query, next))),
    Effect.ignore,
  );
};

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
    signIn: (threadId, name, redirectUri) =>
      Effect.flatMap(pressable(sessions.get(threadId)), (query) => {
        const authenticate = query.mcpAuthenticate;
        const submit = query.mcpSubmitOAuthCallbackUrl;
        if (authenticate === undefined || submit === undefined) return Effect.fail(NO_SIGN_IN);
        return fromPromise(() => authenticate.call(query, name, redirectUri)).pipe(
          Effect.flatMap(
            (answer): Effect.Effect<McpSignInStart | "signed-in", ProviderMcpError> => {
              const started = isRecord(answer) ? answer : {};
              if (started["requiresUserAction"] !== true)
                return Effect.succeed("signed-in" as const);
              const url = optionalString(started["authUrl"]);
              // claude.ai's own connectors finish on claude.ai: no landing comes back here.
              if (url === undefined || started["callbackExpected"] !== true) {
                return Effect.fail(NO_SIGN_IN);
              }
              return Effect.succeed({
                url,
                finish: (landed: URL) =>
                  fromPromise(() => submit.call(query, name, landed.href)).pipe(Effect.asVoid),
              } satisfies McpSignInStart);
            },
          ),
        );
      }),
    signOut: (threadId, name) =>
      Effect.flatMap(pressable(sessions.get(threadId)), (query) => {
        const clear = query.mcpClearAuth;
        return clear === undefined
          ? Effect.fail(NO_SIGN_IN)
          : fromPromise(() => clear.call(query, name)).pipe(Effect.asVoid);
      }),
    configChanged: (change) =>
      Effect.forEach(
        unprofiled(sessions.all()),
        (query) => {
          if (change.kind !== "enabled") return claudeSetChanged(query, change);
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
    const auth = entry["authStatus"];
    const signedIn =
      auth === "oAuth"
        ? true
        : auth === "bearerToken" || auth === "unsupported" || auth === "notLoggedIn"
          ? false
          : undefined;
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
      ...(signedIn !== undefined ? { signedIn } : {}),
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
  /**
   * `mcpServer/oauth/login`: the authorization URL, and the app-server's
   * `mcpServer/oauthLogin/completed` for that server as `completed`.
   */
  readonly loginMcpServer?:
    | ((
        name: string,
      ) => Effect.Effect<
        { readonly authorizationUrl: string; readonly completed: Effect.Effect<void, Error> },
        Error
      >)
    | undefined;
  /** `codex mcp logout`, with the session's own binary and home. */
  readonly logoutMcpServer?: ((name: string) => Effect.Effect<void, Error>) | undefined;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The agent's own listener the authorization URL redirects to, when it is one
 * inside this container: plain http on a loopback host.
 */
export function loopbackRedirect(authorizationUrl: string): URL | undefined {
  try {
    const redirect = new URL(new URL(authorizationUrl).searchParams.get("redirect_uri") ?? "");
    return redirect.protocol === "http:" && LOOPBACK_HOSTS.has(redirect.hostname)
      ? redirect
      : undefined;
  } catch {
    return undefined;
  }
}

/** How long Codex keeps a sign-in open for the person to finish. */
export const CODEX_SIGN_IN_TIMEOUT_SECONDS = 600;

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
    signIn: (threadId, name) =>
      Effect.flatMap(pressable(sessions.get(threadId)), (runtime) => {
        const login = runtime.loginMcpServer;
        if (login === undefined) return Effect.fail(NO_SIGN_IN);
        return asMcpError(login(name)).pipe(
          Effect.flatMap(({ authorizationUrl, completed }) => {
            const listener = loopbackRedirect(authorizationUrl);
            if (listener === undefined) return Effect.fail(NO_SIGN_IN);
            return Effect.succeed({
              url: authorizationUrl,
              listener,
              finish: () =>
                asMcpError(completed).pipe(
                  // The tokens are Codex's now; a reload connects the server with them.
                  Effect.andThen(Effect.ignore(runtime.reloadMcpServers ?? Effect.void)),
                ),
            } satisfies McpSignInStart);
          }),
        );
      }),
    signOut: (threadId, name) =>
      Effect.flatMap(pressable(sessions.get(threadId)), (runtime) =>
        runtime.logoutMcpServer === undefined
          ? Effect.fail(NO_SIGN_IN)
          : asMcpError(runtime.logoutMcpServer(name)).pipe(
              Effect.andThen(Effect.ignore(runtime.reloadMcpServers ?? Effect.void)),
            ),
      ),
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
  /** `POST /mcp/{name}/auth`: the authorization URL its own listener is the redirect of. */
  readonly startAuth?: (name: string) => Promise<{ readonly authorizationUrl: string }>;
  /** `POST /mcp/{name}/auth/callback`: exchanges the code the provider sent. */
  readonly finishAuth?: (name: string, code: string) => Promise<unknown>;
  /** `DELETE /mcp/{name}/auth`: forgets the server's credentials. */
  readonly removeAuth?: (name: string) => Promise<unknown>;
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
    signIn: (threadId, name) =>
      Effect.flatMap(pressable(sessions.get(threadId)), (client) => {
        const { startAuth, finishAuth } = client;
        if (startAuth === undefined || finishAuth === undefined) return Effect.fail(NO_SIGN_IN);
        return fromPromise(() => startAuth.call(client, name)).pipe(
          Effect.map(({ authorizationUrl }): McpSignInStart => ({
            url: authorizationUrl,
            finish: (landed) => {
              const code = landed.searchParams.get("code");
              return code === null || code === ""
                ? Effect.fail(new ProviderMcpError({ detail: landingRefusal(landed) }))
                : fromPromise(() => finishAuth.call(client, name, code)).pipe(Effect.asVoid);
            },
          })),
        );
      }),
    signOut: (threadId, name) =>
      Effect.flatMap(pressable(sessions.get(threadId)), (client) => {
        const removeAuth = client.removeAuth;
        if (removeAuth === undefined) return Effect.fail(NO_SIGN_IN);
        // The open connection still carries the old token: reconnect it without one.
        return fromPromise(async () => {
          await removeAuth.call(client, name);
          await client.disconnect(name).catch(() => undefined);
          await client.connect(name);
        });
      }),
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
