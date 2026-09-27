import { afterEach, describe, expect, it } from "vite-plus/test";

import { useSidebarPeek } from "./sidebarPeek";

afterEach(() => {
  useSidebarPeek.getState().close();
  useSidebarPeek.getState().askForMenu(null);
});

describe("useSidebarPeek — the one Mate peeked at", () => {
  it("opens a Mate's peek on hover, and a pinned one stays when the pointer leaves", () => {
    const { open, leave } = useSidebarPeek.getState();
    open("nova", "hover");
    expect(useSidebarPeek.getState().peek).toEqual({ projectId: "nova", mode: "hover" });
    leave("nova");
    expect(useSidebarPeek.getState().peek).toBeNull();

    open("nova", "pinned");
    leave("nova");
    expect(useSidebarPeek.getState().peek).toEqual({ projectId: "nova", mode: "pinned" });
  });

  it("never lets a hover take over a pinned peek, or a stray leave close another Mate's", () => {
    const { open, leave } = useSidebarPeek.getState();
    open("nova", "pinned");
    open("kai", "hover");
    expect(useSidebarPeek.getState().peek?.projectId).toBe("nova");
    open("kai", "hover");
    open("kai", "pinned");
    expect(useSidebarPeek.getState().peek).toEqual({ projectId: "kai", mode: "pinned" });
    leave("nova");
    expect(useSidebarPeek.getState().peek?.projectId).toBe("kai");
  });

  it("pins a hover peek once somebody works in it", () => {
    const { open, pin } = useSidebarPeek.getState();
    open("nova", "hover");
    pin();
    expect(useSidebarPeek.getState().peek?.mode).toBe("pinned");
  });

  it("asks the tree to show a Mate, each ask its own, even for the same Mate twice", () => {
    const { reveal } = useSidebarPeek.getState();
    reveal("nova");
    const first = useSidebarPeek.getState().revealing;
    reveal("nova");
    const second = useSidebarPeek.getState().revealing;
    expect(first?.projectId).toBe("nova");
    expect(second?.projectId).toBe("nova");
    expect(second?.seq).not.toBe(first?.seq);
  });
});

describe("a Mate's menu, asked for from its peek", () => {
  it("names the Mate whose menu should open, and forgets it once answered", () => {
    useSidebarPeek.getState().askForMenu("nova");
    expect(useSidebarPeek.getState().menuFor).toBe("nova");
    useSidebarPeek.getState().askForMenu(null);
    expect(useSidebarPeek.getState().menuFor).toBeNull();
  });
});
