import type { McpServerEntry, McpServersList } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { CLAUDE, CODEX, CURSOR } from "../../mcp/mcpServersFixture";
import {
  mcpAddInput,
  mcpProposalStatus,
  mcpProposalView,
  mcpTurnNote,
  type McpProposal,
  type McpProposalStatus,
} from "./mcpProposal.logic";

const linear: McpProposal = {
  id: "p-1",
  kind: "mcp.add",
  summary: "Set up Linear",
  reason: "to read the issues you link",
  projectId: "p-juno",
  params: {
    scope: "mate",
    server: {
      name: "linear",
      title: "Linear",
      transport: { type: "http", url: "https://mcp.linear.app/mcp" },
      auth: { kind: "oauth" },
    },
    credentials: [],
  },
};

const github: McpProposal = {
  ...linear,
  summary: "Set up GitHub",
  params: {
    scope: "mate",
    server: {
      name: "github",
      title: "GitHub",
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
      },
      auth: { kind: "none" },
    },
    credentials: [{ key: "GITHUB_TOKEN", label: "GitHub token", placement: "env" }],
  },
};

const sentry: McpProposal = {
  ...linear,
  summary: "Set up Sentry",
  params: {
    scope: "mate",
    server: {
      name: "sentry",
      title: "Sentry",
      transport: { type: "http", url: "https://mcp.sentry.dev/mcp" },
      auth: { kind: "header" },
    },
    credentials: [
      {
        key: "SENTRY_TOKEN",
        label: "Sentry auth token",
        placement: "header",
        headerName: "Authorization",
        prefix: "Bearer ",
      },
    ],
  },
};

const entry = (agents: McpServerEntry["agents"]): McpServerEntry => ({
  name: "linear",
  managed: false,
  transport: { type: "http", url: "https://mcp.linear.app/mcp" },
  agents,
});

const listWith = (...servers: McpServerEntry[]): McpServersList => ({
  agents: [CLAUDE, CODEX],
  servers,
});

const tools = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ name: `tool_${String(index)}` }));

const view = (proposal: McpProposal, status: McpProposalStatus, approveBlocked?: string) =>
  mcpProposalView({
    proposal,
    mateName: "Juno",
    status,
    signing: { phase: "idle" },
    approveBlocked,
  });

