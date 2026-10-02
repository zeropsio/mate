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
      name: "a Mate declared carries the marker, and every tag it had",
      tags: ["person:own"],
      patch: { kind: "mate" },
      adds: ["mate"],
      removes: [],
    },
    {
      name: "a Mate declared again is left as it is",
      tags: ["mate", "person:own"],
      patch: { kind: "mate" },
      adds: ["mate"],
      removes: [],
    },
  ])("$name, and changes nothing applied again", ({ tags, patch, adds, removes }) => {
    const once = applyProjectTagPatch(tags, patch);

    expect(once).toEqual(expect.arrayContaining([...adds, "person:own"]));
    for (const tag of removes) expect(once).not.toContain(tag);
    expect(sameProjectTags(applyProjectTagPatch(once, patch), once)).toBe(true);
  });
});
