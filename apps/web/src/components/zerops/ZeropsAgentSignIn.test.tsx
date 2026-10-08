// @vitest-environment happy-dom
/**
 * The sign-in, S1 (`AgentSignInView`): two cards with the agents' logos and whose account each
 * needs, the usual one first; the chosen card opens in place into its two steps and starts its
 * login; Claude's code signs in on paste; Codex shows its code; a dialog opens on one agent.
 */
import type { ZeropsAgentId, ZeropsAgentLoginState } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AgentSignInView, type SignInAgent } from "./ZeropsAgentSignIn";

const login = (
  agentId: ZeropsAgentId,
  phase: ZeropsAgentLoginState["phase"],
  extra: Partial<ZeropsAgentLoginState> = {},
): ZeropsAgentLoginState => ({
  phase,
  terminalId: `agent-login-${agentId}`,
  startedAt: DateTime.makeUnsafe(Date.now() + 1_000),
  ...extra,
});

let host: HTMLDivElement;
let root: Root;
let calls: {
  start: ZeropsAgentId[];
  cancel: ZeropsAgentId[];
  codes: Array<[ZeropsAgentId, string]>;
};

function draw(props: Partial<ComponentProps<typeof AgentSignInView>> = {}) {
  const agents: ReadonlyArray<SignInAgent> = props.agents ?? [
    { agentId: "claude-code", login: undefined },
    { agentId: "codex", login: undefined },
  ];
  act(() => {
    root.render(
      <AgentSignInView
        agents={agents}
        codeField
        mateName="Fen"
        onCancel={(agentId) => calls.cancel.push(agentId)}
        onStart={(agentId) => calls.start.push(agentId)}
        onSubmitCode={async (agentId, code) => {
          calls.codes.push([agentId, code]);
          return true;
        }}
        terminal={() => <pre data-terminal>claude /login</pre>}
        usual={null}
        {...props}
      />,
    );
  });
}

const cards = () =>
  [...host.querySelectorAll<HTMLButtonElement>(".arrival-card")].map((card) => ({
    agent: card.dataset.agentId,
    logo: card.querySelector("[data-agent-logo]")?.getAttribute("data-agent-logo"),
    says: card.textContent,
    usual: card.querySelector("[data-usual-agent]") !== null,
  }));

const click = (element: Element | null) => {
  act(() => {
    (element as HTMLElement).click();
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  if (typeof Element.prototype.animate !== "function") {
    Element.prototype.animate = (() => ({ cancel() {} })) as unknown as Element["animate"];
  }
  host = document.createElement("div");
  // A link pressed here opens nothing: the provider's page is not the test's.
  host.addEventListener("click", (event) => {
    if ((event.target as Element).closest("a") !== null) event.preventDefault();
  });
  document.body.append(host);
  root = createRoot(host);
  calls = { start: [], cancel: [], codes: [] };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the sign-in's cards", () => {
  it.each([
    { usual: null, order: ["claude-code", "codex"], marked: [] as string[] },
    { usual: "codex" as const, order: ["codex", "claude-code"], marked: ["codex"] },
  ])(
    "offers both agents with their logos and accounts, usual $usual first",
    ({ usual, order, marked }) => {
      const agents: ReadonlyArray<SignInAgent> = order.map((agentId) => ({
        agentId: agentId as ZeropsAgentId,
        login: undefined,
      }));
      draw({ agents, usual });
      expect(cards().map((card) => card.agent)).toEqual(order);
      expect(cards().map((card) => card.logo)).toEqual(order);
      expect(
        cards()
          .filter((card) => card.usual)
          .map((card) => card.agent),
      ).toEqual(marked);
      const says = cards().map((card) => card.says ?? "");
      expect(says.find((text) => text.startsWith("Claude Code"))).toContain(
        "With your Claude account",
      );
      expect(says.find((text) => text.startsWith("Codex"))).toContain("With your ChatGPT account");
    },
  );

  it("opens the chosen card in place, starting its login at once", () => {
    draw();
    click(host.querySelector("[data-agent-id='claude-code']"));
    expect(calls.start).toEqual(["claude-code"]);
    const open = host.querySelector("[data-agent-id][data-sign-in]");
    expect(open?.getAttribute("data-agent-id")).toBe("claude-code");
    expect(open?.textContent).toContain("Open Claude and approve Fen.");
    expect(open?.textContent).toContain("Paste the code Claude shows you.");
    expect(open?.textContent).toContain("Use Codex instead");
    // The cards left fade where they stood, out of reach.
    expect(host.querySelectorAll(".arrival-cards:not([data-leaving])")).toHaveLength(0);
    expect(host.querySelector("[data-leaving]")?.hasAttribute("inert")).toBe(true);
  });
});

describe("Claude's steps", () => {
  const ready = (): ReadonlyArray<SignInAgent> => [
    {
      agentId: "claude-code",
      login: login("claude-code", "awaiting-browser", { url: "https://claude.example/oauth" }),
    },
    { agentId: "codex", login: undefined },
  ];

  it("disconnection disables the provider link and rejects a pasted code", () => {
    draw({ agents: ready(), available: false });
    const link = host.querySelector<HTMLAnchorElement>("[data-sign-in-open]");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link?.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(host.textContent).not.toContain("Claude is open in a new tab.");
    const field = host.querySelector<HTMLInputElement>("[data-sign-in-code]");
    expect(field?.disabled).toBe(true);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "old-code" } });
    act(() => {
      field?.dispatchEvent(paste);
    });
    expect(calls.codes).toEqual([]);
  });

  it("links Open Claude to the page its login printed, and marks it opened once pressed", () => {
    draw({ agents: ready() });
    const press = host.querySelector<HTMLAnchorElement>("[data-sign-in-open]");
    expect(press?.getAttribute("href")).toBe("https://claude.example/oauth");
    expect(press?.getAttribute("target")).toBe("_blank");
    click(press);
    expect(host.textContent).toContain("Claude is open in a new tab.");
    expect(host.querySelector<HTMLAnchorElement>(".arrival-link[href]")?.textContent).toBe(
      "Open again",
    );
  });

  it("signs in on paste: the pasted code goes to the login at once, and is checked", () => {
    draw({ agents: ready() });
    const field = host.querySelector<HTMLInputElement>("[data-sign-in-code]");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "  code-4c9f2a7e1b  " },
    });
    act(() => {
      field?.dispatchEvent(paste);
    });
    expect(calls.codes).toEqual([["claude-code", "code-4c9f2a7e1b"]]);
    expect(host.querySelector("[data-sign-in-checking]")?.textContent).toContain("Checking");
  });

  it("says a failed sign-in in its own words, and Try again starts it afresh", () => {
    draw();
    click(host.querySelector("[data-agent-id='claude-code']"));
    draw({
      agents: [
        {
          agentId: "claude-code",
          login: login("claude-code", "failed", { message: "the code was not accepted" }),
        },
        { agentId: "codex", login: undefined },
      ],
    });
    expect(host.querySelector("[role='alert']")?.textContent).toBe("The code was not accepted.");
    click(host.querySelector("[data-sign-in-outcome='failed'] button"));
    expect(calls.start).toEqual(["claude-code", "claude-code"]);
  });

  it("never shows an earlier attempt's failure as this one's", () => {
    draw({
      agents: [
        {
          agentId: "claude-code",
          login: login("claude-code", "failed", {
            message: "the code was not accepted",
            startedAt: DateTime.makeUnsafe(Date.now() - 60_000),
          }),
        },
        { agentId: "codex", login: undefined },
      ],
    });
    click(host.querySelector("[data-agent-id='claude-code']"));
    expect(host.querySelector("[role='alert']")).toBeNull();
    expect(host.textContent).toContain("Open Claude and approve Fen.");
  });

  it("switches to Codex, cancelling the login under way", () => {
    draw({ agents: ready() });
    click(host.querySelector("[data-sign-in-switch]"));
    expect(calls.cancel).toEqual(["claude-code"]);
    expect(calls.start).toEqual(["codex"]);
  });

  it("shows what's happening only when asked", () => {
    draw({ agents: ready() });
    expect(host.querySelector("[data-terminal]")).toBeNull();
    click(host.querySelector("[data-sign-in-watch]"));
    expect(host.querySelector("[data-terminal]")).not.toBeNull();
    expect(host.querySelector("[data-sign-in-watch]")?.textContent).toBe("Hide what's happening");
  });
});

