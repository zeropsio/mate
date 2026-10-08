// @vitest-environment happy-dom
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";

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

function provider(driver: string) {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-08T10:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  } satisfies ServerProvider;
}

describe("model picker keyboard navigation", () => {
  it.each([
    { name: "Left from empty model search", key: "ArrowLeft", shiftKey: false },
    { name: "Shift+Tab from model search", key: "Tab", shiftKey: true },
  ])("$name reaches the selected provider", async ({ key, shiftKey }) => {
    const claude = ProviderInstanceId.make("claudeAgent");
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(() =>
      root?.render(
        <ProviderModelPicker
          activeInstanceId={claude}
          model="reported-model"
          lockedProvider={null}
          instanceEntries={deriveProviderInstanceEntries([
            provider("claudeAgent"),
            provider("codex"),
          ])}
          modelOptionsByInstance={
            new Map([[claude, [{ slug: "reported-model", name: "Reported model" }]]])
          }
          open
          onInstanceModelChange={() => {}}
        />,
      ),
    );
    const search = document.querySelector<HTMLInputElement>("[data-model-picker-content] input");
    if (!search) throw new Error("The open model menu must offer model search");
    const selected = document.querySelector<HTMLButtonElement>(
      '[data-model-picker-sidebar] button[aria-pressed="true"]',
    );
    if (!selected) throw new Error("The provider list must expose its selected provider");
    search.focus();
    expect(document.activeElement).toBe(search);
    await act(() =>
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
      ),
    );
    expect(document.activeElement).toBe(selected);
  });
});
