/**
 * The MCP tab in the right panel as the app lays it out at the owner's size:
 * 1786 wide, the left menu at 435 (`?menu=` for another), the panel at its
 * default 540 beside the conversation, or maximized over it with `?max=1`.
 *
 * The real `McpPanelBody` in the real `RightPanelTabs`, over the fixture list
 * (`mcpServersFixture.ts`). `?state=` — `list` (the default), `loading` (the
 * first read in flight), `error` (the first read failed), `stale` (a later
 * read failed over a list), `busy` (a read in flight over a list), `empty`.
 * `?agent=` — whose dots: `claudeAgent` (the default), `codex`, `cursor`,
 * `opencode`. Actions answer after 600 ms by changing the fixture; `?fail=1`
 * makes every action fail as the server does today. `?theme=dark` for dark.
 *
 * Served by the dev server at `/design-mcp.html`. Fixtures only: nothing here
 * ships, and no route imports this module.
 */
import { ProviderDriverKind, type McpServerEntry, type McpServersList } from "@t3tools/contracts";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { McpPanelBody } from "~/components/mcp/McpPanel";
import { MCP_TAB_START, type McpTabState } from "~/components/mcp/McpServers.logic";
import { MCP_SERVERS_FIXTURE } from "~/components/mcp/mcpServersFixture";
import type { McpAction, McpActionResult } from "~/components/mcp/useMcpServers";
import { RightPanelTabs } from "~/components/RightPanelTabs";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const STATE = params.get("state") ?? "list";
const AGENT = ProviderDriverKind.make(params.get("agent") ?? "claudeAgent");
const FAIL = params.get("fail") === "1";
const MAXIMIZED = params.get("max") === "1";
const MENU = Number(params.get("menu") ?? 435);
const noop = () => {};

const START: Record<string, McpTabState> = {
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
    case "reconnect":
      return {
        ...list,
        servers: list.servers.map((entry) =>
          entry.name !== action.name
            ? entry
            : {
                ...entry,
                agents: entry.agents.map((agent) =>
                  agent.state === "failed"
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
  return <McpPanelBody act={act} driver={AGENT} onRetry={noop} state={state} />;
}

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
