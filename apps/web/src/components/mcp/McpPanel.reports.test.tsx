// @vitest-environment happy-dom
import { McpServerName, ProviderDriverKind, type McpServerAgent } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

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
  it.each(reports)("the MCP panel renders the Mate's $state report", async (report) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(() =>
        root.render(
          <McpPanelBody
            driver={driver}
            act={async () => ({ ok: true })}
            signIn={async () => ({ ok: false, message: "" })}
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
        ),
      );
      const row = container.querySelector<HTMLElement>('[data-mcp-server="zerops"] button');
      expect(row).not.toBeNull();
      await act(async () => row!.click());
      const html = container.innerHTML;
      expect(html).toContain("zcp serve");
      if (report.state === "connected") {
        expect(html).toContain("zerops_discover");
      } else {
        expect(html).toContain("None reported yet");
        if (report.error !== undefined) expect(html).toContain(report.error);
      }
      expect(html.includes(">Reconnect<")).toBe(report.state !== "configured");
      expect(html.match(/data-mcp-server="zerops" data-mcp-state="([^"]+)"/)?.[1]).toBe(
        report.state,
      );
    } finally {
      await act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
