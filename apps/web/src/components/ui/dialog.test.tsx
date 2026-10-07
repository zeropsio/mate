// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CommandDialog, CommandDialogPopup } from "./command";

import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "./dialog";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function Owner({ revision, family }: { revision: number; family: string }) {
  const [open, setOpen] = useState(false);
  if (family === "command")
    return (
      <CommandDialog open={open} onOpenChange={setOpen}>
        <DialogTrigger>Open</DialogTrigger>
        <CommandDialogPopup>
          <DialogTitle>Details {revision}</DialogTitle>
        </CommandDialogPopup>
      </CommandDialog>
    );
  if (family === "fixture")
    return (
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogPopup>
          <DialogTitle>Details {revision}</DialogTitle>
        </DialogPopup>
      </Dialog>
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>Open</DialogTrigger>
      <DialogPopup>
        <DialogTitle>Details {revision}</DialogTitle>
      </DialogPopup>
    </Dialog>
  );
}

async function click(selector: string) {
  const target = document.querySelector<HTMLElement>(selector);
  expect(target).not.toBeNull();
  await act(() => target!.click());
}

describe.each(["controlled", "fixture", "command"])("%s dialog dismissal", (family) => {
  it.each(["X", "Escape", "outside"])(
    "closes with %s and stays closed through a render",
    async (method) => {
      await act(() => root.render(<Owner revision={1} family={family} />));
      if (family !== "fixture") await click('[data-slot="dialog-trigger"]');
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      if (method === "X") await click('button[aria-label="Close"]');
      else if (method === "Escape") {
        await act(() =>
          document
            .querySelector('[role="dialog"]')!
            .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
        );
      } else {
        await act(() => {
          const outside = document.querySelector(
            '[data-slot="dialog-viewport"], [data-slot="command-dialog-backdrop"]',
          )!;
          outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
          outside.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
          outside.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
        });
      }
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(() => root.render(<Owner revision={2} family={family} />));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await click('[data-slot="dialog-trigger"]');
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Details 2");
    },
  );
});
