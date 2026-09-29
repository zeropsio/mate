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
