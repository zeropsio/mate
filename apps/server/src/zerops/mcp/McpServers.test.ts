import {
  McpServersError,
  ProviderDriverKind,
  ThreadId,
  type McpServerAddInput,
  type McpServersList,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ProviderMcpError, type McpConfigChange, type McpLiveServer } from "../../spi/mcpLive.ts";
import { type McpAgentPaths } from "./mcpAgents.ts";
import { make, mcpAgentPaths, type McpLiveAccess } from "./McpServers.ts";

const HOME = "/home/zerops";
const PATHS: McpAgentPaths = mcpAgentPaths({
  homeDir: HOME,
  cwd: "/var/www",
  env: {},
  settings: {
    providers: { claudeAgent: { homePath: "" }, codex: { homePath: "" } } as never,
    providerInstances: {},
  },
});

const ZCP = { command: "zcp", args: ["serve"] };

/** Every agent's config as `zcp init` leaves it in a container. */
const zcpFiles = (): Map<string, string> =>
  new Map([
    [`${HOME}/.claude.json`, JSON.stringify({ mcpServers: { zerops: ZCP } })],
    [
      `${HOME}/.codex/config.toml`,
      '[mcp_servers.zerops]\ncommand = "zcp"\nargs = ["serve"]\nstartup_timeout_sec = 30\n',
    ],
    [
      `${HOME}/.cursor/mcp.json`,
      JSON.stringify({ mcpServers: { zerops: { type: "stdio", ...ZCP } } }),
    ],
    [
      `${HOME}/.grok/config.toml`,
      '[mcp_servers.zerops]\ncommand = "zcp"\nargs = ["serve"]\nenabled = true\n',
    ],
    [`${HOME}/.gemini/config/mcp_config.json`, JSON.stringify({ mcpServers: { zerops: ZCP } })],
    [
      "/var/www/.mcp.json",
      JSON.stringify({ mcpServers: { playwright: { command: "npx", args: ["@playwright/mcp"] } } }),
    ],
  ]);

const ALL_AGENTS = ["claudeAgent", "codex", "cursor", "opencode", "grok", "antigravity"];

const THREAD = ThreadId.make("thread-1");

const parseJson = (text: string): { readonly mcpServers?: unknown } => JSON.parse(text);

interface Rig {
  readonly files: Map<string, string>;
  readonly writes: string[];
  readonly calls: string[];
}

const setup = (input: {
  readonly installed?: ReadonlyArray<string>;
  readonly files?: Map<string, string>;
  readonly running?: {
    readonly driver: string;
    readonly servers: ReadonlyArray<McpLiveServer>;
    readonly reconnectFails?: boolean;
  };
}) =>
  Effect.gen(function* () {
    const rig: Rig = { files: input.files ?? zcpFiles(), writes: [], calls: [] };
    const live: McpLiveAccess = {
      installedDrivers: Effect.succeed(
        (input.installed ?? ALL_AGENTS).map((driver) => ProviderDriverKind.make(driver)),
      ),
      status: (threadId) =>
        Effect.succeed(
          threadId === THREAD && input.running !== undefined
            ? {
                driver: ProviderDriverKind.make(input.running.driver),
                servers: input.running.servers,
              }
            : undefined,
        ),
      reconnect: (_threadId, name) =>
        input.running?.reconnectFails
          ? Effect.fail(new ProviderMcpError({ detail: "spawn ENOENT" }))
          : Effect.sync(() => {
              rig.calls.push(`reconnect ${name}`);
            }),
      setEnabled: () => Effect.void,
      configChanged: (driver, change: McpConfigChange) =>
        Effect.sync(() => {
          rig.calls.push(`${driver} ${change.kind} ${change.name}`);
        }),
    };
    const service = yield* make({
      live,
      paths: Effect.succeed(PATHS),
      files: {
        read: (path) => Effect.succeed(rig.files.get(path)),
        write: (path, text) =>
          Effect.sync(() => {
            rig.files.set(path, text);
            rig.writes.push(path);
          }),
      },
    });
    return { service, rig };
  });

const view = (list: McpServersList) =>
  list.servers.map(
    (server) =>
      `${server.name}${server.managed ? " (managed)" : ""}${server.scope === "project" ? " (project)" : ""}: ${server.agents
        .map((agent) => `${agent.driver}=${agent.state}`)
        .join(" ")}`,
  );

const LINEAR: McpServerAddInput = {
  name: "linear" as McpServerAddInput["name"],
  transport: { type: "stdio", command: "npx", args: ["-y", "linear-mcp"] },
  env: { LINEAR_KEY: "k" },
  headers: { Ignored: "for a command" },
};

