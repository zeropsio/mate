import { describe, expect, it } from "vite-plus/test";
import { startsFolded } from "./commit.ts";

describe("commit page", () => {
  it("A lockfile's diff starts folded", () => {
    const cases: ReadonlyArray<readonly [string, boolean]> = [
      ["yarn.lock", true],
      ["web/pnpm-lock.yaml", true],
      ["package-lock.json", true],
      ["dist/app.min.js", true],
      ["styles/site.min.css", true],
      ["src/index.ts", false],
      ["docs/yarn.lock.md", false],
      ["admin.js", false],
    ];
    for (const [path, folded] of cases) expect(startsFolded(path), path).toBe(folded);
  });
});
