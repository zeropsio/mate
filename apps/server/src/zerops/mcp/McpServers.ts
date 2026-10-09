/**
 * The MCP tab's server side: every installed agent's MCP servers as one list,
 * and the writes that keep them the same across agents.
 *
 * A server is added for every agent installed here, into each agent's own
 * user-scope config (`mcpAgents.ts`), never the repo — secrets stay out of
 * git, and whichever agent a conversation runs on has the same tools. zcp's
 * `zerops` is shown and reconnected, never changed. An agent whose config
 * can't be changed safely is left alone and named; the others are written. A
 * running session hears of a change where its agent can (`spi/mcpLive.ts`);
 * otherwise the next conversation reads the new config.
 *
 * @module McpServers
 */
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
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../../config.ts";
import { currentProviderThread } from "../../engineSessionDirectory.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as McpLiveModule from "../../spi/mcpLive.ts";
import { McpLive, type McpConfigChange, type McpLiveServer } from "../../spi/mcpLive.ts";
import { resolveMcpAgentPaths } from "./mcpAgentPaths.ts";
import {
  MANAGED_MCP_SERVER,
  makeMcpAgentStores,
  McpConfigEditError,
  McpConfigParseError,
  type McpAgentPaths,
  type McpAgentStore,
  type McpConfigServer,
  type McpFileEdit,
  type McpFiles,
} from "./mcpAgents.ts";
import { McpFileConflict, nodeFileStore, type McpFileStore } from "./mcpFileStore.ts";

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

/** "A", "A and B", "A, B and C". */
const listed = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

const isServerName = Schema.is(McpServerName);

