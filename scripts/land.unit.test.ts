import { expect, it } from "vite-plus/test";
import { numberLocalEntries } from "./check-sentences.ts";
import { landingArguments } from "./land.ts";

// witness: scripts/check-sentences.ts | return new Map(entries.map((entry, index) => [sentenceKey(entry), `${prefix}${start + index}`])); → return new Map(entries.map((entry, index) => [sentenceKey(entry), `${prefix}${start + index + 1}`]));
it("GA2: A landing numbers a branch's lane-local sentence from the list's next number without requiring a declared delta", () => {
  expect(() => landingArguments([])).not.toThrow();
  expect(() => landingArguments(["--unknown"])).toThrow();
  expect([
    ...numberLocalEntries([{ id: "AB+1", local: true, sentence: "A branch adds this" }], "AB", 7),
  ]).toEqual([[JSON.stringify(["AB+1", "A branch adds this"]), "AB7"]]);
});
