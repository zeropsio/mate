import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { describe, expect, it } from "vite-plus/test";

import { pickCrewmate, tellMenu, tellPayload } from "./CrewTellComposer.logic";

const { crewmates } = crewSnapshotFixture();

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
    const menu = tellMenu(text, text.length, crewmates);
    expect(menu === null ? null : menu.items.map((item) => item.handle)).toEqual(items);
  });

  it("describes each crewmate by its face, handle and job", () => {
    expect(tellMenu("@back", 5, crewmates)?.items).toEqual([
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

describe("pickCrewmate", () => {
  it("replaces the typed mention with the handle, the caret past one space after it", () => {
    const table = [
      { text: "Rework @ba to X", at: "Rework @ba".length, next: "Rework @backend to X" },
      { text: "Rework @ba", at: "Rework @ba".length, next: "Rework @backend " },
    ];
    for (const row of table) {
      const menu = tellMenu(row.text, row.at, crewmates)!;
      expect(pickCrewmate(row.text, menu.trigger, "backend")).toEqual({
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
