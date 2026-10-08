// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import { AlertDialog, AlertDialogPopup, AlertDialogTitle } from "./alert-dialog";
import {
  Autocomplete,
  AutocompleteInput,
  AutocompletePopup,
  AutocompleteList,
  AutocompleteItem,
} from "./autocomplete";
import { Combobox, ComboboxInput, ComboboxPopup, ComboboxList, ComboboxItem } from "./combobox";
import { CommandDialog, CommandDialogPopup } from "./command";
import { Dialog, DialogPopup, DialogTitle } from "./dialog";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "./menu";
import { Popover, PopoverTrigger, PopoverPopup } from "./popover";
import { Select, SelectTrigger, SelectPopup, SelectItem } from "./select";
import { Sheet, SheetPopup, SheetTitle } from "./sheet";
import { ToastProvider, toastManager } from "./toast";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./tooltip";
import { gatedPortal, PortalGate } from "./portal-gate";

vi.mock("@tanstack/react-router", () => ({ useParams: () => ({}) }));
const WORDS = "Floating details";
const Portal = gatedPortal(({ children }: { readonly children: ReactNode }) => (
  <section aria-label={WORDS}>{children}</section>
));
const layers = [
  [
    "alert dialog",
    <AlertDialog key="AlertDialog" open>
      <AlertDialogPopup>
        <AlertDialogTitle>{WORDS}</AlertDialogTitle>
      </AlertDialogPopup>
    </AlertDialog>,
  ],
  [
    "autocomplete",
    <Autocomplete key="Autocomplete" open items={[WORDS]}>
      <AutocompleteInput aria-label="Search" />
      <AutocompletePopup>
        <AutocompleteList>
          <AutocompleteItem value={WORDS}>{WORDS}</AutocompleteItem>
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>,
  ],
  [
    "combobox",
    <Combobox key="Combobox" open items={[WORDS]}>
      <ComboboxInput aria-label="Choose" />
      <ComboboxPopup>
        <ComboboxList>
          <ComboboxItem value={WORDS}>{WORDS}</ComboboxItem>
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>,
  ],
  [
    "command",
    <CommandDialog key="CommandDialog" open>
      <CommandDialogPopup>
        <DialogTitle>{WORDS}</DialogTitle>
      </CommandDialogPopup>
    </CommandDialog>,
  ],
  [
    "dialog",
    <Dialog key="Dialog" open onOpenChange={() => {}}>
      <DialogPopup>
        <DialogTitle>{WORDS}</DialogTitle>
      </DialogPopup>
    </Dialog>,
  ],
  [
    "menu",
    <Menu key="Menu" open>
      <MenuTrigger>Actions</MenuTrigger>
      <MenuPopup>
        <MenuItem>{WORDS}</MenuItem>
      </MenuPopup>
    </Menu>,
  ],
  [
    "popover",
    <Popover key="Popover" open>
      <PopoverTrigger>Details</PopoverTrigger>
      <PopoverPopup>
        <p>{WORDS}</p>
      </PopoverPopup>
    </Popover>,
  ],
  [
    "select",
    <Select key="Select" open>
      <SelectTrigger aria-label="Choose" />
      <SelectPopup>
        <SelectItem value="details">{WORDS}</SelectItem>
      </SelectPopup>
    </Select>,
  ],
  [
    "sheet",
    <Sheet key="Sheet" open>
      <SheetPopup>
        <SheetTitle>{WORDS}</SheetTitle>
      </SheetPopup>
    </Sheet>,
  ],
  ["toast", <ToastProvider key="toast" />],
  [
    "tooltip",
    <Tooltip key="Tooltip" open>
      <TooltipTrigger>Help</TooltipTrigger>
      <TooltipPopup>{WORDS}</TooltipPopup>
    </Tooltip>,
  ],
] as const;

describe("PortalGate", () => {
  it.each(layers)(
    "%s leaves the document when the gate closes and returns when it reopens",
    async (name, layer) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const root = createRoot(document.body.appendChild(document.createElement("div")));
      let toast: string | undefined;
      try {
        await act(() => root.render(<PortalGate closed={false}>{layer}</PortalGate>));
        if (name === "toast")
          await act(() => {
            toast = toastManager.add({ title: WORDS, timeout: 0 });
          });
        expect(document.body.textContent).toContain(WORDS);
        await act(() => root.render(<PortalGate closed>{layer}</PortalGate>));
        expect(document.body.textContent).not.toContain(WORDS);
        await act(() => root.render(<PortalGate closed={false}>{layer}</PortalGate>));
        expect(document.body.textContent).toContain(WORDS);
      } finally {
        if (toast !== undefined) await act(() => toastManager.close(toast));
        await act(() => root.unmount());
        document.body.innerHTML = "";
        vi.unstubAllGlobals();
      }
    },
  );
  it("an ungated portal renders its content", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    try {
      await act(() => root.render(<Portal>{WORDS}</Portal>));
      expect(document.querySelector('section[aria-label="Floating details"]')?.textContent).toBe(
        WORDS,
      );
    } finally {
      await act(() => root.unmount());
      document.body.innerHTML = "";
      vi.unstubAllGlobals();
    }
  });
});
