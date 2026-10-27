// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { requestConfirmDialog, resetConfirmDialogForTests } from "../confirmDialog";
import { ConfirmDialogHost } from "./ConfirmDialogHost";

let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetConfirmDialogForTests();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root.render(<ConfirmDialogHost />));
});
afterEach(async () => {
  await act(() => root.unmount());
  resetConfirmDialogForTests();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the request-owned confirmation, including Mate updates", () => {
  it.each(["X", "Escape", "Cancel"])(
    "answers no on %s and waits for a new request before reopening",
    async (method) => {
      let answer: Promise<boolean> | undefined;
      await act(() => {
        answer = requestConfirmDialog("Update this Mate?");
      });
      expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
      await act(() => {
        if (method === "Escape")
          document
            .querySelector('[role="alertdialog"]')!
            .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        else if (method === "X")
          document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
        else document.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-close"]')!.click();
      });
      await expect(answer).resolves.toBe(false);
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      await act(() => root.render(<ConfirmDialogHost />));
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      await act(() => {
        requestConfirmDialog("Update this Mate?");
      });
      expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    },
  );

  it("keeps a destructive confirmation open on outside click", async () => {
    await act(() => {
      requestConfirmDialog("Delete this Mate?", { variant: "destructive" });
    });
    await act(() => {
      const outside = document.querySelector('[data-slot="alert-dialog-viewport"]')!;
      for (const type of ["mousedown", "mouseup", "click"])
        outside.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });
});
