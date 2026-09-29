import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { describe, expect, it } from "vite-plus/test";

import {
  crewmateMenuItems,
  pickTellItem,
  tellMenu,
  tellPayload,
  tellPicks,
} from "./CrewTellComposer.logic";

const { crewmates } = crewSnapshotFixture();
const FILES = [
  { path: "src/backend/index.ts", kind: "file" as const },
  { path: "src/backend", kind: "directory" as const },
];

describe("tellMenu: @ finds files, never crewmates, who are picked by their faces", () => {
  it.each([
    { name: "no @ under the caret", text: "Rework the API", items: null },
    { name: "a bare @", text: "Rework @", items: ["src/backend/index.ts", "src/backend"] },
    {
      name: "a crewmate's handle finds no crewmate",
      text: "Ask @back",
      items: ["src/backend/index.ts", "src/backend"],
    },
  ])("$name", ({ text, items }) => {
    const menu = tellMenu(text, text.length, FILES);
    expect(menu === null ? null : menu.items.map((item) => item.path)).toEqual(items);
  });

  it("describes a file by its name and its folder", () => {
    expect(tellMenu("Fix @inde", 9, [FILES[0]!])?.items).toEqual([
      {
        id: "path:file:src/backend/index.ts",
        type: "path",
        path: "src/backend/index.ts",
        pathKind: "file",
        label: "index.ts",
        description: "src/backend",
      },
    ]);
  });

  it("writes a picked file as its link, the caret past one space after it", () => {
    const text = "Fix @inde";
    const menu = tellMenu(text, text.length, [{ path: "src/index.ts", kind: "file" }])!;
    expect(pickTellItem(text, menu.trigger, menu.items[0]!)).toEqual({
      text: "Fix [index.ts](src/index.ts) ",
      cursor: "Fix [index.ts](src/index.ts) ".length,
    });
  });
});

describe("tellPicks: without a lead, who a message goes to, by face", () => {
  it.each([
    ["the first pick", [], "backend", ["backend"]],
    ["another, in the crew's order", ["erik"], "backend", ["backend", "erik"]],
    ["one picked again leaves", ["backend", "erik"], "backend", ["erik"]],
  ] as const)("%s", (_, picked, handle, next) => {
    expect(tellPicks(picked, handle, crewmates)).toEqual(next);
  });
});

describe("tellPayload", () => {
  it("sends the trimmed text to the lead, naming nobody", () => {
    expect(tellPayload("  Add seasons to the world  ", [])).toEqual({
      _tag: "tell",
      text: "Add seasons to the world",
      mentions: [],
    });
  });

  it("sends it to the crewmates picked by face, never by a typed @", () => {
    expect(tellPayload("Seasons, please", ["erik", "backend"])).toEqual({
      _tag: "tell",
      text: "Seasons, please",
      mentions: [{ handle: "erik" }, { handle: "backend" }],
    });
  });

  it("sends nothing empty", () => {
    expect(tellPayload("   ", ["erik"])).toBeNull();
  });
});

describe("crewmateMenuItems, as the lead's chat offers them", () => {
  it("finds crewmates by handle or name", () => {
    expect(crewmateMenuItems(crewmates, "Er").map((item) => item.handle)).toEqual(["erik"]);
  });
});
