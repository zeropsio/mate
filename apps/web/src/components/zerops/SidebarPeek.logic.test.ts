import { describe, expect, it } from "vite-plus/test";

import {
  PEEK_AT_REST,
  PEEK_GRACE_MS,
  PEEK_REST_MS,
  peekShown,
  peekStep,
  type PeekInput,
  type PeekState,
} from "./SidebarPeek.logic";

const mouse = (kind: "enter" | "move", x: number, y: number): PeekInput => ({
  kind,
  pointer: "mouse",
  x,
  y,
});

/** Runs a pointer's story through the peek, a timer that comes due standing for its wait. */
function run(inputs: ReadonlyArray<PeekInput | "due">) {
  let state: PeekState = PEEK_AT_REST;
  let wait: number | null = null;
  const waits: Array<number | null | "keep"> = [];
  for (const input of inputs) {
    if (input === "due") {
      if (wait === null) continue;
      wait = null;
      const step = peekStep(state, { kind: "due", held: false });
      state = step.state;
      if (step.wait !== "keep") wait = step.wait;
      waits.push(step.wait);
      continue;
    }
    const step = peekStep(state, input);
    state = step.state;
    if (step.wait !== "keep") wait = step.wait;
    waits.push(step.wait);
  }
  return { shown: peekShown(state), state, wait, waits };
}

describe("peekStep — a pointer resting on the closed menu slides the open menu out", () => {
  it.each([
    {
      title: "a pointer resting on the rail peeks once its rest is over",
      inputs: [mouse("enter", 30, 400), "due"],
      shown: true,
    },
    {
      title: "a pointer crossing the rail to the page never peeks",
      inputs: [mouse("enter", 30, 400), mouse("move", 60, 402), { kind: "leave" }, "due"],
      shown: false,
    },
    {
      title: "a pointer still travelling along the rail has not rested yet",
      inputs: [mouse("enter", 30, 100), mouse("move", 30, 160)],
      shown: false,
    },
    {
      title: "a pointer that settles after travelling peeks",
      inputs: [mouse("enter", 30, 100), mouse("move", 30, 160), "due"],
      shown: true,
    },
    {
      title: "a touch never peeks: a tap opens the menu as before",
      inputs: [{ kind: "enter", pointer: "touch", x: 30, y: 400 }, "due"],
      shown: false,
    },
    {
      title: "the peek stays while the pointer is on it",
      inputs: [mouse("enter", 30, 400), "due", mouse("move", 300, 420), mouse("move", 200, 300)],
      shown: true,
    },
    {
      title: "leaving the peek returns to the rail once its grace is over",
      inputs: [mouse("enter", 30, 400), "due", { kind: "leave" }, "due"],
      shown: false,
    },
    {
      title: "the peek holds through its grace",
      inputs: [mouse("enter", 30, 400), "due", { kind: "leave" }],
      shown: true,
    },
    {
      title: "coming back within the grace keeps the peek",
      inputs: [mouse("enter", 30, 400), "due", { kind: "leave" }, mouse("enter", 300, 400), "due"],
      shown: true,
    },
    {
      title: "docking the menu ends the peek: the docked menu stands where it stood",
      inputs: [mouse("enter", 30, 400), "due", { kind: "dock" }],
      shown: false,
    },
    {
      title: "Escape puts the peek away",
      inputs: [mouse("enter", 30, 400), "due", { kind: "close" }],
      shown: false,
    },
    {
      title: "a pointer left on the rail as the menu closes does not peek until it comes back",
      inputs: [{ kind: "close" }, mouse("move", 30, 400), "due"],
      shown: false,
    },
  ] satisfies ReadonlyArray<{
    title: string;
    inputs: ReadonlyArray<PeekInput | "due">;
    shown: boolean;
  }>)("$title", ({ inputs, shown }) => {
    expect(run(inputs).shown).toBe(shown);
  });

  it("waits the rest before peeking and the grace before leaving", () => {
    expect(run([mouse("enter", 30, 400)]).wait).toBe(PEEK_REST_MS);
    expect(run([mouse("enter", 30, 400), "due", { kind: "leave" }]).wait).toBe(PEEK_GRACE_MS);
  });

  it("a hand's tremble does not restart the rest", () => {
    expect(run([mouse("enter", 30, 400), mouse("move", 32, 401)]).waits).toEqual([
      PEEK_REST_MS,
      "keep",
    ]);
  });

  it("a menu opened from inside the peek holds it past the grace", () => {
    const leaving = run([mouse("enter", 30, 400), "due", { kind: "leave" }]).state;
    const held = peekStep(leaving, { kind: "due", held: true });
    expect(peekShown(held.state)).toBe(true);
    expect(held.wait).toBe(PEEK_GRACE_MS);
  });
});
