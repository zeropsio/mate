/**
 * The Tools tab in the right panel as the app lays it out at the owner's size:
 * 1786 wide, the left menu at 435 (`?menu=` for another), the panel at its
 * default 540 beside the conversation, or maximized over it with `?max=1`.
 *
 * The real `McpPanelBody` in the real `RightPanelTabs`. `?state=` — `board` (the
 * default: the design board's Mate, a proposal and one tool in each state),
 * `list` (the logic tests' fixture, `mcpServersFixture.ts`), `loading` (the
 * first read in flight), `error` (the first read failed), `stale` (a later
 * read failed over a list), `busy` (a read in flight over a list), `empty`.
 * `?agent=` — whose dots: `claudeAgent` (the default), `codex`, `cursor`,
 * `opencode`. Actions answer after 600 ms by changing the fixture; `?fail=1`
 * makes every action fail as the server does today. Sign in (github) opens an
 * example page; `?landing=mate` lands back on the Mate, otherwise the tab asks
 * for the pasted address. `?theme=dark` for dark.
 *
 * Served by the dev server at `/design-mcp.html`. Fixtures only: nothing here
 * ships, and no route imports this module.
 */
import { ProviderDriverKind, type McpServerEntry, type McpServersList } from "@t3tools/contracts";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { RightPanelPage } from "~/components/RightPanelPage";
import { McpPanelBody } from "~/components/mcp/McpPanel";
import { ObserveLineBody } from "~/components/mcp/ObserveCredentialControl";
import { McpProposalCard } from "~/components/zerops/proposal/McpProposalCard";
import {
  mcpAskFace,
  mcpProgress,
  mcpProposalView,
  type McpProposal,
} from "~/components/zerops/proposal/mcpProposal.logic";
import { MateFace } from "~/components/zerops/primitives";
import { MCP_TAB_START, type McpTabState } from "~/components/mcp/McpServers.logic";
import { MCP_SERVERS_FIXTURE } from "~/components/mcp/mcpServersFixture";
import type { McpAction, McpActionResult, McpSignInResult } from "~/components/mcp/useMcpServers";
import { RightPanelTabs } from "~/components/RightPanelTabs";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const STATE = params.get("state") ?? "board";
const AGENT = ProviderDriverKind.make(params.get("agent") ?? "claudeAgent");
const FAIL = params.get("fail") === "1";
const MAXIMIZED = params.get("max") === "1";
const MENU = Number(params.get("menu") ?? 435);
const LANDING = params.get("landing") === "mate" ? "mate" : "paste";
const noop = () => {};

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const CODEX = ProviderDriverKind.make("codex");
const name = (value: string) => value as McpServerEntry["name"];
const tool = (toolName: string, readOnly: boolean) => ({ name: toolName, readOnly });

/** The board's Mate: the servers a working Mate has, one in each state. */
const BOARD: McpServersList = {
  agents: [CLAUDE, CODEX],
  servers: [
    {
      name: name("zerops"),
      managed: true,
      transport: { type: "stdio", command: "zcp", args: ["serve"] },
      agents: [
        {
          driver: CLAUDE,
          state: "connected",
          tools: [
            ...[
              "discover",
              "events",
              "logs",
              "browser",
              "verify",
              "export",
              "knowledge",
              "workflow",
            ].map((each) => tool(`zerops_${each}`, true)),
            ...["deploy", "env", "manage", "dev_server", "import", "delete"].map((each) =>
              tool(`zerops_${each}`, false),
            ),
          ],
        },
        { driver: CODEX, state: "connected" },
      ],
    },
    {
      name: name("sentry"),
      managed: false,
      transport: { type: "http", url: "https://mcp.sentry.dev/mcp" },
      agents: [
        { driver: CLAUDE, state: "needs-auth" },
        { driver: CODEX, state: "needs-auth" },
      ],
    },
    {
      name: name("linear"),
      managed: false,
      transport: { type: "http", url: "https://mcp.linear.app/mcp" },
      auth: { kind: "oauth", scopes: [] },
      agents: [
        {
          driver: CLAUDE,
          state: "connected",
          tools: [
            ...[
              "list_issues",
              "get_issue",
              "list_comments",
              "list_projects",
              "list_teams",
              "list_users",
              "search",
            ].map((each) => tool(each, true)),
            ...["create_issue", "update_issue", "create_comment"].map((each) => tool(each, false)),
          ],
        },
        { driver: CODEX, state: "connected" },
      ],
    },
    {
      name: name("deepwiki"),
      managed: false,
      transport: { type: "sse", url: "https://mcp.deepwiki.com/sse" },
      cannot: [{ driver: CODEX, reason: "Codex can't use SSE servers." }],
      agents: [
        {
          driver: CLAUDE,
          state: "connected",
          tools: ["read_wiki_structure", "read_wiki_contents", "ask_question"].map((each) =>
            tool(each, true),
          ),
        },
      ],
    },
    {
      name: name("postgres"),
      managed: false,
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
      },
      secretNames: ["DATABASE_URL"],
      agents: [
        { driver: CLAUDE, state: "disabled" },
        { driver: CODEX, state: "disabled" },
      ],
    },
  ],
};

