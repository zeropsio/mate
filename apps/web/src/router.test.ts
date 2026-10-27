import { describe, expect, it } from "vite-plus/test";
import { parseSearch, stringifySearch } from "./router.ts";

describe("Page addresses", () => {
  it.each([
    { path: "caf\udce9.txt", kind: "file" },
    { path: "café.txt", lines: "L1-L2" },
    { q: "123", path: "a b/c.ts" },
  ])("A page's search reads back as it was written: %j", (search) => {
    expect(parseSearch(stringifySearch(search))).toEqual(search);
  });
});