/** Why one agent's config was left as it was, as a sentence the tab shows. */
export function describeMcpConfigRefusal(driver: string, cause: unknown): string {
  const agent = agentName(driver);
  if (cause instanceof McpConfigParseError) {
    return `${agent}'s config at ${cause.path} isn't valid (${cause.detail}), so Mate left it as it is.`;
  }
  if (cause instanceof McpConfigEditError) {
    return `${agent}'s config at ${cause.path} is written in a way Mate can't change safely (${cause.reason}); change it there by hand.`;
  }
  return `${agent}'s config could not be changed.`;
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
/** A file an agent changed while Mate planned its change: plan again, this many times. */
const WRITE_ATTEMPTS = 3;

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

interface Loaded {
  readonly stores: ReadonlyArray<McpAgentStore>;
  readonly installed: ReadonlyArray<ProviderDriverKind>;
  readonly files: McpFiles;
}

/** One agent's planned change, or why it was left alone. */
type Planned =
  | { readonly store: McpAgentStore; readonly edits: ReadonlyArray<McpFileEdit> }
  | { readonly store: McpAgentStore; readonly refused: string };

export const make = Effect.fn("McpServers.make")(function* (options: McpServersOptions) {
  const { files, live } = options;
  const sessionThread = yield* currentProviderThread;
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
    return { stores: chosen, installed, files: texts } satisfies Loaded;
  });

  /** A store's servers; a config it cannot parse is left out of the list and named in the log. */
  const readAgents = (loaded: Loaded) =>
    Effect.forEach(loaded.stores, (store) =>
      Effect.gen(function* () {
        for (const problem of store.problems(loaded.files)) {
          yield* Effect.logWarning("An MCP config next to an agent's could not be read.", {
            driver: store.driver,
            path: problem.path,
            detail: problem.detail,
          });
        }
        try {
          return { store, servers: store.read(loaded.files) };
        } catch (cause) {
          yield* Effect.logWarning("An agent's MCP config could not be read.", {
            driver: store.driver,
            detail: describeMcpConfigRefusal(store.driver, cause),
          });
          return { store, servers: [] as ReadonlyArray<McpConfigServer> };
        }
      }),
    );

  const list = (operation: string, threadId: ThreadId | undefined) =>
    Effect.gen(function* () {
      const loaded = yield* loadStores;
      const agents = yield* readAgents(loaded);
      const session = yield* sessionThread(threadId);
      const liveState = session === undefined ? undefined : yield* live.status(session);
      return {
        servers: mergeMcpServers(agents, liveState),
        agents: loaded.installed,
      } satisfies McpServersList;
    }).pipe(Effect.withSpan(`McpServers.${operation}`));

  /** Each agent's edits, or the sentence that says why its config was left alone. */
  const plan = (
    stores: ReadonlyArray<McpAgentStore>,
    edit: (store: McpAgentStore) => ReadonlyArray<McpFileEdit>,
  ): Planned[] =>
    stores.map((store) => {
      try {
        return { store, edits: edit(store) };
      } catch (cause) {
        return { store, refused: describeMcpConfigRefusal(store.driver, cause) };
      }
    });

  /**
   * A change to every agent's config: planned from the files as they are,
   * written under Claude Code's lock, and planned again when an agent wrote
   * one of them meanwhile. The agents that refused are named after the ones
   * that took it; none taking it is the change's failure.
   */
  const change = (input: {
    readonly operation: string;
    readonly name: string;
    /** The past tense the sentence uses: "added", "removed", "turned off". */
    readonly done: string;
    /** Refusals before any file is read again, on the first attempt only. */
    readonly check: (loaded: Loaded, attempt: number) => Effect.Effect<void, McpServersError>;
    readonly edit: (store: McpAgentStore, loaded: Loaded) => ReadonlyArray<McpFileEdit>;
    readonly nudge: (store: McpAgentStore) => McpConfigChange;
    readonly threadId: ThreadId | undefined;
  }) =>
    writes.withPermits(1)(
      Effect.gen(function* () {
        const paths = yield* options.paths;
        const attempt = (index: number): Effect.Effect<Planned[], McpServersError> =>
          Effect.gen(function* () {
            const loaded = yield* loadStores;
            yield* input.check(loaded, index);
            const planned = plan(loaded.stores, (store) => input.edit(store, loaded));
            for (const entry of planned) {
              if (!("edits" in entry)) continue;
              for (const edit of entry.edits) {
                yield* files.write(edit.path, edit.text, loaded.files.get(edit.path));
              }
            }
            return planned;
          }).pipe(
            Effect.catchTags({
              McpFileConflict: (conflict: McpFileConflict) =>
                index + 1 < WRITE_ATTEMPTS
                  ? attempt(index + 1)
                  : Effect.fail(
                      fail(
                        input.operation,
                        `${conflict.path} kept changing while Mate wrote it. Try again in a moment.`,
                      ),
                    ),
            }),
          );
        const planned = yield* files.locked(paths.claudeConfigs, attempt(0));
        const took = planned.filter(
          (entry): entry is Extract<Planned, { edits: unknown }> =>
            "edits" in entry && entry.edits.length > 0,
        );
        yield* Effect.forEach(
          took,
          ({ store }) => live.configChanged(store.driver, input.nudge(store)),
          { concurrency: "unbounded", discard: true },
        ).pipe(Effect.timeout(NUDGE_TIMEOUT), Effect.ignore);
        const refused = planned.flatMap((entry) => ("refused" in entry ? [entry.refused] : []));
        if (refused.length > 0) {
          const lead =
            took.length > 0
              ? `${input.name} was ${input.done} for ${listed(took.map(({ store }) => agentName(store.driver)))}, not for the rest. `
              : "";
          return yield* fail(input.operation, `${lead}${refused.join(" ")}`);
        }
        return yield* list(input.operation, input.threadId);
      }),
    );

  /** The agents' servers of this name, refusing zcp's, an unknown one, and one only the repo holds. */
  const target = (operation: string, name: string) => (loaded: Loaded, index: number) =>
    Effect.gen(function* () {
      if (name === MANAGED_MCP_SERVER) {
        return yield* fail(operation, "Zerops' own server can't be changed here.");
      }
      if (index > 0) return;
      const agents = yield* readAgents(loaded);
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
    });

  const add: McpServers["Service"]["add"] = (input) => {
    const operation = "mcp.servers.add";
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
    return change({
      operation,
      name: input.name,
      done: "added",
      threadId: input.threadId,
      check: (loaded, index) =>
        Effect.gen(function* () {
          if (input.name === MANAGED_MCP_SERVER) {
            return yield* fail(operation, "Zerops' own server can't be changed here.");
          }
          if (loaded.stores.length === 0) {
            return yield* fail(operation, "No agent is installed here to add the server to.");
          }
          // A later attempt finds the server its first one already wrote somewhere.
          if (index > 0) return;
          const agents = yield* readAgents(loaded);
          if (agents.some(({ servers }) => servers.some((found) => found.name === input.name))) {
            return yield* fail(operation, `A server named ${input.name} is already set up.`);
          }
        }),
      edit: (store, loaded) => store.add(loaded.files, server),
      nudge: (store) => ({ kind: "added", name: server.name, entry: store.entry(server) }),
    });
  };

  const remove: McpServers["Service"]["remove"] = (input) =>
    change({
      operation: "mcp.servers.remove",
      name: input.name,
      done: "removed",
      threadId: input.threadId,
      check: target("mcp.servers.remove", input.name),
      edit: (store, loaded) => store.remove(loaded.files, input.name),
      nudge: () => ({ kind: "removed", name: input.name }),
    });

  const setEnabled: McpServers["Service"]["setEnabled"] = (input) =>
    change({
      operation: "mcp.servers.setEnabled",
      name: input.name,
      done: input.enabled ? "turned on" : "turned off",
      threadId: input.threadId,
      check: target("mcp.servers.setEnabled", input.name),
      edit: (store, loaded) => store.setEnabled(loaded.files, input.name, input.enabled),
      nudge: () => ({ kind: "enabled", name: input.name, enabled: input.enabled }),
    });

  const reconnect: McpServers["Service"]["reconnect"] = (input) =>
    Effect.gen(function* () {
      const operation = "mcp.servers.reconnect";
      const session = yield* sessionThread(input.threadId);
      if (session !== undefined && (yield* live.status(session)) !== undefined) {
        yield* live
          .reconnect(session, input.name)
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

export { nodeFileStore };

export const layer = Layer.effect(
  McpServers,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const settings = yield* ServerSettingsService;
    const live = yield* McpLive;
    const files = yield* nodeFileStore;
    const resolve =
      yield* Effect.context<Effect.Services<ReturnType<typeof resolveMcpAgentPaths>>>();
    return yield* make({
      files,
      live,
      paths: settings.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new McpServersError({
              operation: "mcp.servers.paths",
              detail: "The server's settings could not be read.",
              cause,
            }),
        ),
        Effect.flatMap((current) =>
          resolveMcpAgentPaths({
            homeDir: NodeOS.homedir(),
            cwd: config.cwd,
            stateDir: config.stateDir,
            env: process.env,
            settings: current,
          }),
        ),
        Effect.provide(resolve),
      ),
    });
  }),
);

/**
 * The service with its live side: provided beside the Zerops feeds in
 * `server.ts`, on top of the provider runtime it asks for live state.
 */
export const McpServersLayerLive = layer.pipe(Layer.provide(McpLiveModule.layer));
