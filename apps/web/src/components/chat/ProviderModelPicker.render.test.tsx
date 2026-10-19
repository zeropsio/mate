// @vitest-environment happy-dom
/**
 * While the model menu is open, the wheel and a touch drag scroll what the
 * menu holds — the model list and, in the composer, the choices beside it —
 * and never the conversation behind it.
 */
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { getAppModelOptionsForInstance } from "../../modelSelection";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";

const CLAUDE = ProviderInstanceId.make("claudeAgent");

const provider: ServerProvider = {
  instanceId: CLAUDE,
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-29T07:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function openComposerMenu() {
  const conversation = document.body.appendChild(document.createElement("main"));
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() =>
    root!.render(
      <ProviderModelPicker
        activeInstanceId={CLAUDE}
        model="claude-opus-5-5"
        lockedProvider={null}
        instanceEntries={deriveProviderInstanceEntries([provider])}
        modelOptionsByInstance={
          new Map([[CLAUDE, [{ slug: "claude-opus-5-5", name: "Claude Opus 5.5" }]]])
        }
        composer={{
          traits: { descriptors: [], ultrathinkPromptControlled: false },
          choices: (
            <div data-composer-model-choices="true">
              <button type="button">Ultrathink</button>
            </div>
          ),
          shortcuts: "composer.effort composer.mode",
        }}
        open
        onInstanceModelChange={() => {}}
      />,
    ),
  );
  return conversation;
}

function wheelOver(target: Element): boolean {
  const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
  target.dispatchEvent(wheel);
  return wheel.defaultPrevented;
}

describe("the open model menu", () => {
  it.each([
    {
      over: "the choices beside the models",
      at: "[data-composer-model-choices] button",
      scrolls: true,
    },
    { over: "the model list", at: "[data-model-picker-content]", scrolls: true },
    { over: "the conversation behind it", at: "main", scrolls: false },
  ])("a wheel over $over scrolls there: $scrolls", async ({ at, scrolls }) => {
    await openComposerMenu();

    const target = document.querySelector(at);
    expect(target).not.toBeNull();
    expect(wheelOver(target!)).toBe(!scrolls);
  });
});

async function drawControl(agentStatus: ServerProvider, open: boolean) {
  const onOpenProviderSetup = vi.fn();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() =>
    root!.render(
      <ProviderModelPicker
        activeInstanceId={CLAUDE}
        model="claude-opus-5-5"
        lockedProvider={null}
        instanceEntries={deriveProviderInstanceEntries([provider])}
        modelOptionsByInstance={
          new Map([[CLAUDE, [{ slug: "claude-opus-5-5", name: "Claude Opus 5.5" }]]])
        }
        composer={{
          traits: { descriptors: [], ultrathinkPromptControlled: false },
          choices: null,
          shortcuts: "composer.effort composer.mode",
        }}
        agentStatus={agentStatus}
        open={open}
        onOpenProviderSetup={onOpenProviderSetup}
        onInstanceModelChange={() => {}}
      />,
    ),
  );
  return onOpenProviderSetup;
}

// S6 (the owner, 2026-10-12): what stops the agent answering is the model control's, not a strip
// over the conversation.
describe("the model control while its agent is not fully available", () => {
  it.each([
    {
      tone: "warning",
      status: {
        ...provider,
        displayName: "Claude",
        status: "warning" as const,
        message: "Claude is slow to answer right now.",
        setup: { canAuthenticate: true, canInstall: false },
      },
      named: "Claude has limited availability",
    },
    {
      tone: "error",
      status: {
        ...provider,
        displayName: "Claude",
        status: "error" as const,
        message: "Claude did not start on this environment.",
        setup: { canAuthenticate: true, canInstall: false },
      },
      named: "Claude is unavailable",
    },
  ])("carries a dot in its $tone tone, and its menu says why", async ({ tone, status, named }) => {
    await drawControl(status as ServerProvider, false);

    const control = document.querySelector("[data-chat-provider-model-picker]")!;
    const dot = control.querySelector(`[role="img"][aria-label="${named}"]`);
    expect(dot?.getAttribute("data-tone")).toBe(tone);
    expect(control.getAttribute("aria-label")).toContain(named);

    await act(() => root!.unmount());
    root = undefined;
    document.body.innerHTML = "";
    const openSetup = await drawControl(status as ServerProvider, true);
    const note = document.querySelector("[data-agent-availability]")!;
    expect(note.textContent).toContain(named);
    expect(note.textContent).toContain(status.message);
    const setup = Array.from(note.querySelectorAll("button")).find(
      (button) => button.textContent === "Open coding agent setup",
    );
    expect(setup).toBeDefined();
    await act(() => setup!.click());
    expect(openSetup).toHaveBeenCalledWith(CLAUDE);
  });

  it("carries no dot while its agent is ready", async () => {
    await drawControl(provider, true);
    expect(document.querySelector('[data-chat-provider-model-picker] [role="img"]')).toBeNull();
    expect(document.querySelector("[data-agent-availability]")).toBeNull();
  });
});

describe("a model that reads no images", () => {
  const OPENCODE = ProviderInstanceId.make("opencode");
  const opencode: ServerProvider = {
    ...provider,
    instanceId: OPENCODE,
    driver: ProviderDriverKind.make("opencode"),
    models: [
      {
        slug: "nebius/zai-org/GLM-5.3-Flash",
        name: "GLM-5.3-Flash",
        isCustom: false,
        textOnly: true,
        capabilities: null,
      },
      { slug: "nebius/moonshotai/Kimi-K3", name: "Kimi K3", isCustom: false, capabilities: null },
    ],
  };

  async function drawOpenCode(model: string) {
    const entries = deriveProviderInstanceEntries([opencode]);
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(() =>
      root!.render(
        <ProviderModelPicker
          activeInstanceId={OPENCODE}
          model={model}
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={
            new Map([
              [OPENCODE, getAppModelOptionsForInstance(DEFAULT_UNIFIED_SETTINGS, entries[0]!)],
            ])
          }
          onInstanceModelChange={() => {}}
        />,
      ),
    );
  }

  it.each([
    { model: "nebius/zai-org/GLM-5.3-Flash", textOnly: true },
    { model: "nebius/moonshotai/Kimi-K3", textOnly: false },
  ])("the model control says $model is text only: $textOnly", async ({ model, textOnly }) => {
    await drawOpenCode(model);
    const control = document.querySelector("[data-chat-provider-model-picker]")!;
    expect(control.textContent?.includes("Text only")).toBe(textOnly);
  });
});
