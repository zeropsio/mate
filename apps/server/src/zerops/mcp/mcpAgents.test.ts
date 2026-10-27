import type { McpServerAddInput } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  cursorProjectDir,
  McpConfigEditError,
  McpConfigParseError,
  decodeMcpTransport,
  makeMcpAgentStores,
  type McpAgentPaths,
  type McpFileEdit,
  type McpFiles,
} from "./mcpAgents.ts";

const PATHS: McpAgentPaths = {
  cwd: "/var/www",
  claudeConfigs: [
    "/home/zerops/.claude.json",
    "/home/zerops/.mate/logins/claudeAgent-2/.claude.json",
  ],
  codexConfigs: ["/home/zerops/.codex/config.toml"],
  cursorHome: "/home/zerops/.cursor",
  grokConfig: "/home/zerops/.grok/config.toml",
  antigravityConfigs: ["/home/zerops/.gemini/config/mcp_config.json"],
  openCodeConfig: "/home/zerops/.config/opencode/opencode.json",
};

const CURSOR_DISABLED = "/home/zerops/.cursor/projects/var-www/mcp-disabled.json";

/** Each agent's files as `zcp init` leaves them, next to things a person added by hand. */
const ZCP_FILES: McpFiles = new Map([
  [
    PATHS.claudeConfigs[0]!,
    JSON.stringify({
      numStartups: 3,
      mcpServers: {
        zerops: { command: "zcp", args: ["serve"] },
        sentry: { type: "http", url: "https://mcp.sentry.dev/mcp" },
      },
      projects: { "/var/www": { hasTrustDialogAccepted: true, disabledMcpServers: ["sentry"] } },
    }),
  ],
  [
    PATHS.claudeConfigs[1]!,
    JSON.stringify({ mcpServers: { zerops: { command: "zcp", args: ["serve"] } } }),
  ],
  [
    "/var/www/.mcp.json",
    JSON.stringify({
      mcpServers: { playwright: { command: "npx", args: ["@playwright/mcp"] } },
    }),
  ],
  [
    PATHS.codexConfigs[0]!,
    `model = "gpt-5.5"

[mcp_servers.zerops]
command = "zcp"
args = ["serve"]
startup_timeout_sec = 30
env_vars = ["ZCP_API_KEY"]

[mcp_servers.off]
command = "off"
args = []
enabled = false

[projects."/var/www"]
trust_level = "trusted"
`,
  ],
  [
    "/home/zerops/.cursor/mcp.json",
    JSON.stringify({
      mcpServers: {
        zerops: {
          type: "stdio",
          command: "zcp",
          args: ["serve"],
          env: { ZCP_API_KEY: "${env:ZCP_API_KEY}" },
        },
      },
    }),
  ],
  [
    PATHS.grokConfig,
    '[cli]\ntheme = "x"\n\n[mcp_servers.zerops]\ncommand = "zcp"\nargs = ["serve"]\nenabled = true\n',
  ],
  [
    PATHS.antigravityConfigs[0]!,
    JSON.stringify({
      mcpServers: {
        zerops: {
          command: "zcp",
          args: ["serve"],
          trust: true,
          description: "Zerops platform MCP server",
        },
        notion: { serverUrl: "https://mcp.notion.com/mcp", disabled: true },
      },
    }),
  ],
  [
    PATHS.openCodeConfig,
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      model: "anthropic/claude",
      mcp: { local: { type: "local", command: ["bunx", "thing"], enabled: false } },
    }),
  ],
]);

const stores = makeMcpAgentStores(PATHS);
const store = (driver: string) => {
  const found = [...stores.values()].find((candidate) => candidate.driver === driver);
  if (found === undefined) throw new Error(driver);
  return found;
};

const apply = (files: McpFiles, edits: ReadonlyArray<McpFileEdit>): McpFiles => {
  const next = new Map(files);
  for (const edit of edits) next.set(edit.path, edit.text);
  return next;
};

const summary = (driver: string, files: McpFiles) =>
  store(driver)
    .read(files)
    .map((server) => `${server.name}:${server.enabled ? "on" : "off"}:${server.scope}`);

const STDIO: McpServerAddInput = {
  name: "linear",
  transport: { type: "stdio", command: "npx", args: ["-y", "linear-mcp"] },
  env: { LINEAR_KEY: "k" },
};
const HTTP: McpServerAddInput = {
  name: "docs",
  transport: { type: "http", url: "https://docs.dev/mcp" },
  headers: { Authorization: "Bearer t" },
};

