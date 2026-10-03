import { describe, expect, it } from "vite-plus/test";

import {
  appendTomlServer,
  readTomlServers,
  removeTomlServer,
  setTomlServerBoolean,
  TomlSyntaxError,
} from "./mcpToml.ts";

/** What `zcp init` writes into Codex's config.toml, around a hand-edited rest. */
const CODEX_ZCP = `model = "gpt-5.5"
# my own notes
approval_policy = "on-request"

[mcp_servers.zerops]
command = "zcp"
args = ["serve"]
startup_timeout_sec = 30
tool_timeout_sec = 600
env_vars = ["ZCP_API_KEY","serviceId","hostname","projectId","zeropsSubdomain","PATH","HOME"]

[projects."/var/www"]
trust_level = "trusted"
`;

const HAND_EDITED = `[mcp_servers.github]
url = "https://api.githubcopilot.com/mcp/" # remote
enabled = false

[mcp_servers.github.http_headers]
Authorization = "Bearer abc"

[mcp_servers]
inline = { command = "npx", args = ['-y', "pkg"], env = { KEY = "v" } }

[mcp_servers.multi]
command = """
uvx"""
args = [
  "a", # first
  "b",
]
mcp_servers_note = 1_000

[profiles.fast]
model = "x"
`;

describe("readTomlServers", () => {
  it.each([
    ["an empty file", "", {}],
    ["a file without servers", 'model = "x"\n[tui]\ntheme = "dark"\n', {}],
    [
      "zcp's zerops table",
      CODEX_ZCP,
      {
        zerops: {
          command: "zcp",
          args: ["serve"],
          startup_timeout_sec: "30",
          tool_timeout_sec: "600",
          env_vars: [
            "ZCP_API_KEY",
            "serviceId",
            "hostname",
            "projectId",
            "zeropsSubdomain",
            "PATH",
            "HOME",
          ],
        },
      },
    ],
    [
      "tables, sub-tables, inline tables and multi-line values",
      HAND_EDITED,
      {
        github: {
          url: "https://api.githubcopilot.com/mcp/",
          enabled: false,
          http_headers: { Authorization: "Bearer abc" },
        },
        inline: { command: "npx", args: ["-y", "pkg"], env: { KEY: "v" } },
        multi: { command: "uvx", args: ["a", "b"], mcp_servers_note: "1_000" },
      },
    ],
    [
      "dotted keys from the top level",
      'mcp_servers.dot.command = "x"\nmcp_servers.dot.args = []\n',
      { dot: { command: "x", args: [] } },
    ],
    [
      "quoted names and escapes",
      '[mcp_servers."my-server"]\ncommand = "a\\"b\\u00e9"\nargs = [\'C:\\\\x\']\n',
      { "my-server": { command: 'a"bé', args: ["C:\\\\x"] } },
    ],
  ])("reads %s", (_label, text, expected) => {
    expect(readTomlServers(text, "mcp_servers")).toEqual(expected);
  });

  it.each([
    ["an unclosed table header", "[mcp_servers.x\ncommand = 1\n"],
    ["an unclosed string", '[mcp_servers.x]\ncommand = "zcp\n'],
    ["a key without a value", "[mcp_servers.x]\ncommand =\n"],
    ["two values on one line", '[mcp_servers.x]\ncommand = "a" "b"\n'],
  ])("refuses %s", (_label, text) => {
    expect(() => readTomlServers(text, "mcp_servers")).toThrow(TomlSyntaxError);
  });
});

describe("appendTomlServer", () => {
  it.each([
    [
      "a stdio server with env after zcp's",
      CODEX_ZCP,
      "linear",
      { command: "npx", args: ["-y", "mcp-remote"], env: { API_KEY: 'k"1' } },
      `${CODEX_ZCP}
[mcp_servers.linear]
command = "npx"
args = ["-y", "mcp-remote"]

[mcp_servers.linear.env]
API_KEY = "k\\"1"
`,
    ],
    [
      "an http server into an empty file",
      "",
      "docs",
      { url: "https://x.dev/mcp", http_headers: { "X-Key": "a" } },
      `[mcp_servers.docs]
url = "https://x.dev/mcp"

[mcp_servers.docs.http_headers]
X-Key = "a"
`,
    ],
    [
      "a server into a file with no final newline",
      'model = "x"',
      "a",
      { command: "a", args: [], enabled: true },
      `model = "x"

[mcp_servers.a]
command = "a"
args = []
enabled = true
`,
    ],
  ])("writes %s", (_label, text, name, server, expected) => {
    const written = appendTomlServer(text, "mcp_servers", name, server);
    expect(written).toBe(expected);
    expect(readTomlServers(written, "mcp_servers")[name]).toEqual(server);
  });
});

describe("removeTomlServer", () => {
  it.each([
    [
      "a server and its sub-table, keeping everything around it",
      HAND_EDITED,
      "github",
      ["inline", "multi"],
    ],
    ["an inline server", HAND_EDITED, "inline", ["github", "multi"]],
    ["a multi-line server", HAND_EDITED, "multi", ["github", "inline"]],
    ["a name that is not there", HAND_EDITED, "nope", ["github", "inline", "multi"]],
    [
      "dotted keys",
      'mcp_servers.dot.command = "x"\nmcp_servers.dot.args = []\nmodel = "y"\n',
      "dot",
      [],
    ],
  ])("removes %s", (_label, text, name, left) => {
    const written = removeTomlServer(text, "mcp_servers", name);
    expect(Object.keys(readTomlServers(written, "mcp_servers"))).toEqual(left);
  });

  it("leaves the rest of the file byte for byte", () => {
    const withServer = appendTomlServer(CODEX_ZCP, "mcp_servers", "linear", {
      command: "npx",
      args: [],
      env: { A: "b" },
    });
    expect(removeTomlServer(withServer, "mcp_servers", "linear")).toBe(CODEX_ZCP);
  });

  it("keeps the other tables of a hand-edited file", () => {
    const written = removeTomlServer(HAND_EDITED, "mcp_servers", "multi");
    expect(written).toContain('[profiles.fast]\nmodel = "x"\n');
    expect(written).toContain("[mcp_servers.github.http_headers]");
  });
});

describe("setTomlServerBoolean", () => {
  it.each([
    ["flips an existing key", HAND_EDITED, "github", true],
    ["adds the key under the table", CODEX_ZCP, "zerops", false],
    ["rewrites an inline server as a table", HAND_EDITED, "inline", false],
  ])("%s", (_label, text, name, value) => {
    const before = readTomlServers(text, "mcp_servers");
    const written = setTomlServerBoolean(text, "mcp_servers", name, "enabled", value);
    const after = readTomlServers(written, "mcp_servers");
    expect(after[name]).toEqual({ ...before[name], enabled: value });
    for (const other of Object.keys(before).filter((key) => key !== name)) {
      expect(after[other]).toEqual(before[other]);
    }
  });

  it("changes only the value it sets", () => {
    const written = setTomlServerBoolean(HAND_EDITED, "mcp_servers", "github", "enabled", true);
    expect(written).toBe(HAND_EDITED.replace("enabled = false", "enabled = true"));
  });

  it("leaves a file without the server alone", () => {
    expect(setTomlServerBoolean(CODEX_ZCP, "mcp_servers", "nope", "enabled", false)).toBe(
      CODEX_ZCP,
    );
  });
});
