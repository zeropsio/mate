import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { McpPanelBody, MCP_WORDS } from "./McpPanel";
import { MCP_TAB_START, type McpTabState } from "./McpServers.logic";
import { CLAUDE, MCP_SERVERS_FIXTURE } from "./mcpServersFixture";

const render = (state: McpTabState) =>
  renderToStaticMarkup(
    <McpPanelBody
      act={async () => ({ ok: true })}
      driver={CLAUDE}
      onRetry={() => undefined}
      state={state}
    />,
  ).replaceAll("&#x27;", "'");

const serverNames = (html: string) =>
  [...html.matchAll(/data-mcp-server="([^"]+)"/gu)].map((match) => match[1]);

describe("McpPanelBody — what the MCP tab shows", () => {
  it("draws a row per server, Zerops' own first, and the add form", () => {
    const html = render({ ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE });
    expect(html).toContain(MCP_WORDS.title);
    expect(html).toContain(MCP_WORDS.line);
    expect(serverNames(html)).toEqual([
      "zerops",
      "playwright",
      "github",
      "postgres",
      "sentry",
      "linear",
      "context7",
    ]);
    expect(html).toContain(MCP_WORDS.builtIn);
    expect(html).toContain("Needs sign-in");
    expect(html).toContain("connection refused: db:5432");
    expect(html).toContain("data-mcp-add");
  });

  it("paints nothing but its heading while the first read is out", () => {
    const html = render({ ...MCP_TAB_START, busy: true, inFlight: [1] });
    expect(html).toContain('data-mcp-busy="true"');
    expect(serverNames(html)).toEqual([]);
    expect(html).not.toContain("data-mcp-add");
    expect(html).not.toContain(MCP_WORDS.none);
  });

  it("says why a read failed, and keeps the list it had", () => {
    const first = render({ ...MCP_TAB_START, error: "Not built yet." });
    expect(first).toContain(`${MCP_WORDS.readFailed} Not built yet.`);
    expect(first).toContain(MCP_WORDS.tryAgain);
    expect(serverNames(first)).toEqual([]);

    const later = render({ ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE, error: "Not built yet." });
    expect(later).toContain("Not built yet.");
    expect(serverNames(later)).toHaveLength(MCP_SERVERS_FIXTURE.servers.length);
  });

  it("says so when the Mate has no servers", () => {
    const html = render({
      ...MCP_TAB_START,
      list: { agents: MCP_SERVERS_FIXTURE.agents, servers: [] },
    });
    expect(html).toContain(MCP_WORDS.none);
    expect(html).toContain("data-mcp-add");
  });
});
