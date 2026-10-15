// @vitest-environment happy-dom
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ProviderInstanceCard } from "./ProviderInstanceCard";

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

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label,
  );

describe("deleting a provider instance", () => {
  it("asks before it removes the instance's saved settings, and Cancel keeps them", async () => {
    const onDelete = vi.fn();
    const driver = ProviderDriverKind.make("codex");
    const instanceId = ProviderInstanceId.make("codex-work");
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(() =>
      root?.render(
        <ProviderInstanceCard
          instanceId={instanceId}
          instance={{ driver, displayName: "Work" }}
          driverOption={undefined}
          liveProvider={undefined}
          mode="editor"
          onUpdate={() => {}}
          onDelete={onDelete}
          hiddenModels={[]}
          favoriteModels={[]}
          modelOrder={[]}
          onHiddenModelsChange={() => {}}
          onFavoriteModelsChange={() => {}}
          onModelOrderChange={() => {}}
        />,
      ),
    );

    await act(() => button("Delete provider instance codex-work")?.click());
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Delete Work?");

    await act(() => button("Cancel")?.click());
    expect(onDelete).not.toHaveBeenCalled();

    await act(() => button("Delete provider instance codex-work")?.click());
    await act(() => button("Delete instance")?.click());
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
