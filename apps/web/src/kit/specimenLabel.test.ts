import { describe, expect, it } from "vite-plus/test";

import { specimenLabel, variantsOf } from "./specimenLabel";

describe("specimenLabel", () => {
  it.each([
    [{}, "(defaults)"],
    [{ variant: "ghost", size: "sm" }, 'variant="ghost" size="sm"'],
    [{ disabled: true }, "disabled"],
    [{ open: false }, "open={false}"],
    [{ tail: 12 }, "tail={12}"],
    [{ variant: "outline", size: undefined }, 'variant="outline"'],
  ] as const)("a specimen's label spells the props it renders with: %o", (props, expected) => {
    expect(specimenLabel(props)).toBe(expected);
  });
});

describe("variantsOf", () => {
  it("lists every variant a component declares, in declaration order", () => {
    expect(variantsOf<"a" | "b" | "c">({ a: true, b: true, c: true })).toEqual(["a", "b", "c"]);
  });
});
