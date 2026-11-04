import { ProviderDriverKind, type McpServerEntry, type McpServersList } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { CLAUDE, CODEX, CURSOR } from "../../mcp/mcpServersFixture";

const OPENCODE = ProviderDriverKind.make("opencode");
import {
  MCP_APP_CLIENT_ID,
  MCP_APP_CLIENT_SECRET,
  mcpAddInput,
  mcpAskFace,
  mcpCannot,
  mcpProgress,
  mcpProposalStatus,
  mcpProposalView,
  mcpTurnNote,
  type McpProposal,
  type McpProposalStatus,
  type McpSigning,
  MCP_SIGN_IN_ELSEWHERE,
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

const sse: McpProposal = {
  ...linear,
  params: {
    ...linear.params,
    server: {
      ...linear.params.server,
      transport: { type: "sse", url: "https://x.example/sse" },
      auth: { kind: "none" },
    },
  },
};

const app: McpProposal = {
  ...linear,
  params: {
    ...linear.params,
    server: { ...linear.params.server, auth: { kind: "oauth-app", scopes: ["read"] } },
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

const AGENTS = [CLAUDE, CODEX];

const view = (
  proposal: McpProposal,
  status: McpProposalStatus,
  approveBlocked?: string,
  agents: ReadonlyArray<ProviderDriverKind> = AGENTS,
) =>
  mcpProposalView({
    proposal,
    mateName: "Juno",
    status,
    signing: { phase: "idle" },
    approveBlocked,
    agents,
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
          {
            key: "SENTRY_TOKEN",
            label: "Sentry auth token",
            where: "Sent as Authorization",
            hidden: true,
            optional: false,
          },
        ],
      },
      { kind: "approve", label: "Add Sentry", blocked: null },
    ]);
    expect(view(github, { kind: "proposed" }).steps[0]).toEqual({
      kind: "provide",
      fields: [
        {
          key: "GITHUB_TOKEN",
          label: "GitHub token",
          where: "Kept as GITHUB_TOKEN",
          hidden: true,
          optional: false,
        },
      ],
    });
  });

  it("offers Add alone where nothing needs typing", () => {
    expect(view(linear, { kind: "proposed" }).steps).toEqual([
      { kind: "approve", label: "Add Linear", blocked: null },
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
      { kind: "approve", label: "Add Linear", blocked: "Reading what was decided…" },
    ]);
    // None of its agents can use an SSE server, or sign in with the person's own app.
    expect(view(sse, { kind: "proposed" }, undefined, [CODEX]).steps).toEqual([
      {
        kind: "approve",
        label: "Add Linear",
        blocked: "None of Juno's agents can use SSE servers.",
      },
    ]);
    expect(view(app, { kind: "proposed" }, undefined, [CODEX]).steps.at(-1)).toEqual({
      kind: "approve",
      label: "Add Linear",
      blocked: "None of Juno's agents can sign in with your own app.",
    });
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
    expect(mcpAddInput(github, { GITHUB_TOKEN: "typed-value" }, AGENTS)).toEqual({
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
    expect(mcpAddInput(sentry, { SENTRY_TOKEN: "typed-value" }, AGENTS)).toEqual({
      input: {
        name: "sentry",
        transport: { type: "http", url: "https://mcp.sentry.dev/mcp" },
        headers: { Authorization: "Bearer typed-value" },
      },
    });
  });

  it("adds a server that signs in itself with no keys", () => {
    expect(mcpAddInput(linear, {}, AGENTS)).toEqual({
      input: { name: "linear", transport: { type: "http", url: "https://mcp.linear.app/mcp" } },
    });
  });

  it("refuses until every key is typed", () => {
    expect(mcpAddInput(sentry, { SENTRY_TOKEN: "  " }, AGENTS)).toEqual({
      refused: "Type the Sentry auth token first.",
    });
  });
});

