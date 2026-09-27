import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { describe, expect, it } from "vite-plus/test";

import { pickTellItem, tellMenu, tellPayload, type TellMenuItem } from "./CrewTellComposer.logic";

const { crewmates } = crewSnapshotFixture();
const NO_FILES: ReadonlyArray<{ path: string; kind: "file" | "directory" }> = [];
const name = (item: TellMenuItem) => (item.type === "crewmate" ? item.handle : item.path);

describe("tellMenu", () => {
  it.each([
    { name: "no @ under the caret", text: "Rework the API", items: null },
    {
      name: "a bare @ offers everyone",
      text: "Rework @",
      items: ["lead", "backend", "frontend", "erik"],
    },
    { name: "a handle prefix", text: "Rework @fr", items: ["frontend"] },
    { name: "a display-name prefix", text: "Ask @Er", items: ["erik"] },
    { name: "nobody by that name", text: "Ask @zed", items: [] },
  ])("$name", ({ text, items }) => {
    const menu = tellMenu(text, text.length, crewmates, NO_FILES);
    expect(menu === null ? null : menu.items.map(name)).toEqual(items);
  });

  it("describes each crewmate by its face, handle and job", () => {
    expect(tellMenu("@back", 5, crewmates, NO_FILES)?.items).toEqual([
      {
        id: "crewmate:backend",
        type: "crewmate",
        handle: "backend",
        tint: "sky",
        label: "@backend",
        description: "Owns the API under src/api and its tests.",
      },
    ]);
  });
});

describe("files after crewmates (PRD §5.3)", () => {
  it("offers the matching crewmates first, then the files the search found", () => {
    const files = [
      { path: "src/backend/index.ts", kind: "file" as const },
      { path: "src/backend", kind: "directory" as const },
    ];
    const menu = tellMenu("Fix @back", "Fix @back".length, crewmates, files);
    expect(menu?.items.map(name)).toEqual(["backend", "src/backend/index.ts", "src/backend"]);
    expect(menu?.items[1]).toEqual({
      id: "path:file:src/backend/index.ts",
      type: "path",
      path: "src/backend/index.ts",
      pathKind: "file",
      label: "index.ts",
      description: "src/backend",
    });
  });

  it("writes a picked file as its link", () => {
    const text = "Fix @inde";
    const menu = tellMenu(text, text.length, crewmates, [{ path: "src/index.ts", kind: "file" }])!;
    const file = menu.items.find((item) => item.type === "path")!;
    expect(pickTellItem(text, menu.trigger, file)).toEqual({
      text: "Fix [index.ts](src/index.ts) ",
      cursor: "Fix [index.ts](src/index.ts) ".length,
    });
  });
});

describe("pickTellItem", () => {
  it("replaces the typed mention with the handle, the caret past one space after it", () => {
    const table = [
      { text: "Rework @ba to X", at: "Rework @ba".length, next: "Rework @backend to X" },
      { text: "Rework @ba", at: "Rework @ba".length, next: "Rework @backend " },
    ];
    for (const row of table) {
      const menu = tellMenu(row.text, row.at, crewmates, NO_FILES)!;
      const backend = menu.items.find((item) => name(item) === "backend")!;
      expect(pickTellItem(row.text, menu.trigger, backend)).toEqual({
        text: row.next,
        cursor: "Rework @backend ".length,
      });
    }
  });
});

describe("tellPayload", () => {
  it("sends the trimmed text with the crewmates it names, in order", () => {
    expect(tellPayload("  @erik, then @backend  ", crewmates)).toEqual({
      _tag: "tell",
      text: "@erik, then @backend",
      mentions: [{ handle: "erik" }, { handle: "backend" }],
    });
  });

  it("sends nothing empty", () => {
    expect(tellPayload("   ", crewmates)).toBeNull();
  });
});
