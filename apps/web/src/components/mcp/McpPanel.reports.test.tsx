import { McpServerName, ProviderDriverKind, type McpServerAgent } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

// Arrange the panel's local disclosure state; the server record and rendering stay real.
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const value = typeof initial === "function" ? initial() : initial;
      return [value instanceof Set ? new Set(["zerops"]) : value, vi.fn()];
    },
  };
});

import { McpPanelBody } from "./McpPanel";
import { MCP_TAB_START } from "./McpServers.logic";

const driver = ProviderDriverKind.make("codex");
const reports: ReadonlyArray<McpServerAgent> = [
  {
    driver,
    state: "connected",
    tools: [{ name: "zerops_discover", description: "Inspect the project" }],
  },
  { driver, state: "failed", error: "zcp exited with code 1" },
  { driver, state: "configured" },
];

describe("C: the built-in MCP server", () => {
  it.each(reports)("the MCP panel renders the Mate's $state report", (report) => {
    const html = renderToStaticMarkup(
      <McpPanelBody
        driver={driver}
        act={async () => ({ ok: true })}
        onRetry={() => {}}
        state={{
          ...MCP_TAB_START,
          list: {
            agents: [driver],
            servers: [
              {
                name: McpServerName.make("zerops"),
                managed: true,
                transport: { type: "stdio", command: "zcp", args: ["serve"] },
                agents: [report],
              },
            ],
          },
        }}
      />,
    );
    expect(html).toContain("MCP servers");
    expect(html).toContain("zcp serve");
    if (report.state === "connected") {
      expect(html).toContain("zerops_discover");
      expect(html).toContain("Inspect the project");
    } else {
      expect(html).toContain("No tools reported yet.");
      if (report.error !== undefined) expect(html).toContain(report.error);
    }
    expect(html.includes(">Reconnect<")).toBe(report.state !== "configured");
    expect(html.match(/data-mcp-server="zerops" data-mcp-state="([^"]+)"/)?.[1]).toBe(report.state);
  });
});
