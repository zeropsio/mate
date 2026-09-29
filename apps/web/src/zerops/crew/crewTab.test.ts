import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { selectActiveRightPanel, useRightPanelStore } from "~/rightPanelStore";

import { openCrewTab, useCrewSetupSheet, useCrewSetupSheetStore } from "./crewTab";

const FEN = scopeThreadRef(EnvironmentId.make("env-fen"), ThreadId.make("thread-fen"));
const JUNO = scopeThreadRef(EnvironmentId.make("env-juno"), ThreadId.make("thread-juno"));

const sheetOpen = (ref: typeof FEN) =>
  useCrewSetupSheetStore.getState().open.has(ref.environmentId);

beforeEach(() => {
  useRightPanelStore.setState({ byThreadKey: {} });
  useCrewSetupSheetStore.setState({ open: new Set() });
});

describe("openCrewTab — a Mate's menu opening its conversation on the Crew tab", () => {
  it.each([
    { case: "Crew opens the tab alone", setUp: false, sheet: false },
    { case: "Set up a crew opens the tab and its setup sheet", setUp: true, sheet: true },
  ])("$case", ({ setUp, sheet }) => {
    openCrewTab(FEN, { setUp });
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, FEN)).toBe("crew");
    expect(sheetOpen(FEN)).toBe(sheet);
  });

  it("asks for one Mate's sheet only: another Mate's tab opens without it", () => {
    openCrewTab(FEN, { setUp: true });
    openCrewTab(JUNO, { setUp: false });
    expect(sheetOpen(FEN)).toBe(true);
    expect(sheetOpen(JUNO)).toBe(false);
  });

  it("puts the sheet away when it closes, so it does not open again by itself", () => {
    openCrewTab(FEN, { setUp: true });
    useCrewSetupSheetStore.getState().setOpen(FEN.environmentId, false);
    expect(sheetOpen(FEN)).toBe(false);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, FEN)).toBe("crew");
  });
});

describe("useCrewSetupSheet — one Mate's sheet, as the Crew tab reads it", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows the ask while the tab is drawn, and closes it for that Mate alone", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let close: ((open: boolean) => void) | undefined;
    function Tab() {
      const [open, setOpen] = useCrewSetupSheet(FEN.environmentId);
      close = setOpen;
      return h("span", null, String(open));
    }
    let tab: ReturnType<typeof create> | undefined;
    act(() => {
      tab = create(h(Tab));
    });
    const said = () => tab!.root.findByType("span").children.join("");
    expect(said()).toBe("false");
    act(() => {
      openCrewTab(FEN, { setUp: true });
      openCrewTab(JUNO, { setUp: true });
    });
    expect(said()).toBe("true");
    act(() => {
      close?.(false);
    });
    expect(said()).toBe("false");
    expect(sheetOpen(JUNO)).toBe(true);
    act(() => {
      tab!.unmount();
    });
  });
});
