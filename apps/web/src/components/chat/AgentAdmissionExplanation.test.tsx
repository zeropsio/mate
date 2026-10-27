// @vitest-environment happy-dom
import { agentAdmission } from "@t3tools/client-runtime/data";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import type { ZeropsAgentAuthSnapshot, ZeropsAgentLoginState } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AgentAdmissionExplanation } from "./AgentAdmissionExplanation";
import { ZeropsAgentSignInDialog } from "../zerops/ZeropsAgentSignIn";

const feed = vi.hoisted(() => ({ read: undefined as Known<ZeropsAgentAuthSnapshot> | undefined }));
vi.mock("~/zerops/useZeropsFeeds", () => ({ useZeropsAgentAuth: () => feed.read }));
vi.mock("~/state/environments", () => ({ useEnvironment: () => undefined }));
vi.mock("~/zerops/useZeropsEnvironmentProject", () => ({
  useZeropsEnvironmentProject: () => undefined,
}));
vi.mock("~/zerops/useUsualAgent", () => ({
  useUsualAgent: () => ({ usual: null, settled: true }),
}));
vi.mock("~/zerops/ZeropsSessionProvider", () => ({ useZeropsSessionOptional: () => null }));
vi.mock("~/zerops/useZeropsMateOwners", () => ({ useHqPersonNames: () => () => undefined }));
vi.mock("~/zerops/useAgentLogin", () => ({ useAgentLogin: () => () => {} }));
vi.mock("~/zerops/useAgentLoginCancel", () => ({ useAgentLoginCancel: () => () => {} }));
vi.mock("~/zerops/useAgentLoginSubmitCode", () => ({ useAgentLoginSubmitCode: () => () => {} }));

const snapshot = (login?: ZeropsAgentLoginState): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      state: "not-authorized",
      providerAuth: "unauthenticated",
      ...(login === undefined ? {} : { login }),
    },
  ],
});
const setFeed = (value: ZeropsAgentAuthSnapshot) => {
  feed.read = {
    state: "known",
    value,
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  };
};
const derive = (read = feed.read) =>
  agentAdmission({
    owner: null,
    environmentId: "env-Ada",
    instanceId: "claudeAgent",
    viewerSubject: "viewer",
    read,
    providers: [],
    mateName: "Ada",
  });

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  setFeed(snapshot());
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

// The notice receives the conversation's projection. The existing sign-in module receives the
// very same feed, so a remount cannot manufacture a new occurrence or dismiss the requirement.
// The feed arrives as the conversation's input, so each render reads the record it is given.
function Admission({ read }: { readonly read: Known<ZeropsAgentAuthSnapshot> | undefined }) {
  const [opened, open] = useState(false);
  return (
    <>
      <AgentAdmissionExplanation attention={derive(read).attention} onAction={() => open(true)} />
      {opened ? (
        <ZeropsAgentSignInDialog
          environmentId={null}
          threadRef={null}
          mateName="Ada"
          agentId="claude-code"
          onClose={() => open(false)}
        />
      ) : null}
    </>
  );
}
const explanation = () => host.querySelector('[role="status"]')?.textContent ?? null;
const click = (label: string) => {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === label,
  );
  expect(button).toBeDefined();
  button!.click();
};
const close = () =>
  document
    .querySelector('[role="dialog"]')!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

describe("the admission explanation's auth input", () => {
  it("An active sign-in requirement cannot be dismissed and survives remount", async () => {
    await act(() => root.render(<Admission read={feed.read} />));
    const occurrence = host.querySelector("#agent-admission")!.getAttribute("data-agent-admission");
    expect(explanation()).toBe("Ada needs a Claude sign-in to continue.Sign in");
    expect(host.querySelector('[aria-label^="Dismiss"]')).toBeNull();
    await act(() => click("Sign in"));
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Sign Ada in");
    await act(close);
    // Remount the SAME required occurrence before changing the feed.
    await act(() => root.unmount());
    root = createRoot(host);
    await act(() => root.render(<Admission read={feed.read} />));
    expect(host.querySelector("#agent-admission")!.getAttribute("data-agent-admission")).toBe(
      occurrence,
    );
    expect(explanation()).toBe("Ada needs a Claude sign-in to continue.Sign in");
    expect(derive().canSend).toBe(false);
    setFeed(
      snapshot({
        phase: "awaiting-browser",
        terminalId: "login",
        startedAt: DateTime.makeUnsafe(Date.now()),
        startedBy: "viewer",
        url: "https://claude.ai/fixture-authorization",
      }),
    );
    await act(() => root.render(<Admission read={feed.read} />));
    expect(explanation()).toBe(
      "Ada's Claude sign-in is not finished. Continue authorization to use it.Continue authorization",
    );
    expect(derive().canSend).toBe(false);
    await act(() => click("Continue authorization"));
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Sign Ada in");
    expect(
      document
        .querySelector('a[href="https://claude.ai/fixture-authorization"]')
        ?.getAttribute("href"),
    ).toBe("https://claude.ai/fixture-authorization");
    const signedOut = snapshot();
    setFeed({
      ...signedOut,
      agents: signedOut.agents.map((agent) => ({
        ...agent,
        state: "authorized",
        credPresent: true,
        flagOAuth: true,
        providerAuth: "authenticated",
      })),
    });
    await act(close);
    await act(() => root.render(<Admission read={feed.read} />));
    expect(explanation()).toBeNull();
    expect(derive().canSend).toBe(true);
  });

  it("Decision: no new Continue authorization for a viewer who cannot complete it — offer Settings instead.", async () => {
    setFeed(
      snapshot({
        phase: "awaiting-browser",
        terminalId: "login",
        startedAt: DateTime.makeUnsafe(Date.now()),
        startedBy: "colleague",
        url: "https://claude.ai/fixture-authorization",
      }),
    );
    const settings = vi.fn();
    const attention = derive().attention;
    expect(attention?.action).toBe("settings");
    await act(() =>
      root.render(<AgentAdmissionExplanation attention={attention} onAction={settings} />),
    );
    expect(explanation()).toBe(
      "Another project member started Ada's Claude sign-in. Open Settings to manage this login.Settings",
    );
    expect([...document.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Settings",
    ]);
    expect(document.querySelector('a[href="https://claude.ai/fixture-authorization"]')).toBeNull();
    await act(() => click("Settings"));
    expect(settings).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