describe("an MCP server's proposal card", () => {
  it("names the server and the Mate it is set up for, where it connects and, until it is added, how it signs in", () => {
    const shown = view(linear, { kind: "proposed" });
    expect(shown.title).toBe("Set up Linear for Juno");
    expect(shown.connects).toBe("Connects to mcp.linear.app/mcp");
    expect(shown.signsIn).toBe("You sign in on Linear's page once it is added");
    expect(shown.reason).toBe("to read the issues you link");
    expect(shown.proposer).toBe("Juno");
    expect(view(linear, { kind: "connecting" }).signsIn).toBeNull();
    expect(view(github, { kind: "proposed" }).connects).toBe(
      "Runs npx -y @modelcontextprotocol/server-github",
    );
  });

  it("asks for each key it needs, typed by the person, then offers Add", () => {
    expect(view(sentry, { kind: "proposed" }).steps).toEqual([
      {
        kind: "provide",
        fields: [
          { key: "SENTRY_TOKEN", label: "Sentry auth token", where: "Sent as Authorization" },
        ],
      },
      { kind: "approve", label: "Add", blocked: null },
    ]);
    expect(view(github, { kind: "proposed" }).steps[0]).toEqual({
      kind: "provide",
      fields: [{ key: "GITHUB_TOKEN", label: "GitHub token", where: "Kept as GITHUB_TOKEN" }],
    });
  });

  it("offers Add alone where nothing needs typing", () => {
    expect(view(linear, { kind: "proposed" }).steps).toEqual([
      { kind: "approve", label: "Add", blocked: null },
    ]);
  });

  it("says plainly that only this Mate is set up for now when proposed for the project or the organization", () => {
    expect(view(linear, { kind: "proposed" }).scopeLine).toBeNull();
    const forProject = { ...linear, params: { ...linear.params, scope: "project" as const } };
    expect(view(forProject, { kind: "proposed" }).scopeLine).toBe(
      "Proposed for the whole project. Only Juno is set up for now.",
    );
    const forOrg = { ...linear, params: { ...linear.params, scope: "org" as const } };
    expect(view(forOrg, { kind: "proposed" }).scopeLine).toBe(
      "Proposed for the whole organization. Only Juno is set up for now.",
    );
  });

  it("holds Add with why while it cannot run, and says so where this Mate cannot add the server yet", () => {
    expect(view(linear, { kind: "proposed" }, "Reading what was decided…").steps).toEqual([
      { kind: "approve", label: "Add", blocked: "Reading what was decided…" },
    ]);
    const sse = {
      ...linear,
      params: {
        ...linear.params,
        server: {
          ...linear.params.server,
          transport: { type: "sse" as const, url: "https://x.example/sse" },
        },
      },
    };
    expect(view(sse, { kind: "proposed" }).steps).toEqual([
      {
        kind: "approve",
        label: "Add",
        blocked: "Juno can't add a server that streams over SSE yet.",
      },
    ]);
    const app = {
      ...linear,
      params: {
        ...linear.params,
        server: { ...linear.params.server, auth: { kind: "oauth-app" as const } },
      },
    };
    expect(view(app, { kind: "proposed" }).steps).toEqual([
      {
        kind: "approve",
        label: "Add",
        blocked: "Juno can't sign in with an OAuth app you registered yet.",
      },
    ]);
  });

  it.each<[string, McpProposalStatus, ReturnType<typeof view>["outcome"], string[]]>([
    ["adding", { kind: "adding" }, { tone: "working", words: "Adding Linear…" }, []],
    ["declined", { kind: "declined" }, { tone: "quiet", words: "Declined." }, []],
    [
      "an add that failed, in the server's words",
      { kind: "add-failed", words: "Codex refused the config." },
      { tone: "failed", words: "Codex refused the config." },
      [],
    ],
    [
      "connected, with its tools and agents",
      { kind: "connected", tools: 12, agents: ["Claude", "Codex"] },
      { tone: "done", words: "Linear is connected for Claude and Codex · 12 tools" },
      [],
    ],
    [
      "waiting for a sign-in",
      { kind: "needs-sign-in", agent: "Claude" },
      { tone: "attention", words: "Linear is added. Claude waits for you to sign in." },
      ["connect"],
    ],
    [
      "failed, in the server's own words",
      { kind: "failed", words: "401 Unauthorized", agent: "Codex" },
      { tone: "failed", words: "Codex: 401 Unauthorized" },
      [],
    ],
    [
      "gone since",
      { kind: "gone" },
      { tone: "quiet", words: "Linear is no longer set up here." },
      [],
    ],
  ])("shows %s with no Add", (_title, status, outcome, steps) => {
    const shown = view(linear, status);
    expect(shown.outcome).toEqual(outcome);
    expect(shown.steps.map((step) => step.kind)).toEqual(steps);
  });
});