describe("Codex's steps", () => {
  it("shows the code to type on OpenAI's page, with no field to paste into", () => {
    draw({
      agents: [
        { agentId: "claude-code", login: undefined },
        {
          agentId: "codex",
          login: login("codex", "awaiting-browser", {
            url: "https://openai.example/device",
            code: "WXYZ-1234",
          }),
        },
      ],
    });
    expect(host.querySelector("[data-sign-in-device-code]")?.textContent).toBe("WXYZ-1234");
    expect(host.querySelector("[data-sign-in-code]")).toBeNull();
    expect(host.textContent).toContain("Fen signs in by itself once you do.");
  });
});

describe("the sign-in in a dialog", () => {
  it("opens on the agent asked for and starts its login, with no other to switch to", () => {
    draw({ agents: [{ agentId: "codex", login: undefined }], fixed: true });
    expect(calls.start).toEqual(["codex"]);
    expect(host.querySelector("[data-agent-id][data-sign-in]")?.getAttribute("data-agent-id")).toBe(
      "codex",
    );
    expect(host.querySelector("[data-sign-in-switch]")).toBeNull();
  });

  // Toby, 2026-10-02: a login started drops the one the agent holds, so a dialog opened over a
  // working sign-in signed it out before the person did anything.
  it("opens on an agent that holds a sign-in without starting a login, until the person presses", () => {
    draw({
      agents: [
        {
          agentId: "codex",
          login: undefined,
          credPresent: true,
          authorizedBy: { subject: "u-ann" },
        },
      ],
      fixed: true,
      viewerSubject: "u-bo",
      nameOf: (subject) => (subject === "u-ann" ? "Ann" : undefined),
    });
    expect(calls.start).toEqual([]);
    const open = host.querySelector("[data-agent-id][data-sign-in]");
    expect(open?.textContent).toContain("Signing in replaces Ann's sign-in.");
    click(host.querySelector("[data-sign-in-replace]"));
    expect(calls.start).toEqual(["codex"]);
  });
});

it("a disconnected Mate keeps the login inert and does not start a fixed sign-in", () => {
  draw({ available: false, fixed: true, agents: [{ agentId: "claude-code", login: undefined }] });
  expect(host.querySelector("[data-zerops-surface=agent-sign-in]")?.hasAttribute("inert")).toBe(
    true,
  );
  expect(calls.start).toEqual([]);
  draw({ available: true, fixed: true, agents: [{ agentId: "claude-code", login: undefined }] });
  expect(calls.start).toEqual(["claude-code"]);
});
