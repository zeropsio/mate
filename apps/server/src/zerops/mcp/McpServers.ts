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

import {
  mcpSignInPageRefusal,
  McpServerName,
  McpServersError,
  type McpServerAddInput,
  type McpServerAuth,
  type McpServerFinishSignInInput,
  type McpServerSignIn,
  type McpServerSignInInput,
  type McpSignInLanding,
  type McpServerAgent,
  type McpServerEntry,
  type McpServersList,
  type McpServersListInput,
  type McpServerSetEnabledInput,
  type McpServerTargetInput,
  type McpServerUpdateInput,
  type ProviderDriverKind,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/http";

import { ServerConfig } from "../../config.ts";
import { currentProviderThread } from "../../engineSessionDirectory.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as McpLiveModule from "../../spi/mcpLive.ts";
import {
  landingRefusal,
  McpLive,
  type McpConfigChange,
  type McpLiveServer,
  type McpSignInStart,
} from "../../spi/mcpLive.ts";
import { resolveMcpAgentPaths } from "./mcpAgentPaths.ts";
import {
  MANAGED_MCP_SERVER,
  makeMcpAgentStores,
  McpConfigEditError,
  McpConfigParseError,
  McpConfigUnsupported,
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
  if (cause instanceof McpConfigUnsupported) return cause.message;
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
  /**
   * The Mate's public sign-in page (`mcpSignInPage`): the redirect URI an
   * agent that registers its own sends the browser back to. Absent off a
   * Zerops container, where no public origin names it.
   */
  readonly signInPage?: string | undefined;
  /** Carries a landing to an agent's listener inside the container (`McpSignInStart.listener`). */
  readonly relay?: (target: URL) => Effect.Effect<void, string>;
  /** A fresh, unguessable name for a started sign-in. */
  readonly newId?: Effect.Effect<string>;
}

/** The sign-in page's path, at the server's root: `/mate/mcp/oauth/callback` behind the proxy. */
export const MCP_SIGN_IN_PATH = "/mcp/oauth/callback";

/** The Mate's public sign-in page, when it has a public origin. */
export function mcpSignInPage(
  publicOrigin: string | undefined,
  basePath: string,
): string | undefined {
  if (publicOrigin === undefined) return undefined;
  try {
    return `${new URL(publicOrigin).origin}${basePath}${MCP_SIGN_IN_PATH}`;
  } catch {
    return undefined;
  }
}

/** The redirect URI an authorization URL names, normalized; `undefined` when it names none. */
function redirectOf(url: string): string | undefined {
  try {
    const redirect = new URL(url).searchParams.get("redirect_uri");
    return redirect === null ? undefined : new URL(redirect).href;
  } catch {
    return undefined;
  }
}

/** The landing's query carried to the listener: only the listener's own address is ever asked. */
/**
 * Carries a pasted landing to the agent's own loopback listener (`loopbackRedirect`); its answer
 * is a page. Untraced: the landing's query is a one-time code and its state, which a client span's
 * `url.full` and `url.query` would export.
 */
export const relayToListener =
  (http: HttpClient.HttpClient) =>
  (target: URL): Effect.Effect<void, string> =>
    http.get(target).pipe(
      Effect.flatMap((response) =>
        response.status >= 400
          ? Effect.fail(`the agent's sign-in listener answered ${String(response.status)}`)
          : Effect.void,
      ),
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.fail("the agent's sign-in listener didn't answer in 10 seconds"),
      }),
      Effect.catchTags({
        HttpClientError: () => Effect.fail("the agent's sign-in listener didn't answer"),
      }),
      Effect.scoped,
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
    );

export function relayedLanding(listener: URL, landed: URL): URL {
  const target = new URL(listener.href);
  target.search = landed.search;
  return target;
}

