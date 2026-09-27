import { afterEach, describe, expect, it } from "vite-plus/test";

import { nextWaitingMate, useSidebarPeek } from "./sidebarPeek";

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

  it("pins a peek on the change it was asked for, and keeps it while pinned", () => {
    const { open, pin } = useSidebarPeek.getState();
    open("kai", "pinned", "appdev#41");
    expect(useSidebarPeek.getState().peek).toEqual({
      projectId: "kai",
      mode: "pinned",
      change: "appdev#41",
    });
    pin();
    expect(useSidebarPeek.getState().peek?.change).toBe("appdev#41");
    // The same Mate asked for without a change shows its own first again.
    open("kai", "pinned");
    expect(useSidebarPeek.getState().peek).toEqual({ projectId: "kai", mode: "pinned" });
  });

  it("pins a hover peek once somebody works in it", () => {
    const { open, pin } = useSidebarPeek.getState();
    open("nova", "hover");
    pin();
    expect(useSidebarPeek.getState().peek?.mode).toBe("pinned");
  });

  it("asks the tree to show a Mate, each ask its own, even for the same Mate twice", () => {
    const { reveal } = useSidebarPeek.getState();
    reveal({ kind: "mate", projectId: "nova" });
    const first = useSidebarPeek.getState().revealing;
    reveal({ kind: "mate", projectId: "nova" });
    const second = useSidebarPeek.getState().revealing;
    expect(first?.target).toEqual({ kind: "mate", projectId: "nova" });
    expect(second?.target).toEqual({ kind: "mate", projectId: "nova" });
    expect(second?.seq).not.toBe(first?.seq);
  });

  it.each([
    { case: "a project", target: { kind: "project", groupId: "shop" } },
    { case: "a stop", target: { kind: "stop", groupId: "shop", projectId: "shop-prod" } },
    {
      case: "a change under its Mate",
      target: { kind: "change", groupId: "shop", key: "appdev#41", mateProjectId: "shop-kai" },
    },
  ] as const)("asks the tree to show $case", ({ target }) => {
    useSidebarPeek.getState().reveal(target);
    expect(useSidebarPeek.getState().revealing?.target).toEqual(target);
  });

  it("forgets an ask once the tree answered it, and only that ask", () => {
    const { reveal, answerReveal } = useSidebarPeek.getState();
    reveal({ kind: "mate", projectId: "nova" });
    const first = useSidebarPeek.getState().revealing!;
    reveal({ kind: "project", groupId: "shop" });
    // A late answer to an older ask leaves the newer one standing.
    answerReveal(first.seq);
    expect(useSidebarPeek.getState().revealing?.target).toEqual({
      kind: "project",
      groupId: "shop",
    });
    answerReveal(useSidebarPeek.getState().revealing!.seq);
    expect(useSidebarPeek.getState().revealing).toBeNull();
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

describe("nextWaitingMate — the next Mate that waits on you, in the menu's order", () => {
  const order = ["nova", "kai", "dara", "juno", "zed", "mika"];
  const waiting = new Set(["kai", "juno", "mika"]);
  it.each([
    { case: "after the one in view", cursor: "kai", next: "juno" },
    { case: "after a Mate that does not wait", cursor: "dara", next: "juno" },
    { case: "round from the last", cursor: "mika", next: "kai" },
    { case: "from the top with nothing in view", cursor: null, next: "kai" },
    { case: "from the top when the one in view is gone", cursor: "gone", next: "kai" },
  ])("goes $case", ({ cursor, next }) => {
    expect(nextWaitingMate(order, waiting, cursor)).toBe(next);
  });

  it("stays on the one Mate that waits, and finds nobody where nobody waits", () => {
    expect(nextWaitingMate(order, new Set(["juno"]), "juno")).toBe("juno");
    expect(nextWaitingMate(order, new Set(), "kai")).toBeUndefined();
  });
});

describe("the menu's order and the Mate in view", () => {
  it("keeps the order the tree drew its Mates in, and where the eye is", () => {
    useSidebarPeek.getState().setMateOrder(["a", "b"]);
    useSidebarPeek.getState().setCursor("b");
    expect(useSidebarPeek.getState().mateOrder).toEqual(["a", "b"]);
    expect(useSidebarPeek.getState().cursor).toBe("b");
  });
});
