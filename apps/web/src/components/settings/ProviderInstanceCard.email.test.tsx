// @vitest-environment happy-dom
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
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

describe("provider account identity", () => {
  it.each(["codex", "claudeAgent"])(
    "%s account email stays hidden until revealed and can be hidden again",
    async (kind) => {
      const driver = ProviderDriverKind.make(kind);
      const instanceId = ProviderInstanceId.make(kind);
      const liveProvider: ServerProvider = {
        instanceId,
        driver,
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated", email: "account@example.com" },
        checkedAt: "2026-10-08T10:00:00.000Z",
        models: [],
        slashCommands: [],
        skills: [],
      };
      const container = document.body.appendChild(document.createElement("div"));
      root = createRoot(container);
      await act(() =>
        root?.render(
          <ProviderInstanceCard
            instanceId={instanceId}
            instance={{ driver }}
            driverOption={undefined}
            liveProvider={liveProvider}
            mode="editor"
            onUpdate={() => {}}
            hiddenModels={[]}
            favoriteModels={[]}
            modelOrder={[]}
            onHiddenModelsChange={() => {}}
            onFavoriteModelsChange={() => {}}
            onModelOrderChange={() => {}}
          />,
        ),
      );
      const reveal = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Toggle account email visibility"]',
      );
      if (!reveal) throw new Error("Configuration must offer account email visibility");
      expect(container.textContent).not.toContain("account@example.com");
      await act(() => reveal.click());
      expect(container.textContent).toContain("account@example.com");
      await act(() => reveal.click());
      expect(container.textContent).not.toContain("account@example.com");
    },
  );
});