const START: Record<string, McpTabState> = {
  board: { ...MCP_TAB_START, list: BOARD },
  list: { ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE },
  loading: { ...MCP_TAB_START, busy: true, inFlight: [1] },
  error: { ...MCP_TAB_START, error: "Not built yet." },
  stale: { ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE, error: "Not built yet." },
  busy: { ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE, busy: true, inFlight: [1] },
  empty: { ...MCP_TAB_START, list: { agents: MCP_SERVERS_FIXTURE.agents, servers: [] } },
};

function applyAction(list: McpServersList, action: McpAction): McpServersList {
  switch (action.kind) {
    case "add": {
      const entry: McpServerEntry = {
        name: action.input.name,
        managed: false,
        transport: action.input.transport,
        agents: list.agents.map((driver) => ({ driver, state: "connecting" as const })),
      };
      return { ...list, servers: [...list.servers, entry] };
    }
    case "remove":
      return { ...list, servers: list.servers.filter((entry) => entry.name !== action.name) };
    case "setEnabled":
      return {
        ...list,
        servers: list.servers.map((entry) =>
          entry.name !== action.name
            ? entry
            : {
                ...entry,
                agents: entry.agents.map((agent) => ({
                  driver: agent.driver,
                  state: action.enabled ? ("connected" as const) : ("disabled" as const),
                  ...(agent.tools === undefined ? {} : { tools: agent.tools }),
                })),
              },
        ),
      };
    case "update":
      return {
        ...list,
        servers: list.servers.map((entry) =>
          entry.name !== action.name
            ? entry
            : { ...entry, secretNames: [...action.keep, ...Object.keys(action.values)].toSorted() },
        ),
      };
    case "signOut":
      return {
        ...list,
        servers: list.servers.map((entry) =>
          entry.name !== action.name
            ? entry
            : {
                ...entry,
                agents: entry.agents.map((agent) =>
                  agent.state === "connected"
                    ? { driver: agent.driver, state: "needs-auth" as const }
                    : agent,
                ),
              },
        ),
      };
    case "finishSignIn":
    case "reconnect":
      return {
        ...list,
        servers: list.servers.map((entry) =>
          entry.name !== action.name
            ? entry
            : {
                ...entry,
                agents: entry.agents.map((agent) =>
                  agent.state === "failed" || agent.state === "needs-auth"
                    ? { driver: agent.driver, state: "connected" as const }
                    : agent,
                ),
              },
        ),
      };
  }
}

