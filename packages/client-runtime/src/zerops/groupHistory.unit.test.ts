import { expect, it } from "vite-plus/test";

import { releaseTagsByCommit } from "./groupHistory.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const W = "e".repeat(40);

const release = (tag: string, api: string, verdict: "approved" | "refused" = "approved") => ({
  tag,
  verdict,
  entries: [
    { service: "api", commit: api },
    { service: "web", commit: W },
  ],
});

// witness: packages/client-runtime/src/zerops/groupHistory.ts | if (back && before !== entry.commit) named.push(release.tag); → if (back) named.push(release.tag);
it("ZV+10: A commit is named by the release that first shipped it, a roll back names only the commits it brought back, and a refused release names none", () => {
  const named = releaseTagsByCommit([
    release("v0.1.3", C, "refused"),
    release("v0.1.2", A),
    release("v0.1.1", B),
    release("v0.1.0", A),
  ]);
  expect(named.get(A)).toEqual(["v0.1.0", "v0.1.2"]);
  expect(named.get(W)).toEqual(["v0.1.0"]);
  expect(named.get(B)).toEqual(["v0.1.1"]);
  expect(named.has(C)).toBe(false);
});
