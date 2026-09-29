import { afterEach, describe, expect, it } from "vite-plus/test";

import { nextWaitingMate, useSidebarReveal } from "./sidebarReveal";

afterEach(() => {
  useSidebarReveal.setState({ revealing: null, mateOrder: [], cursor: null });
});

describe("useSidebarReveal — a surface's ask to show something in the menu", () => {
  it("asks the tree to show a Mate, each ask its own, even for the same Mate twice", () => {
    const { reveal } = useSidebarReveal.getState();
    reveal({ kind: "mate", projectId: "nova" });
    const first = useSidebarReveal.getState().revealing;
    reveal({ kind: "mate", projectId: "nova" });
    const second = useSidebarReveal.getState().revealing;
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
    useSidebarReveal.getState().reveal(target);
    expect(useSidebarReveal.getState().revealing?.target).toEqual(target);
  });

  it("forgets an ask once the tree answered it, and only that ask", () => {
    const { reveal, answerReveal } = useSidebarReveal.getState();
    reveal({ kind: "mate", projectId: "nova" });
    const first = useSidebarReveal.getState().revealing!;
    reveal({ kind: "project", groupId: "shop" });
    // A late answer to an older ask leaves the newer one standing.
    answerReveal(first.seq);
    expect(useSidebarReveal.getState().revealing?.target).toEqual({
      kind: "project",
      groupId: "shop",
    });
    answerReveal(useSidebarReveal.getState().revealing!.seq);
    expect(useSidebarReveal.getState().revealing).toBeNull();
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
    useSidebarReveal.getState().setMateOrder(["a", "b"]);
    useSidebarReveal.getState().setCursor("b");
    expect(useSidebarReveal.getState().mateOrder).toEqual(["a", "b"]);
    expect(useSidebarReveal.getState().cursor).toBe("b");
  });

  it("keeps the same order object when the tree draws the same Mates again", () => {
    useSidebarReveal.getState().setMateOrder(["a", "b"]);
    const drawn = useSidebarReveal.getState().mateOrder;
    useSidebarReveal.getState().setMateOrder(["a", "b"]);
    expect(useSidebarReveal.getState().mateOrder).toBe(drawn);
  });
});
