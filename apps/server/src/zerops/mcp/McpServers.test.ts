import {
  McpServersError,
  ProviderDriverKind,
  ThreadId,
  type McpServerAddInput,
  type McpServersList,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { inertMateEngine, MateEngine } from "../../engine/MateEngine.ts";
import { ProviderMcpError, type McpConfigChange, type McpLiveServer } from "../../spi/mcpLive.ts";
import { antigravityProfileDirectory } from "../../spi/driverHomes.ts";
import { mcpAgentPaths, resolveMcpAgentPaths } from "./mcpAgentPaths.ts";
import { type McpAgentPaths } from "./mcpAgents.ts";
import { McpFileConflict } from "./mcpFileStore.ts";
import { make, nodeFileStore, type McpLiveAccess } from "./McpServers.ts";

const HOME = "/home/zerops";
const PATHS: McpAgentPaths = mcpAgentPaths({
  homeDir: HOME,
  cwd: "/var/www",
  env: {},
  claudeConfigs: [`${HOME}/.claude.json`],
  codexConfigs: [`${HOME}/.codex/config.toml`],
  antigravityConfigs: [`${HOME}/.gemini/config/mcp_config.json`],
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
  readonly locks: string[];
}

const setup = (input: {
  readonly generation?: number;
  readonly installed?: ReadonlyArray<string>;
  readonly files?: Map<string, string>;
  readonly running?: {
    readonly thread?: ThreadId;
    readonly driver: string;
    readonly servers: ReadonlyArray<McpLiveServer>;
    readonly reconnectFails?: boolean;
  };
  /** An agent writes this file once, between Mate's read and Mate's write. */
  readonly agentWritesOnce?: { readonly path: string; readonly text: string };
}) =>
  Effect.gen(function* () {
    const rig: Rig = { files: input.files ?? zcpFiles(), writes: [], calls: [], locks: [] };
    let agentWrite = input.agentWritesOnce;
    const live: McpLiveAccess = {
      installedDrivers: Effect.succeed(
        (input.installed ?? ALL_AGENTS).map((driver) => ProviderDriverKind.make(driver)),
      ),
      status: (threadId) =>
        Effect.succeed(
          threadId === (input.running?.thread ?? THREAD) && input.running !== undefined
            ? {
                driver: ProviderDriverKind.make(input.running.driver),
                servers: input.running.servers,
              }
            : undefined,
        ),
      reconnect: (threadId, name) =>
        input.running?.reconnectFails
          ? Effect.fail(new ProviderMcpError({ detail: "spawn ENOENT" }))
          : Effect.sync(() => {
              expect(threadId).toBe(input.running?.thread ?? THREAD);
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
        write: (path, text, base) =>
          Effect.suspend(() => {
            if (agentWrite?.path === path) {
              rig.files.set(path, agentWrite.text);
              agentWrite = undefined;
            }
            if (rig.files.get(path) !== base) return Effect.fail(new McpFileConflict({ path }));
            rig.files.set(path, text);
            rig.writes.push(path);
            return Effect.void;
          }),
        locked: (paths, effect) =>
          Effect.sync(() => rig.locks.push(...paths)).pipe(Effect.andThen(effect)),
      },
    }).pipe(
      Effect.provide(
        Layer.succeed(MateEngine, {
          ...inertMateEngine,
          live: input.generation !== undefined,
          generation: () => Effect.succeed(input.generation),
        }),
      ),
    );
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
  it.effect.each([
    {
      state: "connected" as const,
      tools: [{ name: "zerops_discover", description: "Inspect the project" }],
    },
    { state: "failed" as const, error: "zcp exited with code 1" },
    { state: "configured" as const },
  ])("the built-in server reports $state from the engine's current session", (report) =>
    Effect.gen(function* () {
      const { service, rig } = yield* setup({
        generation: 3,
        installed: ["claudeAgent"],
        running: {
          thread: ThreadId.make("thread-1/s/3"),
          driver: "claudeAgent",
          servers: report.state === "configured" ? [] : [{ name: "zerops", ...report }],
        },
      });
      const list = yield* service.list({ threadId: THREAD });
      expect(list.servers.find((server) => server.name === "zerops")?.agents).toEqual([
        { driver: "claudeAgent", ...report },
      ]);
      if (report.state !== "configured") {
        expect(yield* service.reconnect({ threadId: THREAD, name: "zerops" })).toEqual(list);
        expect(rig.calls).toEqual(["reconnect zerops"]);
      }
    }),
  );

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

  it.effect("writes the agents it can and names the one it left alone", () =>
    Effect.gen(function* () {
      const files = zcpFiles();
      files.set(`${HOME}/.cursor/mcp.json`, "{ broken");
      const { service, rig } = yield* setup({ files });
      const error = yield* Effect.flip(service.add(LINEAR));
      expect(error.detail).toBe(
        `linear was added for Claude Code, Codex, OpenCode, Grok and Antigravity, not for the rest. Cursor's config at ${HOME}/.cursor/mcp.json isn't valid (InvalidSymbol at offset 2), so Mate left it as it is.`,
      );
      expect(rig.writes).not.toContain(`${HOME}/.cursor/mcp.json`);
      expect(rig.writes).toContain(`${HOME}/.claude.json`);
      expect(rig.calls).not.toContain("cursor added linear");
    }),
  );

  it.effect("answers with the conversation's live state when it names one", () =>
    Effect.gen(function* () {
      const { service } = yield* setup({
        running: { driver: "claudeAgent", servers: [{ name: "linear", state: "connecting" }] },
      });
      const list = yield* service.add({ ...LINEAR, threadId: THREAD });
      const linear = list.servers.find((server) => server.name === "linear");
      expect(linear?.agents[0]).toEqual({ driver: "claudeAgent", state: "connecting" });
    }),
  );

  it.effect("plans again over a file an agent wrote meanwhile, under Claude's lock", () =>
    Effect.gen(function* () {
      const agentText = `{"mcpServers":{"zerops":{"command":"zcp","args":["serve"]}},"numStartups":9}`;
      const { service, rig } = yield* setup({
        agentWritesOnce: { path: `${HOME}/.claude.json`, text: agentText },
      });
      yield* service.add(LINEAR);
      const claude = parseJson(rig.files.get(`${HOME}/.claude.json`)!) as {
        readonly numStartups?: number;
        readonly mcpServers: Record<string, unknown>;
      };
      expect(claude.numStartups).toBe(9);
      expect(Object.keys(claude.mcpServers)).toEqual(["zerops", "linear"]);
      expect(rig.locks).toEqual([`${HOME}/.claude.json`]);
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

it.layer(NodeServices.layer, { excludeTestServices: true })("nodeFileStore", (it) => {
  it.effect("writes a config whole, through a link, keeping its permissions", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const store = yield* nodeFileStore;

      // A new file is private to its owner: it can hold keys.
      yield* store.write(`${dir}/new/.claude.json`, "{}\n", undefined);
      expect(yield* store.read(`${dir}/new/.claude.json`)).toBe("{}\n");
      expect((yield* fs.stat(`${dir}/new/.claude.json`)).mode & 0o777).toBe(0o600);

      // A shadow home's link keeps pointing at the shared file the write replaced.
      yield* fs.writeFileString(`${dir}/shared.toml`, "a = 1\n", { mode: 0o640 });
      yield* fs.chmod(`${dir}/shared.toml`, 0o640);
      yield* fs.symlink(`${dir}/shared.toml`, `${dir}/link.toml`);
      yield* store.write(`${dir}/link.toml`, "a = 2\n", "a = 1\n");
      expect(yield* fs.readLink(`${dir}/link.toml`)).toBe(`${dir}/shared.toml`);
      expect(yield* fs.readFileString(`${dir}/shared.toml`)).toBe("a = 2\n");
      expect((yield* fs.stat(`${dir}/shared.toml`)).mode & 0o777).toBe(0o640);

      expect(yield* store.read(`${dir}/missing.json`)).toBeUndefined();
      expect((yield* fs.readDirectory(dir)).toSorted()).toEqual([
        "link.toml",
        "new",
        "shared.toml",
      ]);
    }),
  );

  it.effect("refuses to write over a file that changed since it was read", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const store = yield* nodeFileStore;
      yield* fs.writeFileString(`${dir}/config.toml`, "a = 2\n");
      const refused = yield* Effect.flip(store.write(`${dir}/config.toml`, "a = 3\n", "a = 1\n"));
      expect(refused).toBeInstanceOf(McpFileConflict);
      expect(yield* fs.readFileString(`${dir}/config.toml`)).toBe("a = 2\n");
    }),
  );

  it.effect("holds Claude Code's lock on .claude.json while it writes, past a stale one", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const store = yield* nodeFileStore;
      const lock = `${dir}/.claude.json.lock`;
      // A lock left by a Claude that died: untouched for a minute.
      yield* fs.makeDirectory(lock);
      const minuteAgo = DateTime.toDateUtc(DateTime.subtract(yield* DateTime.now, { minutes: 1 }));
      yield* fs.utimes(lock, minuteAgo, minuteAgo);
      const seen = yield* store.locked(
        [`${dir}/.claude.json`, `${dir}/config.toml`],
        Effect.all([fs.exists(lock), fs.exists(`${dir}/config.toml.lock`)]),
      );
      expect(seen).toEqual([true, false]);
      expect(yield* fs.exists(lock)).toBe(false);
    }),
  );

  it.effect("resolves each home the way its driver does", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const stateDir = `${dir}/state`;
      // One Antigravity profile keeps a file of its own; the default's links to ~/.gemini.
      const own = `${antigravityProfileDirectory(stateDir, "antigravity-2" as never)}/config`;
      yield* fs.makeDirectory(own, { recursive: true });
      yield* fs.writeFileString(`${own}/mcp_config.json`, "{}");
      const linked = `${antigravityProfileDirectory(stateDir, "antigravity" as never)}/config`;
      yield* fs.makeDirectory(linked, { recursive: true });
      yield* fs.symlink(`${dir}/home/.gemini/config/mcp_config.json`, `${linked}/mcp_config.json`);

      const paths = yield* resolveMcpAgentPaths({
        homeDir: `${dir}/home`,
        cwd: "/var/www/",
        stateDir,
        env: { CODEX_HOME: `${dir}/codex-env`, XDG_CONFIG_HOME: "/xdg", GROK_HOME: "/g" },
        settings: {
          providers: {
            claudeAgent: { homePath: "" },
            codex: { homePath: "", shadowHomePath: "" },
          } as never,
          providerInstances: {
            "claudeAgent-2": {
              driver: ProviderDriverKind.make("claudeAgent"),
              config: { homePath: `${dir}/logins/claudeAgent-2` },
            },
            "claudeAgent-env": {
              driver: ProviderDriverKind.make("claudeAgent"),
              environment: [{ name: "CLAUDE_CONFIG_DIR", value: `${dir}/claude-env` }],
            },
            "codex-2": {
              driver: ProviderDriverKind.make("codex"),
              config: { shadowHomePath: `${dir}/logins/codex-2` },
            },
            "antigravity-2": { driver: ProviderDriverKind.make("antigravity") },
          } as never,
        },
      });
      expect(paths).toEqual({
        cwd: "/var/www",
        claudeConfigs: [
          `${dir}/home/.claude.json`,
          `${dir}/logins/claudeAgent-2/.claude.json`,
          `${dir}/claude-env/.claude.json`,
        ],
        // The default inherits CODEX_HOME; a login's shadow home links to the shared ~/.codex.
        codexConfigs: [
          `${dir}/codex-env/config.toml`,
          expect.stringMatching(/\/\.codex\/config\.toml$/),
        ],
        cursorHome: `${dir}/home/.cursor`,
        grokConfig: "/g/config.toml",
        antigravityConfigs: [
          `${dir}/home/.gemini/config/mcp_config.json`,
          `${own}/mcp_config.json`,
        ],
        openCodeConfig: "/xdg/opencode/opencode.json",
      });
    }),
  );
});
