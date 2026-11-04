// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { McpPanelBody, MCP_WORDS } from "./McpPanel";
import { MCP_TAB_START } from "./McpServers.logic";
import { CLAUDE, MCP_SERVERS_FIXTURE } from "./mcpServersFixture";
import type { McpAction } from "./useMcpServers";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("Sign in opens the provider's page, and a landing the browser can't reach is finished with the pasted address", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  const actions: McpAction[] = [];
  const landed = "http://127.0.0.1:5555/callback?code=one-time&state=s";
  try {
    await act(() =>
      root.render(
        <McpPanelBody
          act={async (action) => {
            actions.push(action);
            return { ok: true };
          }}
          driver={CLAUDE}
          onRetry={() => {}}
          signIn={async () => ({
            ok: true,
            signIn: {
              kind: "open",
              url: "https://auth.example.com/authorize",
              landing: "paste",
              flow: "f-1",
            },
          })}
          state={{ ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE }}
        />,
      ),
    );
    const button = (name: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === name,
      );
    await act(async () =>
      container.querySelector<HTMLElement>('[data-mcp-server="github"] button')!.click(),
    );
    await act(async () => button(MCP_WORDS.signIn)!.click());
    expect(tab.location.href).toBe("https://auth.example.com/authorize");
    expect(tab.opener).toBeNull();

    const input = container.querySelector<HTMLInputElement>('[data-mcp-signing="paste"] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        landed,
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button(MCP_WORDS.signInFinish)!.click());
    expect(actions).toEqual([{ kind: "finishSignIn", name: "github", flow: "f-1", landed }]);
  } finally {
    open.mockRestore();
    await act(() => root.unmount());
    container.remove();
  }
});

it.each([{ name: "context7", press: "Sign out", action: { kind: "signOut", name: "context7" } }])(
  "$press on a signed-in server drops the agent's sign-in",
  async ({ name, press, action }) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const actions: McpAction[] = [];
    try {
      await act(() =>
        root.render(
          <McpPanelBody
            act={async (next) => {
              actions.push(next);
              return { ok: true };
            }}
            driver={CLAUDE}
            onRetry={() => {}}
            signIn={async () => ({ ok: false, message: "" })}
            state={{ ...MCP_TAB_START, list: MCP_SERVERS_FIXTURE }}
          />,
        ),
      );
      await act(async () =>
        container.querySelector<HTMLElement>(`[data-mcp-server="${name}"] button`)!.click(),
      );
      const button = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === press,
      );
      await act(async () => button!.click());
      expect(actions).toEqual([action]);
    } finally {
      await act(() => root.unmount());
      container.remove();
    }
  },
);