describe("reading each agent's config", () => {
  it.each([
    ["claudeAgent", ["zerops:on:user", "sentry:off:user", "playwright:on:project"]],
    ["codex", ["zerops:on:user", "off:off:user"]],
    ["cursor", ["zerops:on:user"]],
    ["grok", ["zerops:on:user"]],
    ["antigravity", ["zerops:on:user", "notion:off:user"]],
    ["opencode", ["local:off:user"]],
  ])("%s", (driver, expected) => {
    expect(summary(driver, ZCP_FILES)).toEqual(expected);
  });

  it.each(["claudeAgent", "codex", "cursor", "grok", "antigravity", "opencode"])(
    "%s reads no files as no servers",
    (driver) => {
      expect(store(driver).read(new Map())).toEqual([]);
    },
  );

  it("reads each transport", () => {
    expect(
      store("claudeAgent")
        .read(ZCP_FILES)
        .map((server) => server.transport),
    ).toEqual([
      { type: "stdio", command: "zcp", args: ["serve"] },
      { type: "http", url: "https://mcp.sentry.dev/mcp" },
      { type: "stdio", command: "npx", args: ["@playwright/mcp"] },
    ]);
  });
});

describe("adding a server", () => {
  it.each([
    [
      "claudeAgent",
      ["zerops:on:user", "sentry:off:user", "linear:on:user", "playwright:on:project"],
    ],
    ["codex", ["zerops:on:user", "off:off:user", "linear:on:user"]],
    ["cursor", ["zerops:on:user", "linear:on:user"]],
    ["grok", ["zerops:on:user", "linear:on:user"]],
    ["antigravity", ["zerops:on:user", "notion:off:user", "linear:on:user"]],
    ["opencode", ["local:off:user", "linear:on:user"]],
  ])("%s keeps every other server", (driver, expected) => {
    const files = apply(ZCP_FILES, store(driver).add(ZCP_FILES, STDIO));
    expect(summary(driver, files)).toEqual(expected);
  });

  it.each(["claudeAgent", "codex", "cursor", "grok", "antigravity", "opencode"])(
    "%s reads back the transport it wrote",
    (driver) => {
      for (const input of [STDIO, HTTP]) {
        const files = apply(ZCP_FILES, store(driver).add(ZCP_FILES, input));
        expect(
          store(driver)
            .read(files)
            .find((server) => server.name === input.name)?.transport,
        ).toEqual(input.transport);
      }
    },
  );

  it("writes every Claude home", () => {
    const edits = store("claudeAgent").add(ZCP_FILES, STDIO);
    expect(edits.map((edit) => edit.path)).toEqual(PATHS.claudeConfigs);
  });

  it.each([
    [
      "claudeAgent",
      PATHS.claudeConfigs[0]!,
      (doc: any) => doc.mcpServers.linear,
      { type: "stdio", command: "npx", args: ["-y", "linear-mcp"], env: { LINEAR_KEY: "k" } },
    ],
    [
      "cursor",
      "/home/zerops/.cursor/mcp.json",
      (doc: any) => doc.mcpServers.linear,
      { type: "stdio", command: "npx", args: ["-y", "linear-mcp"], env: { LINEAR_KEY: "k" } },
    ],
    [
      "antigravity",
      PATHS.antigravityConfigs[0]!,
      (doc: any) => doc.mcpServers.linear,
      { command: "npx", args: ["-y", "linear-mcp"], env: { LINEAR_KEY: "k" } },
    ],
    [
      "opencode",
      PATHS.openCodeConfig,
      (doc: any) => doc.mcp.linear,
      {
        type: "local",
        command: ["npx", "-y", "linear-mcp"],
        environment: { LINEAR_KEY: "k" },
        enabled: true,
      },
    ],
  ])("stores a command's env the way %s expects", (driver, path, pick, expected) => {
    const edit = store(driver)
      .add(ZCP_FILES, STDIO)
      .find((candidate) => candidate.path === path);
    expect(pick(JSON.parse(edit!.text))).toEqual(expected);
  });

  it.each([
    [
      "claudeAgent",
      PATHS.claudeConfigs[0]!,
      (doc: any) => doc.mcpServers.docs,
      { type: "http", url: "https://docs.dev/mcp", headers: { Authorization: "Bearer t" } },
    ],
    [
      "cursor",
      "/home/zerops/.cursor/mcp.json",
      (doc: any) => doc.mcpServers.docs,
      { url: "https://docs.dev/mcp", headers: { Authorization: "Bearer t" } },
    ],
    [
      "antigravity",
      PATHS.antigravityConfigs[0]!,
      (doc: any) => doc.mcpServers.docs,
      { serverUrl: "https://docs.dev/mcp", headers: { Authorization: "Bearer t" } },
    ],
    [
      "opencode",
      PATHS.openCodeConfig,
      (doc: any) => doc.mcp.docs,
      {
        type: "remote",
        url: "https://docs.dev/mcp",
        headers: { Authorization: "Bearer t" },
        enabled: true,
      },
    ],
  ])("stores a URL's headers the way %s expects", (driver, path, pick, expected) => {
    const edit = store(driver)
      .add(ZCP_FILES, HTTP)
      .find((candidate) => candidate.path === path);
    expect(pick(JSON.parse(edit!.text))).toEqual(expected);
  });

  it("stores Codex's env and headers as tables of the server", () => {
    const [stdio] = store("codex").add(ZCP_FILES, STDIO);
    const [http] = store("codex").add(ZCP_FILES, HTTP);
    expect(stdio!.text).toContain('[mcp_servers.linear.env]\nLINEAR_KEY = "k"\n');
    expect(http!.text).toContain('[mcp_servers.docs.http_headers]\nAuthorization = "Bearer t"\n');
  });

  it("keeps the keys around the servers", () => {
    const claude = JSON.parse(store("claudeAgent").add(ZCP_FILES, STDIO)[0]!.text);
    expect(claude.numStartups).toBe(3);
    expect(claude.projects["/var/www"].hasTrustDialogAccepted).toBe(true);
    const openCode = JSON.parse(store("opencode").add(ZCP_FILES, STDIO)[0]!.text);
    expect(openCode.$schema).toBe("https://opencode.ai/config.json");
    expect(store("codex").add(ZCP_FILES, STDIO)[0]!.text).toContain(
      '[projects."/var/www"]\ntrust_level = "trusted"\n',
    );
    expect(store("grok").add(ZCP_FILES, STDIO)[0]!.text).toContain('[cli]\ntheme = "x"\n');
  });
});

