import type {
  McpServerAgent,
  McpServerEntry,
  McpServersList,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildMcpRows,
  describeMcpFailure,
  formatCommandLine,
  MCP_TAB_START,
  mcpTabStart,
  mcpTabStep,
  mcpRunsLabel,
  parseEnvLines,
  parseHeaderLines,
  readMcpAddForm,
  splitCommandLine,
  type McpAddForm,
  type McpTabEvent,
  type McpTabState,
} from "./McpServers.logic";
import { CLAUDE, CODEX, CURSOR, MCP_SERVERS_FIXTURE, OPENCODE } from "./mcpServersFixture";

const rowsFor = (driver: ProviderDriverKind | null, list: McpServersList = MCP_SERVERS_FIXTURE) =>
  buildMcpRows(list, driver);
const rowNamed = (name: string, driver: ProviderDriverKind | null = CLAUDE) => {
  const row = rowsFor(driver).find((entry) => entry.name === name);
  if (!row) throw new Error(`no row ${name}`);
  return row;
};

describe("the built-in server's reported state", () => {
  // The panel's input record is evidence; being built in never proves a connection.
  it.each<{
    report: McpServerAgent;
    expected: object;
  }>([
    {
      report: {
        driver: CLAUDE,
        state: "connected",
        tools: [{ name: "zerops_discover", readOnly: true }],
      },
      expected: {
        state: "connected",
        tone: "ok",
        stateLabel: "Connected",
        note: null,
        tools: [{ name: "zerops_discover", description: null, mark: "reads" }],
        actions: { reconnect: true },
      },
    },
    {
      report: { driver: CLAUDE, state: "failed", error: "zcp exited with code 1" },
      expected: {
        state: "failed",
        tone: "failed",
        stateLabel: "Failed",
        note: { kind: "error", text: "zcp exited with code 1" },
        tools: [],
        actions: { reconnect: true },
      },
    },
    {
      report: { driver: CLAUDE, state: "configured" },
      expected: {
        state: "configured",
        tone: "off",
        note: null,
        tools: [],
        actions: { reconnect: false },
      },
    },
  ])(
    'Decision: the panel shows the state the server actually has; no fake "connected" — $report.state',
    ({ report, expected }) => {
      const list: McpServersList = {
        agents: [CLAUDE],
        servers: [
          {
            name: "zerops" as McpServerEntry["name"],
            managed: true,
            transport: { type: "stdio", command: "zcp", args: ["serve"] },
            agents: [report],
          },
        ],
      };
      expect(buildMcpRows(list, CLAUDE)[0]).toMatchObject(expected);
    },
  );
});

