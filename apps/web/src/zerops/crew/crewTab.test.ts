import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, createElement as h } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { selectActiveRightPanel, useRightPanelStore } from "~/rightPanelStore";

import { openCrewTab, useCrewSetupAskStore, useCrewSetupSheet } from "./crewTab";

const FEN = scopeThreadRef(EnvironmentId.make("env-fen"), ThreadId.make("thread-fen"));
const JUNO = scopeThreadRef(EnvironmentId.make("env-juno"), ThreadId.make("thread-juno"));

/** Whether the left menu's ask for this Mate's setup sheet still waits for its tab. */
const asked = (ref: typeof FEN) => useCrewSetupAskStore.getState().asked.has(ref.environmentId);

beforeEach(() => {
  useRightPanelStore.setState({ byThreadKey: {} });
  useCrewSetupAskStore.setState({ asked: new Set() });
});

describe("openCrewTab — a Mate's menu opening its conversation on the Crew tab", () => {
  it.each([
    { case: "Crew opens the tab alone", setUp: false, ask: false },
    { case: "Set up a crew opens the tab and asks it for its setup sheet", setUp: true, ask: true },
  ])("$case", ({ setUp, ask }) => {
    openCrewTab(FEN, { setUp });
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, FEN)).toBe("crew");
    expect(asked(FEN)).toBe(ask);
  });

  it("asks for one Mate's sheet only: another Mate's tab opens without it", () => {
    openCrewTab(FEN, { setUp: true });
    openCrewTab(JUNO, { setUp: false });
    expect(asked(FEN)).toBe(true);
    expect(asked(JUNO)).toBe(false);
  });

  it("drops an ask no tab took up when Crew opens the same Mate's tab", () => {
    openCrewTab(FEN, { setUp: true });
    openCrewTab(FEN, { setUp: false });
    expect(asked(FEN)).toBe(false);
  });
});

describe("useCrewSetupSheet — one Mate's setup sheet, as its Crew tab holds it", () => {
  const mounted: ReactTestRenderer[] = [];
  let setSheet: ((open: boolean) => void) | undefined;
  function Tab({ environmentId }: { readonly environmentId: EnvironmentId }) {
    const [open, setOpen] = useCrewSetupSheet(environmentId);
    setSheet = setOpen;
    return h("span", null, String(open));
  }
  const mount = (environmentId: EnvironmentId) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let tab: ReactTestRenderer | undefined;
    act(() => {
      tab = create(h(Tab, { environmentId }));
    });
    mounted.push(tab!);
    return {
      said: () => tab!.root.findByType("span").children.join(""),
      unmount: () => {
        act(() => {
          tab!.unmount();
        });
      },
    };
  };
  afterEach(() => {
    for (const tab of mounted.splice(0)) {
      act(() => {
        tab.unmount();
      });
    }
    vi.unstubAllGlobals();
  });

  it("opens and closes in the tab like its own state", () => {
    const tab = mount(FEN.environmentId);
    expect(tab.said()).toBe("false");
    act(() => {
      setSheet?.(true);
    });
    expect(tab.said()).toBe("true");
    act(() => {
      setSheet?.(false);
    });
    expect(tab.said()).toBe("false");
  });

  it("opens as the tab draws on the menu's ask, and spends the ask", () => {
    act(() => {
      openCrewTab(FEN, { setUp: true });
    });
    const tab = mount(FEN.environmentId);
    expect(tab.said()).toBe("true");
    expect(asked(FEN)).toBe(false);
  });

  it("opens in a tab already drawn, for its own Mate alone", () => {
    const tab = mount(FEN.environmentId);
    act(() => {
      openCrewTab(JUNO, { setUp: true });
    });
    expect(tab.said()).toBe("false");
    act(() => {
      openCrewTab(FEN, { setUp: true });
    });
    expect(tab.said()).toBe("true");
    expect(asked(JUNO)).toBe(true);
  });

  it("never opens again by itself once its tab went away with it open", () => {
    act(() => {
      openCrewTab(FEN, { setUp: true });
    });
    const first = mount(FEN.environmentId);
    expect(first.said()).toBe("true");
    mounted.splice(0);
    first.unmount();
    const again = mount(FEN.environmentId);
    expect(again.said()).toBe("false");
  });
});