/** How long a started sign-in waits for its landing. */
const SIGN_IN_TTL_MS = 10 * 60 * 1000;
/** How long the agent may take to exchange the code once it has the landing. */
const SIGN_IN_FINISH_TIMEOUT = "60 seconds";

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
    /** Starts the conversation's agent's sign-in to a server that needs one. */
    readonly signIn: (
      input: McpServerSignInInput,
    ) => Effect.Effect<McpServerSignIn, McpServersError>;
    /** Replaces a server's environment or headers for every agent, keeping named values. */
    readonly update: (
      input: McpServerUpdateInput,
    ) => Effect.Effect<McpServersList, McpServersError>;
    /** Drops the conversation's agent's sign-in to a server. */
    readonly signOut: (
      input: McpServerTargetInput,
    ) => Effect.Effect<McpServersList, McpServersError>;
    /** Finishes a `paste` sign-in with the address the browser landed on. */
    readonly finishSignIn: (
      input: McpServerFinishSignInInput,
    ) => Effect.Effect<McpServersList, McpServersError>;
    /**
     * Finishes a `mate` sign-in from its landing on the sign-in page, found by
     * its OAuth `state`; answers the server's name.
     */
    readonly landed: (url: URL) => Effect.Effect<string, McpServersError>;
  }
>()("t3/zerops/mcp/McpServers") {}