function Tab() {
  const [state, setState] = useState<McpTabState>(START[STATE] ?? START.list!);
  const act = async (action: McpAction): Promise<McpActionResult> => {
    setState((current) => ({ ...current, busy: true }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (FAIL) {
      setState((current) => ({ ...current, busy: false }));
      return { ok: false, message: "Not built yet." };
    }
    setState((current) => ({
      ...current,
      busy: false,
      error: null,
      list: current.list === null ? null : applyAction(current.list, action),
    }));
    return { ok: true };
  };
  const signIn = async (): Promise<McpSignInResult> => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return FAIL
      ? { ok: false, message: "Not built yet." }
      : {
          ok: true,
          signIn: { kind: "open", url: "https://example.com/", landing: LANDING, flow: "f" },
        };
  };
  return (
    <RightPanelPage kind="mcp" mate="Juno">
      <McpPanelBody
        act={act}
        driver={AGENT}
        mateName="Juno"
        observe={
          <ObserveLineBody
            authorize={noop}
            available
            personName={() => "Aleš"}
            press={null}
            state={{
              metadata: {
                state: "known",
                value: { authorized: true, userId: "p", expiresAt: "2026-12-04T10:00:00Z" },
                stale: false,
              },
            }}
          />
        }
        onRetry={noop}
        proposals={STATE === "board" ? [GITHUB_PROPOSAL] : []}
        signIn={signIn}
        state={state}
      />
    </RightPanelPage>
  );
}

/** The Mate's proposal as the tab lists it, its card the kit's (`McpProposalCard`), as proposed. */
const GITHUB: McpProposal = {
  id: "proposal-github",
  kind: "mcp.add",
  summary: "Set up GitHub",
  reason: "To open pull requests for the checkout fixes",
  projectId: "p-juno",
  params: {
    scope: "mate",
    server: {
      name: "github",
      title: "GitHub",
      transport: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      auth: { kind: "header" },
    },
    credentials: [
      {
        key: "GITHUB_TOKEN",
        label: "GitHub token (read-only is enough)",
        placement: "header",
        headerName: "Authorization",
        prefix: "Bearer ",
      },
    ],
  },
};

function GithubCard() {
  const status = { kind: "proposed" } as const;
  const signing = { phase: "idle" } as const;
  const view = mcpProposalView({
    proposal: GITHUB,
    mateName: "Juno",
    status,
    signing,
    approveBlocked: undefined,
    agents: [CLAUDE, CODEX],
  });
  return (
    <McpProposalCard
      askId={GITHUB.id}
      density="full"
      face={mcpAskFace({
        view,
        status,
        signing,
        busy: false,
        title: GITHUB.params.server.title,
        signsIn: false,
        keyed: true,
        by: null,
        at: null,
      })}
      mateFace={<MateFace size={24} state="needs" tint="sky" />}
      onAdd={noop}
      onChangeKey={async () => true}
      onDecline={noop}
      onFinishSignIn={noop}
      onOpenAgain={noop}
      onSignIn={noop}
      onTryAgain={noop}
      progress={mcpProgress(GITHUB, status, null)}
      signing={signing}
      view={view}
    />
  );
}

const GITHUB_PROPOSAL = {
  id: GITHUB.id,
  name: GITHUB.params.server.title,
  reason: GITHUB.reason ?? null,
  card: <GithubCard />,
};

function Harness() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU }} />
      <div className={MAXIMIZED ? "w-0 flex-none" : "min-w-0 flex-1"} />
      <RightPanelTabs
        activeSurfaceId="mcp"
        availability={resolveRightPanelAvailability({
          projectOpen: true,
          gitRepo: true,
          serverThread: true,
          zeropsPanel: "available",
          crewStatus: "applied",
          matePersona: true,
        })}
        defaultWidth={540}
        liveAgentCount={0}
        maximized={MAXIMIZED}
        mode="inline"
        onActivate={noop}
        onAdd={noop}
        onAddTerminal={noop}
        onCloseAllSurfaces={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurface={noop}
        onCloseSurfacesToRight={noop}
        onCopyFilePath={noop}
        pendingSurfaceIds={new Set()}
        surfaces={[
          { id: "zerops", kind: "zerops" },
          { id: "mcp", kind: "mcp" },
        ]}
        terminalLabelsById={new Map()}
        widthStorageKey="mate:design-mcp:panel-width"
      >
        <Tab />
      </RightPanelTabs>
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
