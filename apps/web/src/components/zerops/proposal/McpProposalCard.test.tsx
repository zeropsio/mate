// @vitest-environment happy-dom
import { ProviderDriverKind } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { McpProposalCard } from "./McpProposalCard";
import {
  mcpAskFace,
  mcpProposalView,
  type McpProposal,
  type McpProposalStatus,
  type McpSigning,
} from "./mcpProposal.logic";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const sentry: McpProposal = {
  id: "p-1",
  kind: "mcp.add",
  summary: "Set up Sentry",
  reason: "to read the errors your checkout throws",
  projectId: "p-juno",
  params: {
    scope: "mate",
    server: {
      name: "sentry",
      title: "Sentry",
      transport: { type: "http", url: "https://mcp.sentry.dev/mcp" },
      auth: { kind: "header" },
    },
    credentials: [
      {
        key: "SENTRY_TOKEN",
        label: "Sentry auth token",
        placement: "header",
        headerName: "Authorization",
        prefix: "Bearer ",
      },
    ],
  },
};

const AGENTS = [ProviderDriverKind.make("claudeAgent")];

async function mount(status: McpProposalStatus, signing: McpSigning = { phase: "idle" }) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const pressed: Array<{ kind: string; value?: unknown }> = [];
  const view = mcpProposalView({
    proposal: sentry,
    mateName: "Juno",
    status,
    signing,
    approveBlocked: undefined,
    agents: AGENTS,
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <McpProposalCard
        askId={sentry.id}
        face={mcpAskFace({
          view,
          status,
          signing,
          busy: false,
          title: "Sentry",
          signsIn: false,
          by: null,
          at: null,
        })}
        onAdd={(values) => pressed.push({ kind: "add", value: values })}
        onDecline={() => pressed.push({ kind: "not-now" })}
        onFinishSignIn={(landed) => pressed.push({ kind: "finish", value: landed })}
        signing={signing}
        view={view}
      />,
    ),
  );
  return { container, pressed };
}

const button = (container: Element, words: string) =>
  [...container.querySelectorAll("button")].find((each) => each.textContent?.trim() === words);

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("an MCP server proposed on the ask card", () => {
  it("adds it with the key the person typed, masked and said nowhere on the card", async () => {
    const value = ["sntrys", "_", "Qz".repeat(10)].join("");
    const { container, pressed } = await mount({ kind: "proposed" });
    const field = container.querySelector<HTMLInputElement>('input[data-secret=""]')!;
    expect(button(container, "Add Sentry")?.disabled).toBe(true);
    await type(field, value);
    await act(async () => button(container, "Add Sentry")!.click());
    expect(pressed).toEqual([{ kind: "add", value: { SENTRY_TOKEN: value } }]);
    expect(container.textContent).not.toContain(value);
  });

  it("Not now declines it", async () => {
    const { container, pressed } = await mount({ kind: "proposed" });
    await act(async () => button(container, "Not now")!.click());
    expect(pressed).toEqual([{ kind: "not-now" }]);
  });

  it("finishes a sign-in with the address the person pasted where the browser can't come back", async () => {
    const { container, pressed } = await mount(
      { kind: "needs-sign-in", agent: "Codex" },
      { phase: "paste", url: "https://sentry.io/oauth", finishing: false },
    );
    const paste = container.querySelector<HTMLInputElement>(
      'input[placeholder^="http://localhost"]',
    )!;
    await type(paste, "http://localhost:1455/callback?code=abc");
    await act(async () => button(container, "Finish")!.click());
    expect(pressed).toEqual([{ kind: "finish", value: "http://localhost:1455/callback?code=abc" }]);
  });
});
