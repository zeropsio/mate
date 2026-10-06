import * as Equal from "effect/Equal";
import { describe, expect, it } from "vite-plus/test";

import { sameValue } from "./sameValue";

describe("sameValue", () => {
  const shared = { id: "e1", detail: "x".repeat(2000) };
  const symbol = Symbol("collapse");
  it.each([
    { name: "the same object", a: shared, b: shared },
    { name: "equal records", a: { a: 1, b: [1, "2"] }, b: { a: 1, b: [1, "2"] } },
    {
      name: "a shared entry inside",
      a: { step: { entries: [shared] } },
      b: { step: { entries: [shared] } },
    },
    { name: "a different value", a: { a: 1 }, b: { a: 2 } },
    { name: "a key only one has", a: { a: 1, b: undefined }, b: { a: 1 } },
    { name: "keys in another order", a: { a: 1, b: 2 }, b: { b: 2, a: 1 } },
    { name: "arrays of another length", a: [1, 2], b: [1, 2, 3] },
    { name: "an array and a record", a: [1], b: { 0: 1 } },
    { name: "null and a record", a: null, b: {} },
    { name: "NaN", a: { n: Number.NaN }, b: { n: Number.NaN } },
    { name: "a symbol key", a: { [symbol]: "k" }, b: { [symbol]: "k" } },
    { name: "a symbol key's value", a: { [symbol]: "k" }, b: { [symbol]: "j" } },
    { name: "equal sets", a: { s: new Set(["a"]) }, b: { s: new Set(["a"]) } },
    { name: "different maps", a: { m: new Map([["a", 1]]) }, b: { m: new Map([["a", 2]]) } },
    { name: "equal dates", a: [new Date(5)], b: [new Date(5)] },
    { name: "functions", a: { f: () => 1 }, b: { f: () => 1 } },
  ])("says what Equal.equals says: $name", ({ a, b }) => {
    expect(sameValue(a, b)).toBe(Equal.equals(a, b));
  });
});
