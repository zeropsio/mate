import { describe, expect, it } from "vite-plus/test";

import { projectRoom } from "./SidebarProjects.logic";

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
