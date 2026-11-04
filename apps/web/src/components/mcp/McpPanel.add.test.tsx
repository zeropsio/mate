// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { RightPanelPage } from "../RightPanelPage";
import { McpPanelBody, MCP_WORDS } from "./McpPanel";
import { MCP_TAB_START } from "./McpServers.logic";
import { CLAUDE, CODEX, MCP_SERVERS_FIXTURE } from "./mcpServersFixture";
import type { McpAction } from "./useMcpServers";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;
let actions: McpAction[];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  actions = [];
  act(() =>
    root.render(
      <RightPanelPage kind="mcp" mate="Nova">
        <McpPanelBody
          act={async (action) => {
            actions.push(action);
            return { ok: true };
          }}
          driver={CLAUDE}
          mateName="Nova"
          onRetry={() => undefined}
          signIn={async () => ({ ok: false, message: "" })}
          state={{
            ...MCP_TAB_START,
            list: { ...MCP_SERVERS_FIXTURE, agents: [CLAUDE, CODEX] },
          }}
        />
      </RightPanelPage>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const buttonNamed = (name: string) =>
  Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === name);

const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

const fields = () => Array.from(host.querySelectorAll<HTMLInputElement>("[data-mcp-add] input"));

describe("Add a tool", () => {
  it("opens the setup card from the tab's head, and Cancel puts it away", () => {
    expect(host.querySelectorAll("[data-mcp-server]").length).toBeGreaterThan(0);
    expect(host.querySelector("[data-mcp-add]")).toBeNull();
    act(() => buttonNamed(MCP_WORDS.addTool)?.click());
    expect(host.querySelector("[data-mcp-add]")?.textContent).toContain(MCP_WORDS.addTitle("Nova"));
    act(() => buttonNamed(MCP_WORDS.cancel)?.click());
    expect(host.querySelector("[data-mcp-add]")).toBeNull();
  });

  it("offers Add only once the server has a name and a command", () => {
    act(() => buttonNamed(MCP_WORDS.addTool)?.click());
    const add = () => buttonNamed(MCP_WORDS.addPress("Nova"));
    const [where, name] = fields();
    expect(add()?.disabled).toBe(true);
    type(name!, "tea-shop");
    expect(add()?.disabled).toBe(true);
    type(where!, "npx -y tea-shop-mcp");
    expect(add()?.disabled).toBe(false);
  });

  it("names the agents that can't use an SSE server before it is added", () => {
    act(() => buttonNamed(MCP_WORDS.addTool)?.click());
    const [where, name] = fields();
    type(where!, "https://mcp.deepwiki.com/sse");
    type(name!, "deepwiki");
    expect(host.querySelector("[data-mcp-reach]")?.textContent).toContain("An SSE server");
    expect(host.querySelector("[data-mcp-add-cannot]")?.textContent).toBe(
      "Codex can't use SSE servers.",
    );
  });

  it("adding a URL server that signs in with an API key sends the key as its header", async () => {
    act(() => buttonNamed(MCP_WORDS.addTool)?.click());
    const [where, name] = fields();
    type(where!, "https://mcp.example.com/mcp");
    type(name!, "docs");
    act(() => buttonNamed(MCP_WORDS.signInKey)?.click());
    type(
      host.querySelector<HTMLInputElement>('[data-mcp-sign-in="header"] input[data-secret]')!,
      "k3y",
    );
    await act(async () => buttonNamed(MCP_WORDS.addPress("Nova"))?.click());
    expect(actions).toEqual([
      {
        kind: "add",
        input: {
          name: "docs",
          transport: { type: "http", url: "https://mcp.example.com/mcp" },
          headers: { Authorization: "Bearer k3y" },
          auth: { kind: "header", name: "Authorization", value: "Bearer k3y" },
        },
      },
    ]);
  });

  it("calls the Mate by name in what the page says it is for", () => {
    expect(host.textContent).toContain("Tools Nova can use");
    expect(host.textContent).not.toMatch(/your agents|every agent/u);
  });
});