describe("removing a server", () => {
  it.each([
    ["claudeAgent", "sentry", ["zerops:on:user", "playwright:on:project"]],
    ["codex", "off", ["zerops:on:user"]],
    ["antigravity", "notion", ["zerops:on:user"]],
    ["opencode", "local", []],
  ])("%s drops %s and keeps the rest", (driver, name, expected) => {
    const files = apply(ZCP_FILES, store(driver).remove(ZCP_FILES, name));
    expect(summary(driver, files)).toEqual(expected);
  });

  it("clears Claude's disabled mark with the server, so a re-added one is on", () => {
    const removed = apply(ZCP_FILES, store("claudeAgent").remove(ZCP_FILES, "sentry"));
    const doc = JSON.parse(removed.get(PATHS.claudeConfigs[0]!)!);
    expect(doc.projects["/var/www"].disabledMcpServers).toEqual([]);
  });

  it.each(["claudeAgent", "codex", "cursor", "grok", "antigravity", "opencode"])(
    "%s writes nothing for a name it does not have",
    (driver) => {
      expect(store(driver).remove(ZCP_FILES, "nope")).toEqual([]);
    },
  );
});

describe("turning a server off and on", () => {
  it.each([
    ["claudeAgent", "zerops"],
    ["codex", "zerops"],
    ["cursor", "zerops"],
    ["grok", "zerops"],
    ["antigravity", "zerops"],
    ["opencode", "local"],
  ])("%s", (driver, name) => {
    const isOn = (files: McpFiles) =>
      store(driver)
        .read(files)
        .find((server) => server.name === name)?.enabled;
    const start = isOn(ZCP_FILES)!;
    const flipped = apply(ZCP_FILES, store(driver).setEnabled(ZCP_FILES, name, !start));
    expect(isOn(flipped)).toBe(!start);
    const back = apply(flipped, store(driver).setEnabled(flipped, name, start));
    expect(isOn(back)).toBe(start);
    expect(store(driver).setEnabled(back, name, start)).toEqual([]);
  });

  it("marks Cursor's server off for the workspace, not in mcp.json", () => {
    const edits = store("cursor").setEnabled(ZCP_FILES, "zerops", false);
    expect(edits).toEqual([{ path: CURSOR_DISABLED, text: '[\n  "zerops"\n]\n' }]);
  });
});

describe("cursorProjectDir", () => {
  it.each([
    ["/var/www", "var-www"],
    ["/private/tmp/x/proj/", "private-tmp-x-proj"],
  ])("%s → %s", (cwd, expected) => {
    expect(cursorProjectDir(cwd)).toBe(expected);
  });
});

describe("decodeMcpTransport", () => {
  it.each([
    [
      { command: "zcp", args: ["serve"] },
      { type: "stdio", command: "zcp", args: ["serve"] },
    ],
    [{ command: ["bunx", "x"] }, { type: "stdio", command: "bunx", args: ["x"] }],
    [
      { type: "sse", url: "https://a" },
      { type: "http", url: "https://a" },
    ],
    [{ httpUrl: "https://b" }, { type: "http", url: "https://b" }],
    [
      { type: "remote", url: "https://c" },
      { type: "http", url: "https://c" },
    ],
    [{ command: "" }, undefined],
    [{ args: [] }, undefined],
    ["zcp", undefined],
  ])("%j", (entry, expected) => {
    expect(decodeMcpTransport(entry)).toEqual(expected);
  });
});