describe("an MCP server proposal's state comes from the server list", () => {
  const status = (
    stage: Parameters<typeof mcpProposalStatus>[0]["stage"],
    list: McpServersList | null,
    driver: typeof CLAUDE | null = CLAUDE,
  ) => mcpProposalStatus({ proposal: linear, stage, failure: undefined, list, driver });

  it.each<[string, Parameters<typeof status>, McpProposalStatus]>([
    ["undecided is proposed", ["open", listWith()], { kind: "proposed" }],
    [
      "undecided but already set up is not offered again",
      ["open", listWith(entry([{ driver: CLAUDE, state: "connected" }]))],
      { kind: "already" },
    ],
    ["declined", ["declined", listWith()], { kind: "declined" }],
    [
      "approved and running, not listed yet, is adding",
      ["running", listWith()],
      { kind: "adding" },
    ],
    ["approved before the list is read is reading", ["done", null], { kind: "reading" }],
    ["approved and no longer listed is gone", ["done", listWith()], { kind: "gone" }],
    [
      "the conversation's agent waiting for a sign-in",
      [
        "done",
        listWith(
          entry([
            { driver: CLAUDE, state: "needs-auth" },
            { driver: CODEX, state: "connected", tools: tools(3) },
          ]),
        ),
      ],
      { kind: "needs-sign-in", agent: "Claude" },
    ],
    [
      "connected, counting its tools, for each agent that has it",
      [
        "done",
        listWith(
          entry([
            { driver: CLAUDE, state: "connected", tools: tools(12) },
            { driver: CODEX, state: "configured" },
          ]),
        ),
      ],
      { kind: "connected", tools: 12, agents: ["Claude", "Codex"] },
    ],
    [
      "a reload that did not see the end reads it from the list",
      ["unseen", listWith(entry([{ driver: CLAUDE, state: "connecting" }]))],
      { kind: "connecting" },
    ],
    [
      "failed, in the agent's own words",
      ["done", listWith(entry([{ driver: CLAUDE, state: "failed", error: "spawn npx ENOENT" }]))],
      { kind: "failed", words: "spawn npx ENOENT", agent: "Claude" },
    ],
    [
      "with no conversation agent, the most telling agent's state",
      [
        "done",
        listWith(
          entry([
            { driver: CLAUDE, state: "connected" },
            { driver: CODEX, state: "failed", error: "timed out" },
          ]),
        ),
        null,
      ],
      { kind: "failed", words: "timed out", agent: "Codex" },
    ],
  ])("%s", (_title, args, expected) => {
    expect(status(...args)).toEqual(expected);
  });

  it("an add HQ recorded as failed shows its words", () => {
    expect(
      mcpProposalStatus({
        proposal: linear,
        stage: "failed",
        failure: "Codex refused the config.",
        list: listWith(),
        driver: CLAUDE,
      }),
    ).toEqual({ kind: "add-failed", words: "Codex refused the config." });
  });
});

describe("Add writes the server for every agent with the keys the person typed", () => {
  it("puts a command's key in its environment", () => {
    expect(mcpAddInput(github, { GITHUB_TOKEN: "typed-value" })).toEqual({
      input: {
        name: "github",
        transport: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
        env: { GITHUB_TOKEN: "typed-value" },
      },
    });
  });

  it("puts a remote server's key in its header, after its prefix", () => {
    expect(mcpAddInput(sentry, { SENTRY_TOKEN: "typed-value" })).toEqual({
      input: {
        name: "sentry",
        transport: { type: "http", url: "https://mcp.sentry.dev/mcp" },
        headers: { Authorization: "Bearer typed-value" },
      },
    });
  });

  it("adds a server that signs in itself with no keys", () => {
    expect(mcpAddInput(linear, {})).toEqual({
      input: { name: "linear", transport: { type: "http", url: "https://mcp.linear.app/mcp" } },
    });
  });

  it("refuses until every key is typed", () => {
    expect(mcpAddInput(sentry, { SENTRY_TOKEN: "  " })).toEqual({
      refused: "Type the Sentry auth token first.",
    });
  });
});

describe("the agent hears which of its agents have the server with the next message", () => {
  it("says which agents it is connected for", () => {
    expect(
      mcpTurnNote(
        linear,
        listWith(
          entry([
            { driver: CLAUDE, state: "connected", tools: tools(12) },
            { driver: CODEX, state: "connected", tools: tools(12) },
          ]),
        ),
      ),
    ).toBe("Linear is connected for Claude and Codex (MCP server `linear`, 12 tools).");
  });

  it("says which agents wait for a sign-in and which failed, in their own words", () => {
    expect(
      mcpTurnNote(linear, {
        agents: [CLAUDE, CODEX, CURSOR],
        servers: [
          entry([
            { driver: CLAUDE, state: "needs-auth" },
            { driver: CODEX, state: "failed", error: "timed out" },
            { driver: CURSOR, state: "configured" },
          ]),
        ],
      }),
    ).toBe(
      "Linear (MCP server `linear`): added for Claude, waiting for the person to sign in; failed for Codex: timed out; added for Cursor.",
    );
  });

  it("says nothing of a server that is not listed", () => {
    expect(mcpTurnNote(linear, listWith())).toBeNull();
  });
});
