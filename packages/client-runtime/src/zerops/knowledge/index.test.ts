import { describe, expect, it } from "vite-plus/test";

import * as knowledge from "./index.ts";

describe("@t3tools/client-runtime/zerops/knowledge", () => {
  it("exports no cell machinery: a cell is private to its store, reached only through read (§3.6)", () => {
    expect(Object.keys(knowledge).filter((name) => /cell|advance|^read$/i.test(name))).toEqual([]);
  });

  it("exports the presentation and the retry policy", () => {
    expect(typeof knowledge.knownPresentation).toBe("function");
    expect(typeof knowledge.scheduleRetry).toBe("function");
  });
});
