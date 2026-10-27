// @vitest-environment happy-dom
import { McpServerName, ProviderDriverKind } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vite-plus/test";

import { McpPanelBody } from "./McpPanel";
import { MCP_TAB_START } from "./McpServers.logic";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const driver = ProviderDriverKind.make("codex");

it("pressing the built-in server's row opens its tools", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() =>
      root.render(
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
                  agents: [
                    {
                      driver,
                      state: "connected",
                      tools: [{ name: "zerops_discover", description: "Inspect the project" }],
                    },
                  ],
                },
              ],
            },
          }}
        />,
      ),
    );
    expect(container.textContent).not.toContain("zerops_discover");
    const row = container.querySelector<HTMLElement>('[data-mcp-server="zerops"] button');
    expect(row).not.toBeNull();
    await act(async () => row!.click());
    expect(container.textContent).toContain("zerops_discover");
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
});