describe("a config it cannot parse", () => {
  it.each([
    ["claudeAgent", PATHS.claudeConfigs[0]!, "{ not json"],
    ["codex", PATHS.codexConfigs[0]!, "[mcp_servers.x\n"],
    ["opencode", PATHS.openCodeConfig, "[]"],
  ])("%s refuses to read or write it", (driver, path, text) => {
    const files = new Map([[path, text]]);
    expect(() => store(driver).read(files)).toThrow(path);
    expect(() => store(driver).add(files, STDIO)).toThrow(path);
  });
});

describe("JSONC, as OpenCode allows it", () => {
  const JSONC = `{
  // my default model
  "model": "anthropic/claude", /* keep me */
  "mcp": {
    "local": { "type": "local", "command": ["bunx", "thing"] },
  },
}
`;
  const JSONC_PATH = PATHS.openCodeConfig.replace(/\.json$/, ".jsonc");

  it("adds, turns off and removes a server, keeping the comments", () => {
    const files = new Map([[PATHS.openCodeConfig, JSONC]]);
    const added = apply(files, store("opencode").add(files, STDIO));
    const off = apply(added, store("opencode").setEnabled(added, "linear", false));
    expect(summary("opencode", off)).toEqual(["local:on:user", "linear:off:user"]);
    const removed = apply(off, store("opencode").remove(off, "linear"));
    const text = removed.get(PATHS.openCodeConfig)!;
    expect(text).toContain("// my default model");
    expect(text).toContain("/* keep me */");
    expect(summary("opencode", removed)).toEqual(["local:on:user"]);
  });

  it("writes the .jsonc file when it is the only one", () => {
    const files = new Map([[JSONC_PATH, JSONC]]);
    const edits = store("opencode").add(files, STDIO);
    expect(edits.map((edit) => edit.path)).toEqual([JSONC_PATH]);
    expect(summary("opencode", apply(files, edits))).toEqual(["local:on:user", "linear:on:user"]);
  });
});

describe("Claude's local scope and its repo file", () => {
  const LOCAL: McpFiles = new Map([
    [
      PATHS.claudeConfigs[0]!,
      JSON.stringify({
        mcpServers: { zerops: { command: "zcp", args: ["serve"] } },
        projects: {
          "/var/www": { mcpServers: { mine: { command: "mine", args: [] } } },
          "/elsewhere": { mcpServers: { theirs: { command: "theirs", args: [] } } },
        },
      }),
    ],
  ]);

  it("lists this project's local servers beside the user's", () => {
    expect(summary("claudeAgent", LOCAL)).toEqual(["mine:on:user", "zerops:on:user"]);
  });

  it("turns a local server off and removes it where it lives", () => {
    const off = apply(LOCAL, store("claudeAgent").setEnabled(LOCAL, "mine", false));
    expect(summary("claudeAgent", off)).toEqual(["mine:off:user", "zerops:on:user"]);
    const removed = apply(off, store("claudeAgent").remove(off, "mine"));
    expect(summary("claudeAgent", removed)).toEqual(["zerops:on:user"]);
    const doc = JSON.parse(removed.get(PATHS.claudeConfigs[0]!)!);
    expect(doc.projects["/var/www"]).toEqual({ mcpServers: {}, disabledMcpServers: [] });
    expect(doc.projects["/elsewhere"].mcpServers.theirs).toBeDefined();
  });

  it("keeps the user's servers and writes when the repo's .mcp.json is broken", () => {
    const files = new Map(ZCP_FILES);
    files.set("/var/www/.mcp.json", "{ broken");
    expect(summary("claudeAgent", files)).toEqual(["zerops:on:user", "sentry:off:user"]);
    expect(
      store("claudeAgent")
        .problems(files)
        .map((problem) => problem.path),
    ).toEqual(["/var/www/.mcp.json"]);
    expect(store("claudeAgent").add(files, STDIO)).toHaveLength(2);
  });
});

describe("a write that would not read back", () => {
  it("is refused for that agent, naming the file", () => {
    const files = new Map([[PATHS.codexConfigs[0]!, 'mcp_servers = "not a table"\n']]);
    const refused = (() => {
      try {
        store("codex").add(files, STDIO);
        return undefined;
      } catch (cause) {
        return cause;
      }
    })();
    expect(refused).toBeInstanceOf(McpConfigEditError);
    expect((refused as McpConfigEditError).path).toBe(PATHS.codexConfigs[0]);
  });

  it("is a parse error when the file does not parse", () => {
    const files = new Map([[PATHS.codexConfigs[0]!, "[a]\nx = 1\n[a]\n"]]);
    expect(() => store("codex").read(files)).toThrow(McpConfigParseError);
  });
});
