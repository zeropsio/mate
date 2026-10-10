import { describe, expect, it } from "vite-plus/test";

import { railDot, railGroups } from "./SidebarRail.logic";

describe("railDot — the small dot on a rail face", () => {
  it.each([
    {
      title: "amber when it waits on you",
      waits: true,
      failed: false,
      unread: false,
      dot: "attention",
    },
    {
      title: "waiting on you outranks a failure",
      waits: true,
      failed: true,
      unread: false,
      dot: "attention",
    },
    { title: "red when it failed", waits: false, failed: true, unread: true, dot: "failed" },
    {
      title: "blue for a result not yet seen",
      waits: false,
      failed: false,
      unread: true,
      dot: "unread",
    },
    { title: "none while all is well", waits: false, failed: false, unread: false, dot: undefined },
  ] as const)("$title", ({ waits, failed, unread, dot }) => {
    expect(railDot({ waits, failed, unread })).toBe(dot);
  });
});

describe("railGroups — the faces grouped by project, in the menu's order", () => {
  const mate = (projectId: string, groupId: string) => ({ projectId, groupId });

  it("keeps the menu's order, one group per project, a hairline's worth apart", () => {
    const groups = railGroups(
      [mate("milo", "ledger"), mate("sage", "tea"), mate("noibit", "ledger"), mate("rhea", "tea")],
      ["sage", "rhea", "noibit", "milo"],
    );
    expect(groups.map((group) => group.map((entry) => entry.projectId))).toEqual([
      ["sage", "rhea"],
      ["noibit", "milo"],
    ]);
  });

  it("puts a Mate the menu has not drawn yet with its project, or last", () => {
    const groups = railGroups(
      [mate("new", "tea"), mate("sage", "tea"), mate("fen", "mobile")],
      ["sage"],
    );
    expect(groups.map((group) => group.map((entry) => entry.projectId))).toEqual([
      ["sage", "new"],
      ["fen"],
    ]);
  });
});
