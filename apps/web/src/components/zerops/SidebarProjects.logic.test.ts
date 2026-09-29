import { describe, expect, it } from "vite-plus/test";

import { headingFaces, landingAfterDraw, projectRoom } from "./SidebarProjects.logic";

describe("projectRoom", () => {
  // The room belongs to the end of an open project, never above a heading:
  // opening one unfolds its rows — and the room after them — below it, so the
  // heading that was clicked stays where it is (M9).
  it.each([
    { name: "an open project, another under it", open: true, last: false, room: 44 },
    { name: "the list's last project, open", open: true, last: true, room: 16 },
    { name: "a folded project: headings stack back to back", open: false, last: false, room: 0 },
    { name: "the list's last project, folded", open: false, last: true, room: 0 },
  ])("$name keeps $room px below its rows", ({ open, last, room }) => {
    expect(projectRoom({ open, last })).toBe(room);
  });
});

describe("headingFaces — who a folded project's heading shows (M15)", () => {
  // Each as its row draws it (`mateRowView`): the state, the face, the dot.
  const ROW = {
    idle: { face: "idle", dot: undefined },
    paused: { face: "sleep", dot: undefined },
    working: { face: "working", dot: undefined },
    needs: { face: "needs", dot: "attention" },
    unread: { face: "done", dot: "unread" },
    failed: { face: "idle", dot: "failed" },
  } as const;
  const mate = (projectId: string, state: keyof typeof ROW) => ({
    projectId,
    name: projectId,
    tint: "slate" as const,
    state,
    ...ROW[state],
    known: true,
  });

  it.each([
    { name: "nobody busy: no faces", mates: [mate("a", "idle"), mate("b", "paused")], shown: [] },
    { name: "working: the face alone", mates: [mate("a", "working")], shown: [["a", undefined]] },
    { name: "needs you: amber", mates: [mate("a", "needs")], shown: [["a", "attention"]] },
    { name: "stopped on an error: red", mates: [mate("a", "failed")], shown: [["a", "failed"]] },
    { name: "finished, not seen: blue", mates: [mate("a", "unread")], shown: [["a", "unread"]] },
    {
      name: "the most urgent first, the list's order kept within each, three at most",
      mates: [
        mate("w1", "working"),
        mate("u1", "unread"),
        mate("n1", "needs"),
        mate("f1", "failed"),
        mate("n2", "needs"),
      ],
      shown: [
        ["n1", "attention"],
        ["n2", "attention"],
        ["f1", "failed"],
      ],
    },
  ])("$name", ({ mates, shown }) => {
    expect(headingFaces(mates).map((face) => [face.projectId, face.dot])).toEqual(shown);
  });

  it("wears the row's face: still where it stopped on an error", () => {
    expect(headingFaces([mate("a", "failed")])).toEqual([
      { projectId: "a", name: "a", tint: "slate", face: "idle", dot: "failed", known: true },
    ]);
  });
});

describe("landingAfterDraw — a reveal lands on the draw after its ask, or never", () => {
  it.each([
    { name: "nothing asked", pending: null, land: undefined, next: null },
    {
      name: "the draw the ask came in waits for the one it set off",
      pending: { target: "stop:links-prod", drawn: false },
      land: undefined,
      next: { target: "stop:links-prod", drawn: true },
    },
    {
      name: "the draw after it lands the ask, and the ask is done either way",
      pending: { target: "stop:links-prod", drawn: true },
      land: "stop:links-prod",
      next: null,
    },
  ])("$name", ({ pending, land, next }) => {
    expect(landingAfterDraw(pending)).toEqual({ land, next });
  });
});