describe("an SSE server, or one signing in with the person's own app", () => {
  it("is written as SSE, its keys in its headers", () => {
    const keyed: McpProposal = {
      ...sse,
      params: { ...sse.params, credentials: sentry.params.credentials },
    };
    expect(mcpAddInput(keyed, { SENTRY_TOKEN: "typed-value" }, AGENTS)).toEqual({
      input: {
        name: "linear",
        transport: { type: "sse", url: "https://x.example/sse" },
        headers: { Authorization: "Bearer typed-value" },
      },
    });
  });

  it("signs in with the app's client ID the person typed, its secret only where given", () => {
    expect(
      mcpAddInput(
        app,
        { [MCP_APP_CLIENT_ID]: " juno-app ", [MCP_APP_CLIENT_SECRET]: "s3cret" },
        AGENTS,
      ),
    ).toEqual({
      input: {
        name: "linear",
        transport: { type: "http", url: "https://mcp.linear.app/mcp" },
        auth: { kind: "oauth-app", clientId: "juno-app", clientSecret: "s3cret", scopes: ["read"] },
      },
    });
    expect(mcpAddInput(app, { [MCP_APP_CLIENT_ID]: "juno-app" }, AGENTS)).toEqual({
      input: {
        name: "linear",
        transport: { type: "http", url: "https://mcp.linear.app/mcp" },
        auth: { kind: "oauth-app", clientId: "juno-app", scopes: ["read"] },
      },
    });
    expect(mcpAddInput(app, {}, AGENTS)).toEqual({ refused: "Give your app's client ID." });
  });

  it("asks for the app's client ID shown and its secret hidden, and where to send each agent back", () => {
    const shown = view(app, { kind: "proposed" }, undefined, [CLAUDE, CODEX, OPENCODE]);
    expect(shown.steps[0]).toEqual({
      kind: "provide",
      fields: [
        {
          key: MCP_APP_CLIENT_ID,
          label: "Your app's client ID",
          where: "Kept in each agent's config",
          hidden: false,
          optional: false,
        },
        {
          key: MCP_APP_CLIENT_SECRET,
          label: "Your app's client secret, if it has one",
          where: "Kept in each agent's config",
          hidden: true,
          optional: true,
        },
      ],
    });
    expect(shown.redirects).toEqual([
      { agent: "Claude", url: "http://localhost:33418/callback" },
      { agent: "OpenCode", url: "http://127.0.0.1:33419/mcp/oauth/callback" },
    ]);
  });

  it.each([
    {
      name: "SSE",
      proposal: sse,
      agents: [CLAUDE, CODEX, OPENCODE],
      want: "Codex and OpenCode can't use SSE servers.",
    },
    {
      name: "an own app",
      proposal: app,
      agents: [CLAUDE, CODEX, CURSOR],
      want: "Codex can't sign in with your own app.",
    },
    { name: "streamable HTTP", proposal: linear, agents: [CODEX], want: null },
  ])("names the agents that can't use it: $name", ({ proposal, agents, want }) => {
    expect(mcpCannot(proposal, agents)).toBe(want);
    expect(view(proposal, { kind: "proposed" }, undefined, agents).cannot).toBe(want);
  });

  it("refuses what none of the Mate's agents can use", () => {
    expect(mcpAddInput(sse, {}, [CODEX])).toEqual({
      refused: "None of this Mate's agents can use SSE servers.",
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

describe("the MCP setup on the ask card", () => {
  const face = (status: McpProposalStatus, signing: McpSigning = { phase: "idle" }, busy = false) =>
    mcpAskFace({
      view: view(linear, status),
      status,
      signing,
      busy,
      title: "Linear",
      signsIn: true,
      by: "Aleš",
      at: "15:20",
    });
  it.each<[string, McpProposalStatus, McpSigning, boolean, unknown]>([
    [
      "undecided: Add and Not now",
      { kind: "proposed" },
      { phase: "idle" },
      false,
      { main: "Add Linear", notNow: true, state: { kind: "waiting" } },
    ],
    [
      "an Add on its way",
      { kind: "proposed" },
      { phase: "idle" },
      true,
      {
        main: "Add Linear",
        notNow: false,
        state: { kind: "working", words: "Adding Linear…", pressed: "main" },
      },
    ],
    [
      "added, its agent waiting for a sign-in",
      { kind: "needs-sign-in", agent: "Claude" },
      { phase: "idle" },
      false,
      { main: "Sign in to Linear", notNow: false, state: { kind: "waiting" } },
    ],
    [
      "signing in on the provider's page",
      { kind: "needs-sign-in", agent: "Claude" },
      { phase: "mate", url: "https://linear.app/oauth" },
      false,
      {
        main: null,
        notNow: false,
        state: { kind: "working", words: MCP_SIGN_IN_ELSEWHERE, pressed: null },
      },
    ],
    [
      "the paste fallback: Finish",
      { kind: "needs-sign-in", agent: "Claude" },
      { phase: "paste", url: "https://linear.app/oauth", finishing: false },
      false,
      { main: "Finish", notNow: false, state: { kind: "waiting" } },
    ],
    [
      "connected, with its tools and agents",
      { kind: "connected", tools: 23, agents: ["Claude", "Codex"] },
      { phase: "idle" },
      false,
      {
        main: null,
        notNow: false,
        state: {
          kind: "done",
          words: "Linear is connected for Claude and Codex · 23 tools",
          told: null,
        },
      },
    ],
    [
      "failed, in the server's words",
      { kind: "failed", words: "401 Unauthorized", agent: "Codex" },
      { phase: "idle" },
      false,
      { main: null, notNow: false, state: { kind: "failed", words: "Codex: 401 Unauthorized" } },
    ],
    [
      "Not now: who and when",
      { kind: "declined" },
      { phase: "idle" },
      false,
      { main: null, notNow: false, state: { kind: "notNow", words: "Not now · Aleš, 15:20" } },
    ],
  ])(
    "the card's state comes from the decision and the server list: %s",
    (_name, status, signing, busy, want) => {
      const drawn = face(status, signing, busy);
      expect({ main: drawn.main?.label ?? null, notNow: drawn.notNow, state: drawn.state }).toEqual(
        want,
      );
    },
  );

  it("a failed server that signs in offers to sign in again", () => {
    expect(face({ kind: "failed", words: "401 Unauthorized", agent: "Codex" }).action).toBe(
      "signInAgain",
    );
  });

  it("numbers adding and signing in, each as far as it got", () => {
    expect(mcpProgress(linear, { kind: "needs-sign-in", agent: "Claude" }, "Claude")).toEqual([
      { id: "add", label: "Add Linear", detail: "mcp.linear.app/mcp", state: "done", end: "Added" },
      {
        id: "sign-in",
        label: "Sign in to Linear",
        detail: "as you; Claude uses your access",
        state: "now",
        end: undefined,
      },
    ]);
    expect(mcpProgress(github, { kind: "proposed" }, null)).toBeNull();
  });
});