describe("McpServers.list", () => {
  it.effect("merges every installed agent's servers by name, zcp's first", () =>
    Effect.gen(function* () {
      const { service } = yield* setup({});
      const list = yield* service.list({});
      expect(view(list)).toEqual([
        "zerops (managed): claudeAgent=configured codex=configured cursor=configured grok=configured antigravity=configured",
        "playwright (project): claudeAgent=configured",
      ]);
      expect(list.agents).toEqual(ALL_AGENTS);
    }),
  );

  it.effect("reads only the agents installed here", () =>
    Effect.gen(function* () {
      const { service } = yield* setup({ installed: ["codex", "grok"] });
      expect(view(yield* service.list({}))).toEqual([
        "zerops (managed): codex=configured grok=configured",
      ]);
    }),
  );

  it.effect("lays the thread's running agent's state over its config", () =>
    Effect.gen(function* () {
      const { service } = yield* setup({
        running: {
          driver: "codex",
          servers: [
            { name: "zerops", state: "connected", tools: [{ name: "zerops_discover" }] },
            { name: "not-configured", state: "connected" },
          ],
        },
      });
      const list = yield* service.list({ threadId: THREAD });
      expect(view(list)[0]).toBe(
        "zerops (managed): claudeAgent=configured codex=connected cursor=configured grok=configured antigravity=configured",
      );
      expect(list.servers[0]?.agents[1]?.tools).toEqual([{ name: "zerops_discover" }]);
      expect(list.servers.map((server) => server.name)).not.toContain("not-configured");
    }),
  );

  it.effect("leaves out a config it cannot parse instead of failing the tab", () =>
    Effect.gen(function* () {
      const files = zcpFiles();
      files.set(`${HOME}/.codex/config.toml`, "[mcp_servers.zerops\n");
      const { service } = yield* setup({ files });
      expect(view(yield* service.list({}))[0]).toBe(
        "zerops (managed): claudeAgent=configured cursor=configured grok=configured antigravity=configured",
      );
    }),
  );
});

describe("McpServers.add", () => {
  it.effect("writes the server for every installed agent and tells the running ones", () =>
    Effect.gen(function* () {
      const { service, rig } = yield* setup({});
      const list = yield* service.add(LINEAR);
      expect(view(list)).toContain(
        "linear: claudeAgent=configured codex=configured cursor=configured opencode=configured grok=configured antigravity=configured",
      );
      expect(rig.writes.toSorted()).toEqual(
        [
          `${HOME}/.claude.json`,
          `${HOME}/.codex/config.toml`,
          `${HOME}/.cursor/mcp.json`,
          `${HOME}/.config/opencode/opencode.json`,
          `${HOME}/.grok/config.toml`,
          `${HOME}/.gemini/config/mcp_config.json`,
        ].toSorted(),
      );
      expect(rig.calls).toEqual(ALL_AGENTS.map((driver) => `${driver} added linear`));
      // zcp's server stays, and a command never carries headers.
      expect(parseJson(rig.files.get(`${HOME}/.claude.json`)!).mcpServers).toEqual({
        zerops: ZCP,
        linear: {
          type: "stdio",
          command: "npx",
          args: ["-y", "linear-mcp"],
          env: { LINEAR_KEY: "k" },
        },
      });
    }),
  );

  it.effect.each([
    ["zerops", "Zerops' own server can't be changed here."],
    ["playwright", "A server named playwright is already set up."],
  ])("refuses %s", ([name, detail]) =>
    Effect.gen(function* () {
      const { service, rig } = yield* setup({});
      const error = yield* Effect.flip(
        service.add({ ...LINEAR, name: name as McpServerAddInput["name"] }),
      );
      expect(error).toBeInstanceOf(McpServersError);
      expect(error.detail).toBe(detail);
      expect(rig.writes).toEqual([]);
    }),
  );

  it.effect("writes nothing when one agent's config cannot be parsed, and says which", () =>
    Effect.gen(function* () {
      const files = zcpFiles();
      files.set(`${HOME}/.cursor/mcp.json`, "{ broken");
      const { service, rig } = yield* setup({ files });
      const error = yield* Effect.flip(service.add(LINEAR));
      expect(error.detail).toBe(
        `Cursor's config at ${HOME}/.cursor/mcp.json could not be read, so nothing was changed. Fix or remove that file and try again.`,
      );
      expect(rig.writes).toEqual([]);
    }),
  );
});