describe("splitCommandLine — a command line, split the way a shell would", () => {
  it.each<{ line: string; words: string[] }>([
    { line: "npx -y @playwright/mcp@latest", words: ["npx", "-y", "@playwright/mcp@latest"] },
    { line: "  uvx   postgres-mcp  ", words: ["uvx", "postgres-mcp"] },
    {
      line: "node 'my server/index.js' --port 3000",
      words: ["node", "my server/index.js", "--port", "3000"],
    },
    { line: 'run "a \\"quoted\\" word"', words: ["run", 'a "quoted" word'] },
    { line: "echo it\\'s", words: ["echo", "it's"] },
    { line: "a\\ b c", words: ["a b", "c"] },
    { line: "x '' y", words: ["x", "", "y"] },
    { line: "env 'KEY=$HOME'", words: ["env", "KEY=$HOME"] },
    { line: "", words: [] },
  ])("$line", ({ line, words }) => {
    expect(splitCommandLine(line)).toEqual({ ok: true, words });
  });

  it.each(["npx 'unterminated", 'node "half', "trailing\\"])("refuses %s", (line) => {
    expect(splitCommandLine(line).ok).toBe(false);
  });

  it.each<{ command: string; args: string[] }>([
    { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
    { command: "node", args: ["my server/index.js", "it's", 'say "hi"', ""] },
    { command: "/usr/local/bin/zcp", args: ["mcp"] },
  ])("formatCommandLine round-trips $command $args", ({ command, args }) => {
    expect(splitCommandLine(formatCommandLine(command, args))).toEqual({
      ok: true,
      words: [command, ...args],
    });
  });

  it("formats plain words without quotes", () => {
    expect(formatCommandLine("npx", ["-y", "@playwright/mcp@latest"])).toBe(
      "npx -y @playwright/mcp@latest",
    );
  });
});

describe("parseEnvLines — a command's environment, one KEY=value a line", () => {
  it.each<{ text: string; value: Record<string, string> }>([
    { text: "", value: {} },
    { text: "GITHUB_TOKEN=token-x", value: { GITHUB_TOKEN: "token-x" } },
    { text: "A=1\n\n  B = two words \n", value: { A: "1", B: "two words" } },
    { text: "URL=postgres://u:p@db/x?a=b", value: { URL: "postgres://u:p@db/x?a=b" } },
    { text: "# a note\nA=", value: { A: "" } },
  ])("$text", ({ text, value }) => {
    expect(parseEnvLines(text)).toEqual({ ok: true, value });
  });

  it.each<{ text: string; error: string }>([
    { text: "JUSTAKEY", error: "Line 1: write KEY=value." },
    { text: "A=1\n=x", error: "Line 2: write KEY=value." },
    { text: "1A=x", error: "Line 1: 1A isn't a variable name." },
    { text: "A=1\nB=2\nA=3", error: "Line 3: A is set twice." },
  ])("refuses $text", ({ text, error }) => {
    expect(parseEnvLines(text)).toEqual({ ok: false, error });
  });
});

describe("parseHeaderLines — a URL's request headers, one Name: value a line", () => {
  it.each<{ text: string; value: Record<string, string> }>([
    { text: "", value: {} },
    { text: "Authorization: Bearer abc", value: { Authorization: "Bearer abc" } },
    { text: "X-Api-Key:k\n\nX-Org: a:b", value: { "X-Api-Key": "k", "X-Org": "a:b" } },
  ])("$text", ({ text, value }) => {
    expect(parseHeaderLines(text)).toEqual({ ok: true, value });
  });

  it.each<{ text: string; error: string }>([
    { text: "Authorization Bearer", error: "Line 1: write Name: value." },
    { text: "Bad Name: x", error: "Line 1: Bad Name isn't a header name." },
    { text: "A: 1\na: 2", error: "Line 2: a is set twice." },
  ])("refuses $text", ({ text, error }) => {
    expect(parseHeaderLines(text)).toEqual({ ok: false, error });
  });
});

describe("mcpRunsLabel — what a server runs, in a word", () => {
  it.each<{ transport: McpServerEntry["transport"]; label: string }>([
    { transport: { type: "stdio", command: "/usr/local/bin/zcp", args: ["mcp"] }, label: "zcp" },
    { transport: { type: "stdio", command: "node", args: ["server.js"] }, label: "node" },
    // A package runner's basename says nothing; the package it runs does.
    {
      transport: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"] },
      label: "@playwright/mcp",
    },
    {
      transport: { type: "stdio", command: "uvx", args: ["postgres-mcp", "--x"] },
      label: "postgres-mcp",
    },
    { transport: { type: "stdio", command: "bunx", args: [] }, label: "bunx" },
    {
      transport: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      label: "api.githubcopilot.com",
    },
    { transport: { type: "http", url: "http://localhost:8080/mcp" }, label: "localhost:8080" },
    { transport: { type: "http", url: "not a url" }, label: "not a url" },
  ])("$label", ({ transport, label }) => {
    expect(mcpRunsLabel(transport)).toBe(label);
  });
});

describe("buildMcpRows — one row per server, as the conversation's agent stands", () => {
  it("pins Zerops' own first and keeps the rest in the server's order", () => {
    expect(rowsFor(CLAUDE).map((row) => [row.name, row.managed])).toEqual([
      ["zerops", true],
      ["playwright", false],
      ["github", false],
      ["postgres", false],
      ["sentry", false],
      ["linear", false],
      ["context7", false],
    ]);
  });

  it.each<{
    name: string;
    driver: ProviderDriverKind | null;
    state: string;
    tone: string;
    note: { kind: "error" | "quiet"; text: string } | null;
  }>([
    { name: "zerops", driver: CLAUDE, state: "connected", tone: "ok", note: null },
    { name: "playwright", driver: CLAUDE, state: "connected", tone: "ok", note: null },
    {
      name: "playwright",
      driver: CODEX,
      state: "failed",
      tone: "failed",
      note: {
        kind: "error",
        text: "MCP client for `playwright` failed to start: request timed out",
      },
    },
    // An agent that cannot say how a server does is quiet, never a warning.
    { name: "playwright", driver: CURSOR, state: "configured", tone: "off", note: null },
    {
      name: "github",
      driver: CLAUDE,
      state: "needs-auth",
      tone: "attention",
      note: { kind: "quiet", text: "Needs sign-in" },
    },
    {
      name: "sentry",
      driver: CLAUDE,
      state: "disabled",
      tone: "off",
      note: { kind: "quiet", text: "Turned off" },
    },
    { name: "linear", driver: CLAUDE, state: "connecting", tone: "busy", note: null },
    {
      name: "linear",
      driver: CODEX,
      state: "absent",
      tone: "off",
      note: { kind: "quiet", text: "Not set up for Codex" },
    },
    // No conversation agent known: the row stands as the most telling agent does.
    {
      name: "playwright",
      driver: null,
      state: "failed",
      tone: "failed",
      note: {
        kind: "error",
        text: "MCP client for `playwright` failed to start: request timed out",
      },
    },
    { name: "zerops", driver: null, state: "connected", tone: "ok", note: null },
  ])("$name for $driver: $state", ({ name, driver, state, tone, note }) => {
    const row = rowNamed(name, driver);
    expect({ state: row.state, tone: row.tone, note: row.note }).toEqual({ state, tone, note });
  });

  it("names a failure without a message plainly", () => {
    const list: McpServersList = {
      agents: [CLAUDE],
      servers: [
        {
          name: "x",
          managed: false,
          transport: { type: "stdio", command: "x", args: [] },
          agents: [{ driver: CLAUDE, state: "failed" }],
        },
      ],
    };
    expect(buildMcpRows(list, CLAUDE)[0]?.note).toEqual({
      kind: "error",
      text: "It didn't start.",
    });
  });

  it.each<{ name: string; driver: ProviderDriverKind; line: string | null }>([
    // Agents that agree say nothing more; `configured` is not a disagreement.
    { name: "zerops", driver: CLAUDE, line: null },
    { name: "github", driver: CLAUDE, line: null },
    { name: "sentry", driver: CLAUDE, line: null },
    { name: "playwright", driver: CLAUDE, line: "Claude connected · Codex failed · Cursor set up" },
    // A conversation whose agent can't tell hears what the others can.
    { name: "zerops", driver: CURSOR, line: "Claude, Codex connected · Cursor set up" },
    // An installed agent without the server is a difference.
    { name: "linear", driver: CLAUDE, line: "Claude connecting · Codex, Cursor not set up" },
  ])("$name for $driver: the agents line", ({ name, driver, line }) => {
    expect(rowNamed(name, driver).agentsLine).toBe(line);
  });

  it("lists the conversation agent's tools with their marks", () => {
    expect(rowNamed("playwright", CLAUDE).tools).toEqual([
      { name: "browser_navigate", description: "Navigate to a URL", mark: "changes" },
      { name: "browser_snapshot", description: "Capture the page", mark: "reads" },
      { name: "browser_close", description: null, mark: "changes" },
    ]);
  });

  it("borrows another agent's tool list when the conversation's agent has none", () => {
    expect(rowNamed("playwright", CODEX).tools.map((tool) => tool.name)).toEqual([
      "browser_navigate",
      "browser_snapshot",
      "browser_close",
    ]);
    expect(rowNamed("github", CLAUDE).tools).toEqual([]);
  });

  it.each<{ name: string; config: unknown }>([
    { name: "playwright", config: { kind: "command", line: "npx -y @playwright/mcp@latest" } },
    { name: "github", config: { kind: "url", url: "https://api.githubcopilot.com/mcp/" } },
  ])("$name shows its config", ({ name, config }) => {
    expect(rowNamed(name).config).toEqual(config);
  });

  it.each<{ name: string; driver: ProviderDriverKind; actions: unknown }>([
    {
      name: "zerops",
      driver: CLAUDE,
      actions: { reconnect: true, toggle: null, remove: false },
    },
    {
      name: "playwright",
      driver: CODEX,
      actions: { reconnect: true, toggle: "off", remove: true },
    },
    {
      name: "sentry",
      driver: CLAUDE,
      actions: { reconnect: false, toggle: "on", remove: true },
    },
    {
      name: "linear",
      driver: OPENCODE,
      actions: { reconnect: false, toggle: "off", remove: true },
    },
  ])("$name for $driver: its actions", ({ name, driver, actions }) => {
    expect(rowNamed(name, driver).actions).toEqual(actions);
  });

  it.each<{
    case: string;
    scope: "user" | "project" | undefined;
    managed: boolean;
    origin: string;
    actions: unknown;
  }>([
    {
      case: "the Mate's own",
      scope: undefined,
      managed: false,
      origin: "mate",
      actions: { reconnect: true, toggle: "off", remove: true },
    },
    {
      case: "a user-scope one",
      scope: "user",
      managed: false,
      origin: "mate",
      actions: { reconnect: true, toggle: "off", remove: true },
    },
    // The repo's .mcp.json is edited there, not here: shown, reconnected, never turned off or removed.
    {
      case: "the repo's",
      scope: "project",
      managed: false,
      origin: "repo",
      actions: { reconnect: true, toggle: null, remove: false },
    },
    {
      // The Mate runs on Zerops' tools: shown and reconnected, never turned off here.
      case: "Zerops' own",
      scope: undefined,
      managed: true,
      origin: "builtin",
      actions: { reconnect: true, toggle: null, remove: false },
    },
  ])("$case: where it comes from and what may change it", ({ scope, managed, origin, actions }) => {
    const list: McpServersList = {
      agents: [CLAUDE],
      servers: [
        {
          name: "x",
          managed,
          ...(scope === undefined ? {} : { scope }),
          transport: { type: "stdio", command: "x", args: [] },
          agents: [{ driver: CLAUDE, state: "connected" }],
        },
      ],
    };
    const row = buildMcpRows(list, CLAUDE)[0]!;
    expect({ origin: row.origin, actions: row.actions }).toEqual({ origin, actions });
  });

  it("is empty for an empty list", () => {
    expect(buildMcpRows({ agents: [CLAUDE], servers: [] }, CLAUDE)).toEqual([]);
  });
});

describe("readMcpAddForm — the add form, read into the add call or its errors", () => {
  const BLANK: McpAddForm = { name: "", kind: "command", commandLine: "", url: "", extra: "" };
  const EXISTING = ["zerops", "playwright"];

  it.each<{ case: string; form: Partial<McpAddForm>; input: unknown }>([
    {
      case: "a command with its environment",
      form: {
        name: "github",
        commandLine: "npx -y @modelcontextprotocol/server-github",
        extra: "GITHUB_TOKEN=x",
      },
      input: {
        name: "github",
        transport: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
        env: { GITHUB_TOKEN: "x" },
      },
    },
    {
      case: "a command without environment",
      form: { name: "  fs ", commandLine: "node server.js" },
      input: { name: "fs", transport: { type: "stdio", command: "node", args: ["server.js"] } },
    },
    {
      case: "a URL with a header",
      form: {
        name: "sentry2",
        kind: "url",
        url: " https://mcp.sentry.dev/mcp ",
        extra: "Authorization: Bearer t",
      },
      input: {
        name: "sentry2",
        transport: { type: "http", url: "https://mcp.sentry.dev/mcp" },
        headers: { Authorization: "Bearer t" },
      },
    },
    {
      case: "the other kind's fields are ignored",
      form: { name: "u", kind: "url", url: "http://localhost:3000/mcp", commandLine: "'broken" },
      input: { name: "u", transport: { type: "http", url: "http://localhost:3000/mcp" } },
    },
  ])("$case", ({ form, input }) => {
    expect(readMcpAddForm({ ...BLANK, ...form }, EXISTING)).toEqual({ ok: true, input });
  });

  it.each<{ case: string; form: Partial<McpAddForm>; errors: unknown }>([
    {
      case: "nothing filled",
      form: {},
      errors: { name: "Give it a name.", target: "Type the command that starts it." },
    },
    {
      case: "a name with spaces",
      form: { name: "my server", commandLine: "x" },
      errors: { name: "Letters, digits, - and _ only." },
    },
    {
      case: "a name too long",
      form: { name: "a".repeat(65), commandLine: "x" },
      errors: { name: "64 characters at most." },
    },
    {
      case: "a name already here",
      form: { name: "Playwright", commandLine: "x" },
      errors: { name: "There's already a server named Playwright." },
    },
    {
      case: "an open quote",
      form: { name: "x", commandLine: "node 'a" },
      errors: { target: "A quote isn't closed." },
    },
    {
      case: "no URL",
      form: { name: "x", kind: "url" },
      errors: { target: "Paste the server's URL." },
    },
    {
      case: "not an http URL",
      form: { name: "x", kind: "url", url: "ftp://x" },
      errors: { target: "That isn't an http or https URL." },
    },
    {
      case: "a bad env line",
      form: { name: "x", commandLine: "x", extra: "TOKEN" },
      errors: { extra: "Line 1: write KEY=value." },
    },
    {
      case: "a bad header line",
      form: { name: "x", kind: "url", url: "https://x.dev", extra: "TOKEN" },
      errors: { extra: "Line 1: write Name: value." },
    },
  ])("refuses $case", ({ form, errors }) => {
    expect(readMcpAddForm({ ...BLANK, ...form }, EXISTING)).toEqual({ ok: false, errors });
  });
});

describe("describeMcpFailure — what a failed call says in the tab", () => {
  it.each<{ case: string; error: unknown; text: string }>([
    {
      case: "the server's own error",
      error: { _tag: "McpServersError", operation: "list", detail: "Not built yet." },
      text: "Not built yet.",
    },
    { case: "an Error", error: new Error("socket closed"), text: "socket closed" },
    { case: "a string", error: "boom", text: "boom" },
    { case: "nothing useful", error: { _tag: "X" }, text: "The Mate didn't answer." },
    { case: "undefined", error: undefined, text: "The Mate didn't answer." },
  ])("$case", ({ error, text }) => {
    expect(describeMcpFailure(error)).toBe(text);
  });
});

describe("mcpTabStep — the tab's list, as calls answer in any order", () => {
  const A: McpServersList = { agents: [CLAUDE], servers: [] };
  const B: McpServersList = MCP_SERVERS_FIXTURE;
  const run = (events: ReadonlyArray<McpTabEvent>, from: McpTabState = MCP_TAB_START) =>
    events.reduce(mcpTabStep, from);

  it.each<{ case: string; events: McpTabEvent[]; expected: Partial<McpTabState> }>([
    {
      case: "starts empty and quiet",
      events: [],
      expected: { list: null, error: null, busy: false },
    },
    {
      case: "a call in flight is busy",
      events: [{ kind: "asked", seq: 1 }],
      expected: { list: null, busy: true },
    },
    {
      case: "an answer paints and settles",
      events: [
        { kind: "asked", seq: 1 },
        { kind: "answered", seq: 1, list: A },
      ],
      expected: { list: A, error: null, busy: false },
    },
    {
      case: "an older answer arriving after a newer one is dropped",
      events: [
        { kind: "asked", seq: 1 },
        { kind: "asked", seq: 2 },
        { kind: "answered", seq: 2, list: B },
        { kind: "answered", seq: 1, list: A },
      ],
      expected: { list: B, busy: false },
    },
    {
      case: "busy until every call is back",
      events: [
        { kind: "asked", seq: 1 },
        { kind: "asked", seq: 2 },
        { kind: "answered", seq: 2, list: B },
      ],
      expected: { list: B, busy: true },
    },
    {
      case: "a failed read keeps the last list and says why",
      events: [
        { kind: "asked", seq: 1 },
        { kind: "answered", seq: 1, list: A },
        { kind: "asked", seq: 2 },
        { kind: "failed", seq: 2, message: "Not built yet." },
      ],
      expected: { list: A, error: "Not built yet.", busy: false },
    },
    {
      case: "a later answer clears the error",
      events: [
        { kind: "asked", seq: 1 },
        { kind: "failed", seq: 1, message: "Not built yet." },
        { kind: "asked", seq: 2 },
        { kind: "answered", seq: 2, list: B },
      ],
      expected: { list: B, error: null },
    },
    {
      case: "a stale failure does not cover a newer answer",
      events: [
        { kind: "asked", seq: 1 },
        { kind: "asked", seq: 2 },
        { kind: "answered", seq: 2, list: B },
        { kind: "failed", seq: 1, message: "late" },
      ],
      expected: { list: B, error: null },
    },
    {
      // A failed action says so beside its control; the tab's list and error stand.
      case: "a dropped call settles without touching the list",
      events: [
        { kind: "asked", seq: 1 },
        { kind: "answered", seq: 1, list: A },
        { kind: "asked", seq: 2 },
        { kind: "dropped", seq: 2 },
      ],
      expected: { list: A, error: null, busy: false },
    },
  ])("$case", ({ events, expected }) => {
    expect(run(events)).toMatchObject(expected);
  });

  it("starts from a remembered list without painting it as fresh", () => {
    expect(mcpTabStart(A)).toMatchObject({ list: A, error: null, busy: false });
  });
});
