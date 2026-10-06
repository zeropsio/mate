import { describe, expect, it } from "vite-plus/test";

import { shareEqual } from "./structuralSharing.ts";

describe("shareEqual", () => {
  const previous = {
    id: "t1",
    count: 3,
    flag: false,
    none: null,
    turn: { id: "turn-1", at: "2026-10-06T00:00:00.000Z" },
    list: [{ a: 1 }, { a: 2 }],
    record: { x: "1", y: "2" },
  };

  it("keeps the previous value when every field is equal", () => {
    const next = structuredClone(previous);
    expect(shareEqual(previous, next)).toBe(previous);
  });

  it.each([
    ["a primitive", { count: 4 }],
    ["null to a value", { none: "set" }],
    ["a nested field", { turn: { id: "turn-1", at: "2026-10-06T00:00:01.000Z" } }],
    ["an array element", { list: [{ a: 1 }, { a: 3 }] }],
    ["an array length", { list: [{ a: 1 }] }],
    ["a record key", { record: { x: "1", z: "2" } }],
    ["an added key", { extra: true }],
  ])("returns a new value when %s changes, reusing the equal parts", (_, change) => {
    const next = { ...structuredClone(previous), ...change };
    const shared = shareEqual(previous, next as typeof previous);
    expect(shared).not.toBe(previous);
    expect(shared).toEqual(next);
    for (const key of Object.keys(next) as Array<keyof typeof previous>) {
      if (JSON.stringify(previous[key]) === JSON.stringify(next[key])) {
        expect(shared[key]).toBe(previous[key]);
      }
    }
  });

  it("drops a removed key", () => {
    const { flag: _flag, ...rest } = structuredClone(previous);
    const shared = shareEqual(previous, rest as typeof previous);
    expect(shared).not.toBe(previous);
    expect("flag" in shared).toBe(false);
    expect(shared.turn).toBe(previous.turn);
  });

  it("reuses equal array elements in a changed array", () => {
    const next = [...structuredClone(previous.list), { a: 9 }];
    const shared = shareEqual(previous.list, next);
    expect(shared).toEqual(next);
    expect(shared[0]).toBe(previous.list[0]);
    expect(shared[1]).toBe(previous.list[1]);
  });

  it("tells an absent key from one set to undefined", () => {
    const previousValue: Record<string, unknown> = { a: 1 };
    const shared = shareEqual(previousValue, { a: 1, b: undefined });
    expect(shared).not.toBe(previousValue);
    expect("b" in shared).toBe(true);
  });

  it("never walks into a non-plain object", () => {
    const date = new Date(0);
    const next = { at: new Date(0) };
    const shared = shareEqual({ at: date }, next);
    expect(shared.at).toBe(next.at);
  });
});
