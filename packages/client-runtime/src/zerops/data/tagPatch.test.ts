import { describe, expect, it } from "vite-plus/test";

import { applyProjectTagPatch, sameProjectTags, type ProjectTagPatch } from "./tagPatch.ts";

describe("applyProjectTagPatch", () => {
  it.each<{
    readonly name: string;
    readonly tags: ReadonlyArray<string>;
    readonly patch: ProjectTagPatch;
    readonly adds: ReadonlyArray<string>;
    readonly removes: ReadonlyArray<string>;
  }>([
    {
      name: "a Mate declared carries the marker, and keeps its project's own tags",
      tags: ["person:own"],
      patch: { kind: "mate" },
      adds: ["mate", "person:own"],
      removes: [],
    },
    {
      name: "a Mate declared again drops only the obsolete metadata tags",
      tags: ["mate", "person:own", "mate:face:rose:seal"],
      patch: { kind: "mate" },
      adds: ["mate", "person:own"],
      removes: ["mate:face:rose:seal"],
    },
  ])("$name, and changes nothing applied again", ({ tags, patch, adds, removes }) => {
    const once = applyProjectTagPatch(tags, patch);

    expect(once).toEqual(expect.arrayContaining([...adds]));
    for (const tag of removes) expect(once).not.toContain(tag);
    expect(sameProjectTags(applyProjectTagPatch(once, patch), once)).toBe(true);
  });
});
