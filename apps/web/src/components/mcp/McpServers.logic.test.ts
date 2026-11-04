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
  readMcpSecretsForm,
  readMcpSignInEdit,
  groupMcpRows,
  mcpTileInitials,
  mcpWhere,
  mcpAppRedirects,
  mcpSignInStart,
  BLANK_SIGN_IN,
  type McpSignInFields,
  mcpSecretsFormText,
  MCP_SECRET_MASK,
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
        note: { kind: "quiet", text: "Claude checks it when this conversation next runs." },
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
    {
      name: "playwright",
      driver: CURSOR,
      state: "configured",
      tone: "off",
      note: { kind: "quiet", text: "Set up" },
    },
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
      actions: { reconnect: true, toggle: null, remove: false, signIn: null, signOut: false },
    },
    {
      name: "playwright",
      driver: CODEX,
      actions: { reconnect: true, toggle: "off", remove: true, signIn: null, signOut: false },
    },
    {
      name: "sentry",
      driver: CLAUDE,
      actions: { reconnect: false, toggle: "on", remove: true, signIn: null, signOut: false },
    },
    {
      name: "linear",
      driver: OPENCODE,
      actions: { reconnect: false, toggle: "off", remove: true, signIn: null, signOut: false },
    },
    // A remote server waiting for a sign-in offers one, on the agent that waits for it.
    {
      name: "github",
      driver: CLAUDE,
      actions: { reconnect: true, toggle: "off", remove: true, signIn: "new", signOut: false },
    },
    {
      name: "github",
      driver: CURSOR,
      actions: { reconnect: false, toggle: "off", remove: true, signIn: null, signOut: false },
    },
    // Signed in: Sign out. context7 is a URL Claude reaches: it can't say whether by a sign-in.
    {
      name: "context7",
      driver: CLAUDE,
      actions: { reconnect: true, toggle: null, remove: false, signIn: null, signOut: true },
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
      actions: { reconnect: true, toggle: "off", remove: true, signIn: null, signOut: false },
    },
    {
      case: "a user-scope one",
      scope: "user",
      managed: false,
      origin: "mate",
      actions: { reconnect: true, toggle: "off", remove: true, signIn: null, signOut: false },
    },
    // The repo's .mcp.json is edited there, not here: shown, reconnected, never turned off or removed.
    {
      case: "the repo's",
      scope: "project",
      managed: false,
      origin: "repo",
      actions: { reconnect: true, toggle: null, remove: false, signIn: null, signOut: false },
    },
    {
      // The Mate runs on Zerops' tools: shown and reconnected, never turned off here.
      case: "Zerops' own",
      scope: undefined,
      managed: true,
      origin: "builtin",
      actions: { reconnect: true, toggle: null, remove: false, signIn: null, signOut: false },
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

  it.each<{
    case: string;
    agent: Omit<McpServerAgent, "driver">;
    transport: McpServerEntry["transport"];
    signIn: string | null;
    signOut: boolean;
  }>([
    {
      case: "a URL server that failed may need its sign-in again",
      agent: { state: "failed", error: "401 Unauthorized" },
      transport: { type: "http", url: "https://mcp.example.com" },
      signIn: "again",
      signOut: false,
    },
    {
      case: "a command that failed has no sign-in to renew",
      agent: { state: "failed", error: "exited 1" },
      transport: { type: "stdio", command: "x", args: [] },
      signIn: null,
      signOut: false,
    },
    {
      case: "a URL server the agent reaches by a token offers no sign-in or sign-out",
      agent: { state: "failed", signedIn: false },
      transport: { type: "http", url: "https://mcp.example.com" },
      signIn: null,
      signOut: false,
    },
    {
      case: "a URL server the agent holds a sign-in for offers Sign out",
      agent: { state: "connected", signedIn: true },
      transport: { type: "http", url: "https://mcp.example.com" },
      signIn: null,
      signOut: true,
    },
    {
      case: "a connected URL server reached by a token offers no Sign out",
      agent: { state: "connected", signedIn: false },
      transport: { type: "http", url: "https://mcp.example.com" },
      signIn: null,
      signOut: false,
    },
  ])("$case", ({ agent, transport, signIn, signOut }) => {
    const row = buildMcpRows(
      {
        agents: [CODEX],
        servers: [{ name: "x", managed: false, transport, agents: [{ driver: CODEX, ...agent }] }],
      },
      CODEX,
    )[0]!;
    expect({ signIn: row.actions.signIn, signOut: row.actions.signOut }).toEqual({
      signIn,
      signOut,
    });
  });

  it.each<{
    case: string;
    driver: ProviderDriverKind | null;
    transport: McpServerEntry["transport"];
    note: string;
  }>([
    {
      case: "a URL server no conversation has checked may need a sign-in; a conversation checks",
      driver: null,
      transport: { type: "http", url: "https://mcp.example.com" },
      note: "May need a sign-in. Open a conversation with this Mate to check.",
    },
    {
      case: "a URL server this conversation's agent hasn't reached yet is checked when it runs",
      driver: CLAUDE,
      transport: { type: "http", url: "https://mcp.example.com" },
      note: "May need a sign-in. Claude checks when this conversation next runs.",
    },
    {
      case: "an agent that can't report a server's state only says it is set up",
      driver: CURSOR,
      transport: { type: "http", url: "https://mcp.example.com" },
      note: "Set up",
    },
    {
      case: "a command never needs a sign-in",
      driver: CLAUDE,
      transport: { type: "stdio", command: "x", args: [] },
      note: "Claude checks it when this conversation next runs.",
    },
  ])("$case", ({ driver, transport, note }) => {
    const agents = [CLAUDE, CURSOR].map((agent) => ({
      driver: agent,
      state: "configured" as const,
    }));
    const row = buildMcpRows(
      { agents: [CLAUDE, CURSOR], servers: [{ name: "x", managed: false, transport, agents }] },
      driver,
    )[0]!;
    expect(row.note).toEqual({ kind: "quiet", text: note });
  });

  it.each<{
    case: string;
    agent: Omit<McpServerAgent, "driver">;
    signIn: string | null;
    signOut: boolean;
  }>([
    {
      case: "a URL server that signs in by its headers offers no Sign out",
      agent: { state: "connected" },
      signIn: null,
      signOut: false,
    },
    {
      case: "a URL server that signs in by its headers offers no Sign in again when it fails",
      agent: { state: "failed" },
      signIn: null,
      signOut: false,
    },
    {
      case: "a URL server with headers that still asks for a sign-in offers one",
      agent: { state: "needs-auth" },
      signIn: "new",
      signOut: false,
    },
  ])("$case", ({ agent, signIn, signOut }) => {
    const row = buildMcpRows(
      {
        agents: [CLAUDE],
        servers: [
          {
            name: "x",
            managed: false,
            transport: { type: "http", url: "https://mcp.example.com" },
            secretNames: ["Authorization"],
            agents: [{ driver: CLAUDE, ...agent }],
          },
        ],
      },
      CLAUDE,
    )[0]!;
    expect({ signIn: row.actions.signIn, signOut: row.actions.signOut }).toEqual({
      signIn,
      signOut,
    });
  });

  it.each<{ name: string; secrets: unknown }>([
    { name: "a URL", secrets: { kind: "headers", names: ["Authorization"], editable: true } },
    { name: "a command", secrets: { kind: "env", names: [], editable: true } },
  ])("$name server shows which values it holds, never the values", ({ name, secrets }) => {
    const transport: McpServerEntry["transport"] =
      name === "a URL"
        ? { type: "http", url: "https://mcp.example.com" }
        : { type: "stdio", command: "x", args: [] };
    const row = buildMcpRows(
      {
        agents: [CLAUDE],
        servers: [
          {
            name: "x",
            managed: false,
            transport,
            ...(name === "a URL" ? { secretNames: ["Authorization"] } : {}),
            agents: [{ driver: CLAUDE, state: "connected" }],
          },
        ],
      },
      CLAUDE,
    )[0]!;
    expect(row.secrets).toEqual(secrets);
  });

  it("is empty for an empty list", () => {
    expect(buildMcpRows({ agents: [CLAUDE], servers: [] }, CLAUDE)).toEqual([]);
  });
});