describe("McpServers.remove and setEnabled", () => {
  it.effect.each([
    ["zerops", "Zerops' own server can't be changed here."],
    ["nope", "There is no server named nope."],
    [
      "playwright",
      "playwright is set up in the project's .mcp.json, so it is changed there, not here.",
    ],
  ])("refuse %s", ([name, detail]) =>
    Effect.gen(function* () {
      const { service, rig } = yield* setup({});
      const target = { name: name as McpServerAddInput["name"] };
      expect((yield* Effect.flip(service.remove(target))).detail).toBe(detail);
      expect((yield* Effect.flip(service.setEnabled({ ...target, enabled: false }))).detail).toBe(
        detail,
      );
      expect(rig.writes).toEqual([]);
    }),
  );

  it.effect("turns a server off and on for every agent, then removes it", () =>
    Effect.gen(function* () {
      const { service, rig } = yield* setup({});
      yield* service.add(LINEAR);
      rig.calls.length = 0;
      const off = yield* service.setEnabled({ name: LINEAR.name, enabled: false });
      expect(view(off)).toContain(
        "linear: claudeAgent=disabled codex=disabled cursor=disabled opencode=disabled grok=disabled antigravity=disabled",
      );
      expect(rig.calls).toEqual(ALL_AGENTS.map((driver) => `${driver} enabled linear`));
      const on = yield* service.setEnabled({ name: LINEAR.name, enabled: true });
      expect(view(on)).toContain(
        "linear: claudeAgent=configured codex=configured cursor=configured opencode=configured grok=configured antigravity=configured",
      );
      const removed = yield* service.remove({ name: LINEAR.name });
      expect(removed.servers.map((server) => server.name)).toEqual(["zerops", "playwright"]);
      expect(rig.files.get(`${HOME}/.codex/config.toml`)).toBe(
        zcpFiles().get(`${HOME}/.codex/config.toml`),
      );
    }),
  );
});

describe("McpServers.reconnect", () => {
  it.effect("reconnects in the thread's running session, zcp's server included", () =>
    Effect.gen(function* () {
      const { service, rig } = yield* setup({
        running: { driver: "claudeAgent", servers: [{ name: "zerops", state: "failed" }] },
      });
      yield* service.reconnect({ name: "zerops" as McpServerAddInput["name"], threadId: THREAD });
      expect(rig.calls).toEqual(["reconnect zerops"]);
    }),
  );

  it.effect("returns the list without a running session", () =>
    Effect.gen(function* () {
      const { service, rig } = yield* setup({});
      const list = yield* service.reconnect({ name: "zerops" as McpServerAddInput["name"] });
      expect(list.servers[0]?.name).toBe("zerops");
      expect(rig.calls).toEqual([]);
    }),
  );

  it.effect("says why a reconnect failed", () =>
    Effect.gen(function* () {
      const { service } = yield* setup({
        running: { driver: "claudeAgent", servers: [], reconnectFails: true },
      });
      const error = yield* Effect.flip(
        service.reconnect({ name: "zerops" as McpServerAddInput["name"], threadId: THREAD }),
      );
      expect(error.detail).toBe("zerops could not reconnect: spawn ENOENT");
    }),
  );
});

describe("mcpAgentPaths", () => {
  it("names every Claude and Codex home the instances use, the defaults first", () => {
    const paths = mcpAgentPaths({
      homeDir: HOME,
      cwd: "/var/www/",
      env: { XDG_CONFIG_HOME: "/xdg", GROK_HOME: "/g" },
      settings: {
        providers: { claudeAgent: { homePath: "" }, codex: { homePath: "~/.codex" } } as never,
        providerInstances: {
          "claudeAgent-2": {
            driver: ProviderDriverKind.make("claudeAgent"),
            config: { homePath: "~/.mate/logins/claudeAgent-2" },
          },
          "codex-2": {
            driver: ProviderDriverKind.make("codex"),
            config: { shadowHomePath: "~/.mate/logins/codex-2" },
          },
        } as never,
      },
    });
    expect(paths).toEqual({
      cwd: "/var/www",
      claudeConfigs: [`${HOME}/.claude.json`, `${HOME}/.mate/logins/claudeAgent-2/.claude.json`],
      codexConfigs: [`${HOME}/.codex/config.toml`],
      cursorHome: `${HOME}/.cursor`,
      grokConfig: "/g/config.toml",
      antigravityConfig: `${HOME}/.gemini/config/mcp_config.json`,
      openCodeConfig: "/xdg/opencode/opencode.json",
    });
  });
});
