import { describe, expect, it } from "vite-plus/test";

import { dropTarget, keyboardTarget, movedAnnouncement } from "./SidebarProjectReorder";

describe("dropTarget — where a dragged project lands", () => {
  // Three drawn projects, 100px tall, 16px apart.
  const sections = [
    { groupId: "a", top: 0, height: 100 },
    { groupId: "b", top: 116, height: 100 },
    { groupId: "c", top: 232, height: 100 },
  ];
  it.each([
    { case: "above the first's middle: first", pointerY: 10, expected: "a" },
    { case: "below the first's middle: in front of the second", pointerY: 60, expected: "b" },
    { case: "in the gap: in front of the next", pointerY: 108, expected: "b" },
    { case: "below the last's middle: last", pointerY: 300, expected: null },
    { case: "past the list: last", pointerY: 900, expected: null },
  ])("lands $case", ({ pointerY, expected }) => {
    expect(dropTarget(sections, pointerY)).toBe(expected);
  });

  it("lands last where nothing else is drawn", () => {
    expect(dropTarget([], 40)).toBeNull();
  });
});

describe("keyboardTarget — one place up or down", () => {
  it.each([
    { case: "up from the middle", id: "b", direction: "up", expected: "a" },
    { case: "down from the middle", id: "b", direction: "down", expected: null },
    { case: "down from the first", id: "a", direction: "down", expected: "c" },
    { case: "up from the first: nowhere", id: "a", direction: "up", expected: undefined },
    { case: "down from the last: nowhere", id: "c", direction: "down", expected: undefined },
    { case: "a project not drawn: nowhere", id: "x", direction: "up", expected: undefined },
  ] as const)("moves $case", ({ id, direction, expected }) => {
    expect(keyboardTarget(["a", "b", "c"], id, direction)).toBe(expected);
  });
});

describe("movedAnnouncement", () => {
  it("says where the project went, of how many", () => {
    expect(movedAnnouncement("Notes", 2, 5)).toBe("Notes moved to 2 of 5.");
  });
});