describe("readMcpAddForm — the add form, read into the add call or its errors", () => {
  const BLANK: McpAddForm = {
    name: "",
    kind: "command",
    commandLine: "",
    url: "",
    extra: "",
    signIn: BLANK_SIGN_IN,
  };
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

describe("how a URL server signs in, chosen in the form", () => {
  const URL_FORM: McpAddForm = {
    name: "docs",
    kind: "url",
    commandLine: "",
    url: "https://mcp.example.com/mcp",
    extra: "",
    signIn: BLANK_SIGN_IN,
  };
  const transport = { type: "http", url: "https://mcp.example.com/mcp" };

  it.each<{ case: string; signIn: Partial<McpSignInFields>; auth: unknown }>([
    {
      case: "an API key goes in the Authorization header as a bearer token",
      signIn: { choice: "header", key: "k3y" },
      auth: { kind: "header", name: "Authorization", value: "Bearer k3y" },
    },
    {
      case: "an API key that names its own scheme is sent as it is",
      signIn: { choice: "header", key: "Token k3y" },
      auth: { kind: "header", name: "Authorization", value: "Token k3y" },
    },
    {
      case: "an API key in another header is sent bare",
      signIn: { choice: "header", headerName: "X-Api-Key", key: "k3y" },
      auth: { kind: "header", name: "X-Api-Key", value: "k3y" },
    },
    {
      case: "a sign-in may ask for scopes",
      signIn: { choice: "oauth", scopes: "read, write  admin" },
      auth: { kind: "oauth", scopes: ["read", "write", "admin"] },
    },
    {
      case: "signing in with your own app takes its client id, secret and scopes",
      signIn: { choice: "oauth-app", clientId: " mate-app ", clientSecret: "s3", scopes: "read" },
      auth: { kind: "oauth-app", clientId: "mate-app", clientSecret: "s3", scopes: ["read"] },
    },
    {
      case: "a server that needs no sign-in is told so",
      signIn: { choice: "none" },
      auth: { kind: "none" },
    },
  ])("$case", ({ signIn, auth }) => {
    const read = readMcpAddForm({ ...URL_FORM, signIn: { ...BLANK_SIGN_IN, ...signIn } }, []);
    expect(read).toEqual({ ok: true, input: { name: "docs", transport, auth } });
  });

  it("a plain sign-in when asked writes nothing of its own", () => {
    expect(readMcpAddForm(URL_FORM, [])).toEqual({ ok: true, input: { name: "docs", transport } });
  });

  it("an SSE server is read as SSE", () => {
    expect(readMcpAddForm({ ...URL_FORM, kind: "sse" }, [])).toEqual({
      ok: true,
      input: { name: "docs", transport: { type: "sse", url: "https://mcp.example.com/mcp" } },
    });
  });

  it.each<{ case: string; signIn: Partial<McpSignInFields>; error: string }>([
    { case: "an API key left empty", signIn: { choice: "header" }, error: "Paste the key." },
    {
      case: "a header name that isn't one",
      signIn: { choice: "header", headerName: "bad name", key: "k" },
      error: "bad name isn't a header name.",
    },
    {
      case: "your own app without its client ID",
      signIn: { choice: "oauth-app" },
      error: "Give your app's client ID.",
    },
  ])("refuses $case", ({ signIn, error }) => {
    expect(readMcpAddForm({ ...URL_FORM, signIn: { ...BLANK_SIGN_IN, ...signIn } }, [])).toEqual({
      ok: false,
      errors: { auth: error },
    });
  });

  it("names the redirect each installed agent's own-app sign-in needs registered", () => {
    expect(mcpAppRedirects([CLAUDE, CODEX, OPENCODE, CURSOR])).toEqual([
      { agent: "Claude", url: "http://localhost:33418/callback" },
      { agent: "OpenCode", url: "http://127.0.0.1:33419/mcp/oauth/callback" },
    ]);
  });
});

describe("a server's sign-in, edited in place", () => {
  const row = (entry: Partial<McpServerEntry>) =>
    buildMcpRows(
      {
        agents: [CLAUDE],
        servers: [
          {
            name: "x",
            managed: false,
            transport: { type: "http", url: "https://mcp.example.com" },
            agents: [{ driver: CLAUDE, state: "connected" }],
            ...entry,
          },
        ],
      },
      CLAUDE,
    )[0]!;

  it.each<{ case: string; entry: Partial<McpServerEntry>; start: Partial<McpSignInFields> }>([
    {
      case: "your own app, its secret never shown",
      entry: { auth: { kind: "oauth-app", clientId: "mate-app", scopes: ["read"], secret: true } },
      start: { choice: "oauth-app", clientId: "mate-app", scopes: "read", clientSecret: "" },
    },
    {
      case: "an API key in its header",
      entry: { secretNames: ["Authorization"] },
      start: { choice: "header", headerName: "Authorization", key: "" },
    },
    { case: "no sign-in", entry: { auth: { kind: "none" } }, start: { choice: "none" } },
    {
      case: "a sign-in with scopes",
      entry: { auth: { kind: "oauth", scopes: ["a", "b"] } },
      start: { choice: "oauth", scopes: "a b" },
    },
  ])("opens with the sign-in it has: $case", ({ entry, start }) => {
    expect(mcpSignInStart(row(entry))).toEqual({ ...BLANK_SIGN_IN, ...start });
  });

  it.each<{ case: string; change: Partial<McpSignInFields>; auth: unknown }>([
    { case: "left as it was changes nothing", change: {}, auth: undefined },
    {
      case: "a new client secret replaces the stored one",
      change: { clientSecret: "n3w" },
      auth: { kind: "oauth-app", clientId: "mate-app", clientSecret: "n3w", scopes: ["read"] },
    },
    {
      case: "a new client ID with the secret left empty keeps the stored secret",
      change: { clientId: "other" },
      auth: { kind: "oauth-app", clientId: "other", scopes: ["read"] },
    },
    {
      case: "switching to an API key sends the key",
      change: { choice: "header", key: "k3y" },
      auth: { kind: "header", name: "Authorization", value: "Bearer k3y" },
    },
  ])("$case", ({ change, auth }) => {
    const start = mcpSignInStart(
      row({ auth: { kind: "oauth-app", clientId: "mate-app", scopes: ["read"], secret: true } }),
    );
    expect(readMcpSignInEdit(start, { ...start, ...change })).toEqual({ ok: true, auth });
  });
});

describe("agents that can't use a server", () => {
  const list: McpServersList = {
    agents: [CLAUDE, CODEX],
    servers: [
      {
        name: "events",
        managed: false,
        transport: { type: "sse", url: "https://mcp.example.com/sse" },
        cannot: [{ driver: CODEX, reason: "Codex can't use SSE servers." }],
        agents: [{ driver: CLAUDE, state: "connected" }],
      },
    ],
  };

  it("each says why, in place of a bare 'not set up'", () => {
    const row = buildMcpRows(list, CLAUDE)[0]!;
    expect(row.cannot).toEqual(["Codex can't use SSE servers."]);
    expect(row.agentsLine).toBeNull();
    expect(row.config).toEqual({ kind: "url", url: "https://mcp.example.com/sse", sse: true });
  });

  it("a conversation on an agent that can't use it says why on the row", () => {
    expect(buildMcpRows(list, CODEX)[0]!.note).toEqual({
      kind: "quiet",
      text: "Codex can't use SSE servers.",
    });
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

describe("the secrets form — a server's environment or headers, edited without seeing them", () => {
  it.each<{ kind: "env" | "headers"; names: string[]; text: string }>([
    {
      kind: "headers",
      names: ["Authorization", "X-Team"],
      text: `Authorization: ${MCP_SECRET_MASK}\nX-Team: ${MCP_SECRET_MASK}`,
    },
    { kind: "env", names: ["API_KEY"], text: `API_KEY=${MCP_SECRET_MASK}` },
    { kind: "env", names: [], text: "" },
  ])("starts with each $kind name, its value masked", ({ kind, names, text }) => {
    expect(mcpSecretsFormText(kind, names)).toBe(text);
  });

  it.each<{ kind: "env" | "headers"; text: string; read: unknown }>([
    {
      kind: "headers",
      text: `Authorization: ${MCP_SECRET_MASK}\nX-Team: eng`,
      read: { ok: true, values: { "X-Team": "eng" }, keep: ["Authorization"] },
    },
    {
      kind: "env",
      text: `API_KEY=${MCP_SECRET_MASK}\nREGION=eu`,
      read: { ok: true, values: { REGION: "eu" }, keep: ["API_KEY"] },
    },
    // A line taken out is a value dropped.
    { kind: "env", text: "", read: { ok: true, values: {}, keep: [] } },
    { kind: "env", text: "not a line", read: { ok: false, error: "Line 1: write KEY=value." } },
  ])(
    "reads $kind lines into new values and the masked ones kept: $text",
    ({ kind, text, read }) => {
      expect(readMcpSecretsForm(kind, text)).toEqual(read);
    },
  );
});

describe("the Tools tab: where each tool stands and the one thing to do", () => {
  const rowOf = (
    agent: Omit<McpServerAgent, "driver">,
    entry: Partial<McpServerEntry> = {},
    driver: ProviderDriverKind | null = CLAUDE,
  ) =>
    buildMcpRows(
      {
        agents: [CLAUDE, CODEX],
        servers: [
          {
            name: "linear",
            managed: false,
            transport: { type: "http", url: "https://mcp.linear.app/mcp" },
            agents: [{ driver: CLAUDE, ...agent }],
            ...entry,
          },
        ],
      },
      driver,
    )[0]!;
  const tools = [{ name: "list_issues", readOnly: true }, { name: "create_issue" }];

  it.each<{
    case: string;
    agent: Omit<McpServerAgent, "driver">;
    entry?: Partial<McpServerEntry>;
    group: string;
    right: unknown;
  }>([
    {
      case: "a tool that works says how many tools it brings",
      agent: { state: "connected", tools },
      group: "ready",
      right: { kind: "state", words: "2 tools", tone: "ok" },
    },
    {
      case: "a tool waiting for a sign-in asks for it",
      agent: { state: "needs-auth" },
      group: "waiting",
      right: { kind: "action", action: "signIn", label: "Sign in" },
    },
    {
      case: "a tool whose key was refused asks for a key",
      agent: { state: "failed", error: "HTTP 401 Unauthorized" },
      entry: { secretNames: ["Authorization"] },
      group: "waiting",
      right: { kind: "action", action: "addKey", label: "Add key" },
    },
    {
      case: "a tool whose sign-in ran out asks to sign in again",
      agent: { state: "failed", error: "401: invalid_token" },
      group: "waiting",
      right: { kind: "action", action: "signIn", label: "Sign in again" },
    },
    {
      case: "a tool that failed for another reason offers to try again",
      agent: { state: "failed", error: "connection refused" },
      group: "waiting",
      right: { kind: "action", action: "tryAgain", label: "Try again" },
    },
    {
      case: "a tool connecting says so, with nothing to press",
      agent: { state: "connecting" },
      group: "ready",
      right: { kind: "state", words: "Connecting", tone: "busy" },
    },
    {
      case: "a tool no agent has reached yet says so",
      agent: { state: "configured" },
      group: "unchecked",
      right: { kind: "state", words: "Not reached yet", tone: "off" },
    },
    {
      case: "a tool turned off stands with the others that are off",
      agent: { state: "disabled" },
      group: "off",
      right: { kind: "state", words: "Off", tone: "off" },
    },
  ])("$case", ({ agent, entry, group, right }) => {
    const row = rowOf(agent, entry);
    expect({ group: row.group, right: row.right }).toEqual({ group, right });
  });

  it("each installed agent is a mark with its own state, one that can't use it named why", () => {
    const row = rowOf(
      { state: "connected", tools },
      { cannot: [{ driver: CODEX, reason: "Codex can't use SSE servers." }] },
    );
    expect(row.marks).toEqual([
      { driver: CLAUDE, tone: "ok", label: "Claude: connected" },
      { driver: CODEX, tone: "off", label: "Codex can't use SSE servers." },
    ]);
  });

  it.each([
    ["linear", "Li"],
    ["DeepWiki", "Dw"],
    ["zerops", "Z"],
    ["x", "X"],
  ])("%s's tile reads %s", (name, initials) => {
    expect(mcpTileInitials(name, name === "zerops")).toBe(initials);
  });

  it.each<{ case: string; agents: ReadonlyArray<McpServerAgent>; words: string }>([
    {
      case: "a command no agent has reached",
      agents: [{ driver: CLAUDE, state: "configured" }],
      words: "Claude checks it when this conversation next runs.",
    },
    {
      case: "a server set up for another agent only",
      agents: [{ driver: CODEX, state: "configured" }],
      words: "Not set up for Claude",
    },
  ])(
    "Ready holds only what an agent reached; $case waits below it, saying what checks it",
    ({ agents, words }) => {
      const row = buildMcpRows(
        {
          agents: [CLAUDE, CODEX],
          servers: [
            {
              name: "x",
              managed: false,
              transport: { type: "stdio", command: "x", args: [] },
              agents,
            },
          ],
        },
        CLAUDE,
      )[0]!;
      expect({ group: row.group, note: row.note?.text }).toEqual({
        group: "unchecked",
        note: words,
      });
    },
  );

  it("the tab groups what waits on you first, then what is ready, then what is off", () => {
    const list: McpServersList = {
      agents: [CLAUDE],
      servers: (["disabled", "connected", "needs-auth", "configured"] as const).map(
        (state, index) => ({
          name: `s${String(index)}`,
          managed: false,
          transport: { type: "stdio", command: "x", args: [] },
          agents: [{ driver: CLAUDE, state }],
        }),
      ),
    };
    const groups = groupMcpRows(buildMcpRows(list, CLAUDE));
    expect(groups.map((group) => [group.id, group.rows.map((row) => row.name)])).toEqual([
      ["waiting", ["s2"]],
      ["ready", ["s1"]],
      ["unchecked", ["s3"]],
      ["off", ["s0"]],
    ]);
  });
});

describe("where a tool connects, typed in one field", () => {
  it.each([
    ["https://mcp.linear.app/mcp", "url", "A streamable HTTP server."],
    ["https://mcp.deepwiki.com/sse", "sse", "An SSE server: an older kind not every agent speaks."],
    ["npx -y @modelcontextprotocol/server-postgres", "command", "A command this Mate runs."],
  ])("%s is read as a %s server, said in a line", (text, kind, words) => {
    expect(mcpWhere(text)).toMatchObject({ form: { kind }, words });
  });
});