/** A sign-in started and not yet landed. */
interface SignInFlow {
  readonly id: string;
  readonly name: string;
  readonly threadId: ThreadId | undefined;
  readonly landing: McpSignInLanding;
  /** The authorization URL's `state`, which the landing must carry back. */
  readonly state: string | undefined;
  readonly start: McpSignInStart;
  readonly expiresAt: number;
}

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
    {
      first: McpConfigServer;
      scopes: Set<string>;
      secretNames: Set<string>;
      auth: McpConfigServer["auth"];
      agents: McpServerAgent[];
    }
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
              ...(liveServer.signedIn !== undefined ? { signedIn: liveServer.signedIn } : {}),
              ...(liveServer.error !== undefined ? { error: liveServer.error } : {}),
              ...(liveServer.tools !== undefined ? { tools: liveServer.tools } : {}),
            }
          : { driver: store.driver, state: server.enabled ? "configured" : "disabled" };
      const found = byName.get(server.name);
      if (found === undefined) {
        byName.set(server.name, {
          first: server,
          scopes: new Set([server.scope]),
          secretNames: new Set(server.secretNames),
          auth: server.auth,
          agents: [agent],
        });
      } else {
        found.scopes.add(server.scope);
        found.auth ??= server.auth;
        for (const secret of server.secretNames) found.secretNames.add(secret);
        found.agents.push(agent);
      }
    }
  }
  return [...byName.values()]
    .map(({ first, scopes, secretNames, auth, agents: serverAgents }) => {
      // An installed agent without it, that couldn't take it as it is set up, says why.
      const cannot = agents.flatMap(({ store }) => {
        if (serverAgents.some((agent) => agent.driver === store.driver)) return [];
        const reason = store.cannot({ transport: first.transport, auth });
        return reason === null ? [] : [{ driver: store.driver, reason }];
      });
      return {
        name: McpServerName.make(first.name),
        transport: first.transport,
        managed: first.name === MANAGED_MCP_SERVER,
        scope: scopes.has("user") ? ("user" as const) : ("project" as const),
        ...(secretNames.size > 0 ? { secretNames: [...secretNames].toSorted() } : {}),
        ...(auth !== undefined ? { auth } : {}),
        ...(cannot.length > 0 ? { cannot } : {}),
        agents: serverAgents,
      };
    })
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
            // An API key is one more header; the rest of a sign-in is each agent's to write.
            ...(input.headers || input.auth?.kind === "header"
              ? {
                  headers: {
                    ...input.headers,
                    ...(input.auth?.kind === "header"
                      ? { [input.auth.name]: input.auth.value }
                      : {}),
                  },
                }
              : {}),
            ...(input.auth !== undefined && input.auth.kind !== "header"
              ? { auth: input.auth }
              : {}),
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
          const reasons = loaded.stores.flatMap((store) => store.cannot(server) ?? []);
          if (reasons.length === loaded.stores.length) {
            return yield* fail(operation, `No agent here can use it. ${reasons.join(" ")}`);
          }
          // A later attempt finds the server its first one already wrote somewhere.
          if (index > 0) return;
          const agents = yield* readAgents(loaded);
          if (agents.some(({ servers }) => servers.some((found) => found.name === input.name))) {
            return yield* fail(operation, `A server named ${input.name} is already set up.`);
          }
        }),
      // An agent that can't use it is left out, and the list says why.
      edit: (store, loaded) =>
        store.cannot(server) === null ? store.add(loaded.files, server) : [],
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

  const newId = options.newId ?? Effect.die("No sign-in names here.");
  const flows = new Map<string, SignInFlow>();
  const liveFlows = Effect.map(Clock.currentTimeMillis, (now) => {
    for (const [id, flow] of flows) if (flow.expiresAt <= now) flows.delete(id);
    return flows;
  });

  const signIn: McpServers["Service"]["signIn"] = (input) =>
    Effect.gen(function* () {
      const operation = "mcp.servers.signIn";
      const session = yield* sessionThread(input.threadId);
      if (session === undefined) {
        return yield* fail(
          operation,
          "Open a conversation with this Mate first: its agent is the one that signs in.",
        );
      }
      const { started } = yield* live
        .signIn(session, input.name, options.signInPage)
        .pipe(
          Effect.mapError((error) =>
            fail(operation, `${input.name} can't sign in: ${error.detail}`, error),
          ),
        );
      if (started === "signed-in") return { kind: "signed-in" } as const;
      // The server names its own sign-in page: only a web address is handed to a browser.
      const refused = mcpSignInPageRefusal(started.url);
      if (refused !== null) {
        return yield* fail(operation, `${input.name} can't sign in: ${refused}.`);
      }
      const page = options.signInPage === undefined ? undefined : new URL(options.signInPage).href;
      const landing: McpSignInLanding =
        page !== undefined && redirectOf(started.url) === page ? "mate" : "paste";
      const open = yield* liveFlows;
      // A newer sign-in to the same server replaces the one it abandoned.
      for (const [id, flow] of open) {
        if (flow.name === input.name && flow.threadId === input.threadId) open.delete(id);
      }
      const id = yield* newId;
      open.set(id, {
        id,
        name: input.name,
        threadId: input.threadId,
        landing,
        state: new URL(started.url).searchParams.get("state") ?? undefined,
        start: started,
        expiresAt: (yield* Clock.currentTimeMillis) + SIGN_IN_TTL_MS,
      });
      return { kind: "open", url: started.url, landing, flow: id } as const;
    });

  /** One landing, once: the flow is spent whether the agent takes it or not. */
  const complete = (operation: string, flow: SignInFlow, landed: URL) =>
    Effect.gen(function* () {
      const refuse = (detail: string) => fail(operation, `${flow.name} didn't sign in: ${detail}`);
      if (flow.state !== undefined && landed.searchParams.get("state") !== flow.state) {
        return yield* refuse("that address belongs to a different sign-in.");
      }
      if (!landed.searchParams.has("code")) return yield* refuse(`${landingRefusal(landed)}.`);
      flows.delete(flow.id);
      const listener = flow.start.listener;
      if (listener !== undefined) {
        if (options.relay === undefined) return yield* refuse("this Mate can't reach the agent.");
        yield* options
          .relay(relayedLanding(listener, landed))
          .pipe(Effect.mapError((detail) => refuse(`${detail}.`)));
      }
      yield* flow.start.finish(landed).pipe(
        Effect.timeoutOrElse({
          duration: SIGN_IN_FINISH_TIMEOUT,
          orElse: () => Effect.fail({ detail: "the agent did not finish in 60 seconds" }),
        }),
        Effect.mapError((error) => refuse(`${error.detail}.`)),
      );
    });

  const finishSignIn: McpServers["Service"]["finishSignIn"] = (input) =>
    Effect.gen(function* () {
      const operation = "mcp.servers.finishSignIn";
      const flow = (yield* liveFlows).get(input.flow);
      if (flow === undefined || flow.name !== input.name) {
        return yield* fail(
          operation,
          `This sign-in to ${input.name} has ended. Press Sign in to start again.`,
        );
      }
      let landed: URL;
      try {
        landed = new URL(input.landed);
      } catch {
        return yield* fail(operation, "Paste the whole address from the browser's address bar.");
      }
      yield* complete(operation, flow, landed);
      return yield* list(operation, input.threadId);
    });

  const landed: McpServers["Service"]["landed"] = (url) =>
    Effect.gen(function* () {
      const operation = "mcp.servers.landed";
      const state = url.searchParams.get("state");
      const flow = [...(yield* liveFlows).values()].find(
        (candidate) => candidate.landing === "mate" && state !== null && candidate.state === state,
      );
      if (flow === undefined) {
        return yield* fail(operation, "This Mate isn't waiting for this sign-in any more.");
      }
      yield* complete(operation, flow, url);
      return flow.name;
    });

  const update: McpServers["Service"]["update"] = (input) => {
    // Each agent's server as it will stand, for its running sessions.
    const changed = new Map<string, Readonly<Record<string, unknown>>>();
    return change({
      operation: "mcp.servers.update",
      name: input.name,
      done: "changed",
      threadId: input.threadId,
      check: target("mcp.servers.update", input.name),
      edit: (store, loaded) => {
        const server = store.read(loaded.files).find((found) => found.name === input.name);
        if (server === undefined || server.scope !== "user") return [];
        const stored = store.readSecrets(loaded.files, input.name);
        const values: Record<string, string> = { ...input.values };
        // An API key is a header, and a server reached by one signs in no other way.
        if (input.auth?.kind === "header") values[input.auth.name] = input.auth.value;
        for (const name of input.keep) {
          const kept = stored[name];
          if (kept !== undefined && !(name in values)) values[name] = kept;
        }
        const secrets = store.setSecrets(loaded.files, input.name, values);
        const auth: McpServerAuth | undefined =
          input.auth?.kind === "header" ? { kind: "none" } : input.auth;
        if (auth !== undefined) {
          const reason = store.cannot({ transport: server.transport, auth });
          if (reason !== null) throw new McpConfigUnsupported(reason);
        }
        // The sign-in is changed over the secrets' change, in the same files.
        const afterSecrets = new Map(loaded.files);
        for (const edit of secrets) afterSecrets.set(edit.path, edit.text);
        const authEdits = auth === undefined ? [] : store.setAuth(afterSecrets, input.name, auth);
        const edits = [
          ...secrets.filter((edit) => !authEdits.some((later) => later.path === edit.path)),
          ...authEdits,
        ];
        // Running sessions get the server as written, its on/off mark and own app included.
        const after = new Map(afterSecrets);
        for (const edit of authEdits) after.set(edit.path, edit.text);
        const written = store.stored(after, input.name);
        if (written !== undefined) changed.set(store.driver, written);
        return edits;
      },
      nudge: (store) => ({
        kind: "changed",
        name: input.name,
        entry: changed.get(store.driver) ?? {},
      }),
    });
  };

  const signOut: McpServers["Service"]["signOut"] = (input) =>
    Effect.gen(function* () {
      const operation = "mcp.servers.signOut";
      const session = yield* sessionThread(input.threadId);
      if (session === undefined) {
        return yield* fail(
          operation,
          "Open a conversation with this Mate first: its agent is the one that signs out.",
        );
      }
      yield* live
        .signOut(session, input.name)
        .pipe(
          Effect.mapError((error) =>
            fail(operation, `${input.name} can't sign out: ${error.detail}`, error),
          ),
        );
      return yield* list(operation, input.threadId);
    });

  return {
    list: (input) => list("mcp.servers.list", input.threadId),
    signOut,
    update,
    add,
    remove,
    setEnabled,
    reconnect,
    signIn,
    finishSignIn,
    landed,
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
    const http = yield* HttpClient.HttpClient;
    const crypto = yield* Crypto.Crypto;
    const resolve =
      yield* Effect.context<Effect.Services<ReturnType<typeof resolveMcpAgentPaths>>>();
    return yield* make({
      files,
      live,
      signInPage: mcpSignInPage(config.zerops?.publicOrigin, config.basePath),
      newId: crypto.randomUUIDv4.pipe(Effect.orDie),
      relay: relayToListener(http),
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
            homeDir: config.homeDir,
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
