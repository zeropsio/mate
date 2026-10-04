/**
 * One Mate's MCP servers in every state a row can stand in, as
 * `mcp.servers.list` answers them — for the logic tests and the MCP tab's
 * harness (`/design-mcp.html`). Fixtures only: nothing here ships.
 */
import { ProviderDriverKind, type McpServersList } from "@t3tools/contracts";

export const CLAUDE = ProviderDriverKind.make("claudeAgent");
export const CODEX = ProviderDriverKind.make("codex");
export const CURSOR = ProviderDriverKind.make("cursor");
export const OPENCODE = ProviderDriverKind.make("opencode");

export const MCP_SERVERS_FIXTURE: McpServersList = {
  agents: [CLAUDE, CODEX, CURSOR],
  servers: [
    {
      name: "playwright",
      managed: false,
      transport: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"] },
      agents: [
        {
          driver: CLAUDE,
          state: "connected",
          tools: [
            { name: "browser_navigate", description: "Navigate to a URL", readOnly: false },
            { name: "browser_snapshot", description: "Capture the page", readOnly: true },
            { name: "browser_close", destructive: true },
          ],
        },
        {
          driver: CODEX,
          state: "failed",
          error: "MCP client for `playwright` failed to start: request timed out",
        },
        { driver: CURSOR, state: "configured" },
      ],
    },
    {
      name: "zerops",
      managed: true,
      transport: { type: "stdio", command: "/usr/local/bin/zcp", args: ["mcp"] },
      agents: [
        {
          driver: CLAUDE,
          state: "connected",
          tools: [
            { name: "zerops_discover", readOnly: true },
            { name: "zerops_deploy", readOnly: false, destructive: false },
          ],
        },
        { driver: CODEX, state: "connected" },
        { driver: CURSOR, state: "configured" },
      ],
    },
    {
      name: "github",
      managed: false,
      transport: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      agents: [
        { driver: CLAUDE, state: "needs-auth" },
        { driver: CODEX, state: "needs-auth" },
        { driver: CURSOR, state: "configured" },
      ],
    },
    {
      name: "postgres",
      managed: false,
      transport: {
        type: "stdio",
        command: "uvx",
        args: ["postgres-mcp", "--access-mode=restricted"],
      },
      agents: [
        {
          driver: CLAUDE,
          state: "failed",
          error: "connection refused: db:5432",
        },
        {
          driver: CODEX,
          state: "failed",
          error: "connection refused: db:5432",
        },
        { driver: CURSOR, state: "configured" },
      ],
    },
    {
      name: "sentry",
      managed: false,
      transport: { type: "http", url: "https://mcp.sentry.dev/mcp" },
      agents: [
        { driver: CLAUDE, state: "disabled" },
        { driver: CODEX, state: "disabled" },
        { driver: CURSOR, state: "disabled" },
      ],
    },
    {
      name: "linear",
      managed: false,
      transport: { type: "http", url: "https://mcp.linear.app/sse" },
      agents: [{ driver: CLAUDE, state: "connecting" }],
    },
    {
      name: "context7",
      managed: false,
      scope: "project",
      transport: { type: "http", url: "https://mcp.context7.com/mcp" },
      agents: [
        {
          driver: CLAUDE,
          state: "connected",
          tools: [
            { name: "resolve-library-id", readOnly: true },
            { name: "get-library-docs", readOnly: true },
          ],
        },
        { driver: CODEX, state: "connected" },
        { driver: CURSOR, state: "configured" },
      ],
    },
  ],
};
