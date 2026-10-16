// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { RightPanelPage } from "../RightPanelPage";
import { McpPanelBody, MCP_WORDS } from "./McpPanel";
import { MCP_TAB_START } from "./McpServers.logic";
import { CLAUDE, MCP_SERVERS_FIXTURE } from "./mcpServersFixture";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <RightPanelPage kind="mcp" mate="Nova">
        <McpPanelBody
          act={async () => ({ ok: true })}
          driver={CLAUDE}
          onRetry={() => undefined}
          state={{ ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE }}
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

describe("MCP's Add a server", () => {
  it("opens on the servers, its form closed until Add a server is pressed", () => {
    expect(host.querySelectorAll("[data-mcp-server]").length).toBeGreaterThan(0);
    expect(host.querySelector("input")).toBeNull();
    act(() => buttonNamed(MCP_WORDS.addTitle)?.click());
    expect(host.querySelectorAll("input").length).toBeGreaterThan(0);
  });

  it("offers Add only once the server has a name and a command", () => {
    act(() => buttonNamed(MCP_WORDS.addTitle)?.click());
    const add = () => buttonNamed(MCP_WORDS.add);
    const [name, command] = Array.from(host.querySelectorAll<HTMLInputElement>("input"));
    expect(add()?.disabled).toBe(true);
    type(name!, "tea-shop");
    expect(add()?.disabled).toBe(true);
    type(command!, "npx -y tea-shop-mcp");
    expect(add()?.disabled).toBe(false);
  });

  it("calls the Mate by name in what the page says it is for", () => {
    expect(host.textContent).toContain("Tools Nova can use");
    expect(host.textContent).not.toMatch(/your agents|every agent/u);
  });
});
