// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsHqUpdate } from "./ZeropsHqUpdate";

const io = vi.hoisted(() => ({ run: vi.fn(), busy: vi.fn(), following: vi.fn() }));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => ({ history: "read", processes: [] }),
}));
vi.mock("~/zerops/accountOperations", () => ({ useAccountOperations: () => ({ run: io.run }) }));
vi.mock("~/zerops/ZeropsAccountData", () => ({
  useAccountOrgId: () => "rig-org",
  useDetailDemand: () => {},
  useProjectServices: () => ({ services: [{ id: "rig-hq-service", name: "hq" }] }),
}));

const draw = (trigger: "Update available" | "Update HQ" = "Update available") => (
  <ZeropsHqUpdate
    answering="20261006T080000Z.abcdefabcdef"
    carried="20261007T080000Z.123456abcdef"
    onBusy={io.busy}
    onFollowing={io.following}
    projectId="rig-hq"
    trigger={trigger}
  />
);
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  io.run.mockReset();
  io.busy.mockReset();
  io.following.mockReset();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const visible = () => document.querySelector('[role="dialog"]:not([hidden])');

describe("following HQ's accepted update", () => {
  it.each(["X", "Escape", "outside", "Close"])(
    "dismisses with %s while the update keeps running",
    async (method) => {
      let finish!: () => void;
      io.run.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      await act(() => root.render(draw()));
      await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
      await act(() =>
        document.querySelector<HTMLButtonElement>("[data-hq-update-action]")!.click(),
      );
      expect(io.run).toHaveBeenCalledTimes(1);
      await act(() => {
        if (method === "X")
          document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
        else if (method === "Close")
          document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click();
        else if (method === "Escape")
          visible()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        else {
          const outside = document.querySelector('[data-slot="dialog-viewport"]')!;
          for (const type of ["mousedown", "mouseup", "click"])
            outside.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
        }
      });
      expect(visible()).toBeNull();
      expect(io.following).toHaveBeenLastCalledWith(true);
      await act(() => root.render(draw("Update HQ")));
      expect(visible()).toBeNull();
      await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
      expect(visible()?.textContent).toContain("Updating HQ");
      expect(document.querySelector<HTMLButtonElement>("[data-hq-update-action]")!.disabled).toBe(
        true,
      );
      expect(io.run).toHaveBeenCalledTimes(1);
      await act(() =>
        document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click(),
      );
      await act(() => finish());
      expect(visible()).toBeNull();
      expect(io.following).toHaveBeenLastCalledWith(false);
      expect(io.busy).toHaveBeenLastCalledWith(false);
    },
  );
});
