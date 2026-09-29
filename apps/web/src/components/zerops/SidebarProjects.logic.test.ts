import { describe, expect, it } from "vite-plus/test";

import { headingFaces, projectRoom } from "./SidebarProjects.logic";

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
  const mate = (
    projectId: string,
    face: "idle" | "working" | "needs" | "done" | "sleep",
    over: { readonly failed?: boolean; readonly unread?: boolean } = {},
  ) => ({
    projectId,
    name: projectId,
    tint: "slate" as const,
    face,
    failed: over.failed ?? false,
    unread: over.unread ?? false,
  });

  it.each([
    { name: "nobody busy: no faces", mates: [mate("a", "idle"), mate("b", "sleep")], shown: [] },
    { name: "working: the face alone", mates: [mate("a", "working")], shown: [["a", undefined]] },
    { name: "needs you: amber", mates: [mate("a", "needs")], shown: [["a", "attention"]] },
    {
      name: "stopped on an error: red",
      mates: [mate("a", "needs", { failed: true })],
      shown: [["a", "failed"]],
    },
    {
      name: "finished, not seen: blue",
      mates: [mate("a", "done", { unread: true })],
      shown: [["a", "unread"]],
    },
    {
      name: "finished and seen: nothing",
      mates: [mate("a", "done")],
      shown: [],
    },
    {
      name: "the most urgent first, the list's order kept within each, three at most",
      mates: [
        mate("w1", "working"),
        mate("u1", "done", { unread: true }),
        mate("n1", "needs"),
        mate("f1", "needs", { failed: true }),
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
});
