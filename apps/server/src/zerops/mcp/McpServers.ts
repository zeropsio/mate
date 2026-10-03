/**
 * The MCP tab's server side: every installed agent's MCP servers as one list,
 * and the writes that keep them the same across agents.
 *
 * A server is added for every agent installed here, into each agent's own
 * user-scope config (`mcpAgents.ts`), never the repo — secrets stay out of
 * git, and whichever agent a conversation runs on has the same tools. zcp's
 * `zerops` is shown and reconnected, never changed. A running session hears of
 * a change where its agent can (`spi/mcpLive.ts`); otherwise the next
 * conversation reads the new config.
 *
 * @module McpServers
 */
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";

import {
  McpServerName,
  McpServersError,
  type McpServerAddInput,
  type McpServerAgent,
  type McpServerEntry,
  type McpServersList,
  type McpServersListInput,
  type McpServerSetEnabledInput,
  type McpServerTargetInput,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
  type ServerSettings,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as McpLiveModule from "../../spi/mcpLive.ts";
import { McpLive, type McpConfigChange, type McpLiveServer } from "../../spi/mcpLive.ts";
import {
  MANAGED_MCP_SERVER,
  makeMcpAgentStores,
  McpConfigParseError,
  type McpAgentPaths,
  type McpAgentStore,
  type McpConfigServer,
  type McpFileEdit,
  type McpFiles,
} from "./mcpAgents.ts";

/** How each agent is named in a sentence the tab shows. */
const AGENT_NAMES: Readonly<Record<string, string>> = {
  claudeAgent: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  grok: "Grok",
  antigravity: "Antigravity",
};

const agentName = (driver: string): string => AGENT_NAMES[driver] ?? driver;

const isServerName = Schema.is(McpServerName);

const expandHome = (value: string, homeDir: string): string =>
  value === "~" ? homeDir : value.startsWith("~/") ? `${homeDir}${value.slice(1)}` : value;

const configString = (config: unknown, field: string): string => {
  if (typeof config !== "object" || config === null) return "";
  const value = (config as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
};

const trimSlash = (value: string): string => (value.length > 1 ? value.replace(/\/+$/, "") : value);

/**
 * Where the agents keep their config: every Claude and Codex home the
 * configured instances name (each login's own), the defaults first.
 */
export function mcpAgentPaths(input: {
  readonly homeDir: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly settings: Pick<ServerSettings, "providers" | "providerInstances">;
}): McpAgentPaths {
  const { homeDir, env, settings } = input;
  const instances: ReadonlyArray<ProviderInstanceConfig> = Object.values(
    settings.providerInstances,
  );
  const homesOf = (driver: string, defaultHome: string, field: string, configured: string) => [
    ...new Set(
      [
        defaultHome,
        configured,
        ...instances
          .filter((instance) => instance.driver === driver)
          .map((instance) => configString(instance.config, field)),
      ]
        .filter((home) => home.length > 0)
        .map((home) => trimSlash(expandHome(home, homeDir))),
    ),
  ];
  const claudeHomes = homesOf(
    "claudeAgent",
    homeDir,
    "homePath",
    settings.providers.claudeAgent.homePath,
  );
  const codexHomes = homesOf(
    "codex",
    `${homeDir}/.codex`,
    "homePath",
    settings.providers.codex.homePath,
  );
  const grokHome = env["GROK_HOME"]?.trim() || `${homeDir}/.grok`;
  const configHome = env["XDG_CONFIG_HOME"]?.trim() || `${homeDir}/.config`;
  return {
    cwd: trimSlash(input.cwd),
    // Claude reads `~/.claude.json` by default and `$CLAUDE_CONFIG_DIR/.claude.json` for a home.
    claudeConfigs: claudeHomes.map((home) => `${home}/.claude.json`),
    codexConfigs: codexHomes.map((home) => `${home}/config.toml`),
    cursorHome: `${homeDir}/.cursor`,
    grokConfig: `${trimSlash(grokHome)}/config.toml`,
    // Mate's Antigravity profile links its `config/mcp_config.json` to this one.
    antigravityConfig: `${homeDir}/.gemini/config/mcp_config.json`,
    openCodeConfig: `${trimSlash(configHome)}/opencode/opencode.json`,
  };
}

/** The files the service reads and writes; the layer's is atomic, a test's is a map. */
export interface McpFileStore {
  readonly read: (path: string) => Effect.Effect<string | undefined, McpServersError>;
  readonly write: (path: string, text: string) => Effect.Effect<void, McpServersError>;
}

/** The live side the service asks (`spi/mcpLive.ts`'s `McpLive`). */
export type McpLiveAccess = McpLive["Service"];

export interface McpServersOptions {
  readonly files: McpFileStore;
  readonly paths: Effect.Effect<McpAgentPaths, McpServersError>;
  readonly live: McpLiveAccess;
}

export class McpServers extends Context.Service<
  McpServers,
  {
    readonly list: (input: McpServersListInput) => Effect.Effect<McpServersList, McpServersError>;
    readonly add: (input: McpServerAddInput) => Effect.Effect<McpServersList, McpServersError>;
    readonly remove: (
      input: McpServerTargetInput,
    ) => Effect.Effect<McpServersList, McpServersError>;
    readonly setEnabled: (
      input: McpServerSetEnabledInput,
    ) => Effect.Effect<McpServersList, McpServersError>;
    readonly reconnect: (
      input: McpServerTargetInput,
    ) => Effect.Effect<McpServersList, McpServersError>;
  }
>()("t3/zerops/mcp/McpServers") {}

const NUDGE_TIMEOUT = "5 seconds";

interface AgentServers {
  readonly store: McpAgentStore;
  readonly servers: ReadonlyArray<McpConfigServer>;
}

/** One entry per name across the agents, zcp's first, the rest by name. */
export function mergeMcpServers(
  agents: ReadonlyArray<AgentServers>,
  live:
    | { readonly driver: ProviderDriverKind; readonly servers: ReadonlyArray<McpLiveServer> }
    | undefined,
): McpServerEntry[] {
  const byName = new Map<
    string,
    { first: McpConfigServer; scopes: Set<string>; agents: McpServerAgent[] }
  >();
  for (const { store, servers } of agents) {
    for (const server of servers) {
      if (!isServerName(server.name)) continue;
      const liveServer =
        live?.driver === store.driver
          ? live.servers.find((candidate) => candidate.name === server.name)
          : undefined;
      const agent: McpServerAgent =
        liveServer !== undefined
          ? {
              driver: store.driver,
              state: liveServer.state,
              ...(liveServer.error !== undefined ? { error: liveServer.error } : {}),
              ...(liveServer.tools !== undefined ? { tools: liveServer.tools } : {}),
            }
          : { driver: store.driver, state: server.enabled ? "configured" : "disabled" };
      const found = byName.get(server.name);
      if (found === undefined) {
        byName.set(server.name, {
          first: server,
          scopes: new Set([server.scope]),
          agents: [agent],
        });
      } else {
        found.scopes.add(server.scope);
        found.agents.push(agent);
      }
    }
  }
  return [...byName.values()]
    .map(({ first, scopes, agents: serverAgents }) => ({
      name: McpServerName.make(first.name),
      transport: first.transport,
      managed: first.name === MANAGED_MCP_SERVER,
      scope: scopes.has("user") ? ("user" as const) : ("project" as const),
      agents: serverAgents,
    }))
    .toSorted((a, b) =>
      a.managed !== b.managed ? (a.managed ? -1 : 1) : a.name.localeCompare(b.name),
    );
}

export const make = Effect.fn("McpServers.make")(function* (options: McpServersOptions) {
  const { files, live } = options;
  const writes = yield* Semaphore.make(1);

  const fail = (operation: string, detail: string, cause?: unknown) =>
    new McpServersError({ operation, detail, ...(cause !== undefined ? { cause } : {}) });

  const loadStores = Effect.gen(function* () {
    const paths = yield* options.paths;
    const stores = makeMcpAgentStores(paths);
    const installed = yield* live.installedDrivers;
    const chosen = installed.flatMap((driver) => {
      const store = stores.get(driver);
      return store === undefined ? [] : [store];
    });
    const texts = new Map<string, string>();
    yield* Effect.forEach(
      [...new Set(chosen.flatMap((store) => store.paths))],
      (path) =>
        files.read(path).pipe(
          Effect.map((text) => {
            if (text !== undefined) texts.set(path, text);
          }),
        ),
      { concurrency: 8, discard: true },
    );
    return { stores: chosen, installed, files: texts as McpFiles };
  });

  /** A store's servers; a config it cannot parse is left out of the list and named in the log. */
  const readAgents = (stores: ReadonlyArray<McpAgentStore>, texts: McpFiles) =>
    Effect.forEach(stores, (store) =>
      Effect.try({
        try: () => ({ store, servers: store.read(texts) }),
        catch: (cause) =>
          fail("mcp.servers.list", `${agentName(store.driver)}'s config could not be read.`, cause),
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("An agent's MCP config could not be read.", {
            driver: store.driver,
            cause,
          }).pipe(Effect.as({ store, servers: [] as ReadonlyArray<McpConfigServer> })),
        ),
      ),
    );

  const list = (operation: string, threadId: ThreadId | undefined) =>
    Effect.gen(function* () {
      const loaded = yield* loadStores;
      const agents = yield* readAgents(loaded.stores, loaded.files);
      const liveState = threadId === undefined ? undefined : yield* live.status(threadId);
      return {
        servers: mergeMcpServers(agents, liveState),
        agents: loaded.installed,
      } satisfies McpServersList;
    }).pipe(Effect.withSpan(`McpServers.${operation}`));

  /** Each store's edits, or the sentence that says which config could not be read. */
  const planEdits = (
    operation: string,
    stores: ReadonlyArray<McpAgentStore>,
    edit: (store: McpAgentStore) => ReadonlyArray<McpFileEdit>,
  ) =>
    Effect.forEach(stores, (store) =>
      Effect.try({
        try: () => edit(store),
        catch: (cause) =>
          cause instanceof McpConfigParseError
            ? fail(
                operation,
                `${agentName(store.driver)}'s config at ${cause.path} could not be read, so nothing was changed. Fix or remove that file and try again.`,
                cause,
              )
            : fail(operation, `${agentName(store.driver)}'s config could not be changed.`, cause),
      }),
    ).pipe(Effect.map((edits) => edits.flat()));

  const writeAll = (edits: ReadonlyArray<McpFileEdit>) =>
    Effect.forEach(edits, (edit) => files.write(edit.path, edit.text), { discard: true });

  const nudge = (
    stores: ReadonlyArray<McpAgentStore>,
    change: (store: McpAgentStore) => McpConfigChange,
  ) =>
    Effect.forEach(stores, (store) => live.configChanged(store.driver, change(store)), {
      concurrency: "unbounded",
      discard: true,
    }).pipe(Effect.timeout(NUDGE_TIMEOUT), Effect.ignore);

  /** The servers the name refers to, refusing zcp's and one only the repo holds. */
  const target = (operation: string, name: string) =>
    Effect.gen(function* () {
      if (name === MANAGED_MCP_SERVER) {
        return yield* fail(operation, "Zerops' own server can't be changed here.");
      }
      const loaded = yield* loadStores;
      const agents = yield* readAgents(loaded.stores, loaded.files);
      const found = agents.flatMap(({ servers }) =>
        servers.filter((server) => server.name === name),
      );
      if (found.length === 0) {
        return yield* fail(operation, `There is no server named ${name}.`);
      }
      if (found.every((server) => server.scope === "project")) {
        return yield* fail(
          operation,
          `${name} is set up in the project's .mcp.json, so it is changed there, not here.`,
        );
      }
      return loaded;
    });

  const add: McpServers["Service"]["add"] = (input) =>
    writes.withPermits(1)(
      Effect.gen(function* () {
        const operation = "mcp.servers.add";
        if (input.name === MANAGED_MCP_SERVER) {
          return yield* fail(operation, "Zerops' own server can't be changed here.");
        }
        const loaded = yield* loadStores;
        if (loaded.stores.length === 0) {
          return yield* fail(operation, "No agent is installed here to add the server to.");
        }
        const agents = yield* readAgents(loaded.stores, loaded.files);
        if (agents.some(({ servers }) => servers.some((server) => server.name === input.name))) {
          return yield* fail(operation, `A server named ${input.name} is already set up.`);
        }
        // A command takes an environment, a URL takes headers; never the other.
        const server: McpServerAddInput =
          input.transport.type === "stdio"
            ? {
                name: input.name,
                transport: input.transport,
                ...(input.env ? { env: input.env } : {}),
              }
            : {
                name: input.name,
                transport: input.transport,
                ...(input.headers ? { headers: input.headers } : {}),
              };
        const edits = yield* planEdits(operation, loaded.stores, (store) =>
          store.add(loaded.files, server),
        );
        yield* writeAll(edits);
        yield* nudge(loaded.stores, (store) => ({
          kind: "added",
          name: server.name,
          entry: store.entry(server),
        }));
        return yield* list(operation, undefined);
      }),
    );

  const remove: McpServers["Service"]["remove"] = (input) =>
    writes.withPermits(1)(
      Effect.gen(function* () {
        const operation = "mcp.servers.remove";
        const loaded = yield* target(operation, input.name);
        const edits = yield* planEdits(operation, loaded.stores, (store) =>
          store.remove(loaded.files, input.name),
        );
        yield* writeAll(edits);
        yield* nudge(loaded.stores, () => ({ kind: "removed", name: input.name }));
        return yield* list(operation, input.threadId);
      }),
    );

  const setEnabled: McpServers["Service"]["setEnabled"] = (input) =>
    writes.withPermits(1)(
      Effect.gen(function* () {
        const operation = "mcp.servers.setEnabled";
        const loaded = yield* target(operation, input.name);
        const edits = yield* planEdits(operation, loaded.stores, (store) =>
          store.setEnabled(loaded.files, input.name, input.enabled),
        );
        yield* writeAll(edits);
        yield* nudge(loaded.stores, () => ({
          kind: "enabled",
          name: input.name,
          enabled: input.enabled,
        }));
        return yield* list(operation, input.threadId);
      }),
    );

  const reconnect: McpServers["Service"]["reconnect"] = (input) =>
    Effect.gen(function* () {
      const operation = "mcp.servers.reconnect";
      if (input.threadId !== undefined && (yield* live.status(input.threadId)) !== undefined) {
        yield* live
          .reconnect(input.threadId, input.name)
          .pipe(
            Effect.mapError((error) =>
              fail(operation, `${input.name} could not reconnect: ${error.detail}`, error),
            ),
          );
      }
      return yield* list(operation, input.threadId);
    });

  return {
    list: (input) => list("mcp.servers.list", input.threadId),
    add,
    remove,
    setEnabled,
    reconnect,
  } satisfies McpServers["Service"];
});

/**
 * The real files: a write lands whole (a temporary file beside it, then a
 * rename), through a symlink to the file it points at, keeping the file's
 * permissions — a new one is private to its owner, since it can hold keys.
 */
export const nodeFileStore = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const read = (file: string) =>
    fs.readFileString(file).pipe(
      Effect.map((text): string | undefined => text),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined),
      Effect.mapError(
        (cause) =>
          new McpServersError({
            operation: "mcp.servers.read",
            detail: `${file} could not be read.`,
            cause,
          }),
      ),
    );
  const write = (file: string, text: string) =>
    Effect.gen(function* () {
      const target = yield* fs.realPath(file).pipe(Effect.catch(() => Effect.succeed(file)));
      const mode = yield* fs.stat(target).pipe(
        Effect.map((info) => info.mode & 0o777),
        Effect.catch(() => Effect.succeed(0o600)),
      );
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      const temporary = `${target}.mate-${NodeCrypto.randomBytes(4).toString("hex")}.tmp`;
      yield* fs.writeFileString(temporary, text, { mode });
      yield* fs
        .rename(temporary, target)
        .pipe(Effect.tapError(() => fs.remove(temporary).pipe(Effect.ignore)));
    }).pipe(
      Effect.mapError(
        (cause) =>
          new McpServersError({
            operation: "mcp.servers.write",
            detail: `${file} could not be saved.`,
            cause,
          }),
      ),
    );
  return { read, write } satisfies McpFileStore;
});

export const layer = Layer.effect(
  McpServers,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const settings = yield* ServerSettingsService;
    const live = yield* McpLive;
    const files = yield* nodeFileStore;
    return yield* make({
      files,
      live,
      paths: settings.getSettings.pipe(
        Effect.map((current) =>
          mcpAgentPaths({
            homeDir: NodeOS.homedir(),
            cwd: config.cwd,
            env: process.env,
            settings: current,
          }),
        ),
        Effect.mapError(
          (cause) =>
            new McpServersError({
              operation: "mcp.servers.paths",
              detail: "The server's settings could not be read.",
              cause,
            }),
        ),
      ),
    });
  }),
);

/**
 * The service with its live side: provided beside the Zerops feeds in
 * `server.ts`, on top of the provider runtime it asks for live state.
 */
export const McpServersLayerLive = layer.pipe(Layer.provide(McpLiveModule.layer));
