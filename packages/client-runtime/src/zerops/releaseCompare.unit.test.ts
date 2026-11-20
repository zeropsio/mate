import type { CompareResponse } from "@t3tools/shared/hqChanges";
import { expect, it } from "vite-plus/test";

import { type CompareRead, compareReadKey, movedCommits } from "./releaseCompare.ts";

const sha = (digit: string) => digit.repeat(40);

const api: CompareRead = {
  repository: "api",
  query: { base: sha("1"), head: sha("2") },
  services: ["api"],
};
const web: CompareRead = {
  repository: "web",
  query: { base: sha("3"), head: sha("4") },
  services: ["web"],
};

const answer = (base: string, head: string): CompareResponse => ({
  base,
  head,
  commits: [
    { sha: head, subject: "Ship it", authorName: "Nova", at: "2026-11-01T08:00:00Z", change: null },
  ],
  truncated: false,
  total: 1,
});

const stateOf = (answers: ReadonlyArray<readonly [CompareRead, CompareResponse]>) =>
  movedCommits({
    reads: [api, web],
    answers: new Map(answers.map(([read, response]) => [compareReadKey(read), response] as const)),
    failures: new Map(),
  }).state;

// witness: packages/client-runtime/src/zerops/releaseCompare.ts | const same = answer.base === (read.query.base ?? null) && answer.head === read.query.head; → const same = answer.head === read.query.head;
it("ZV146: A release comparison reads as still reading while any comparison is unanswered, never as nothing moving, and an answer for another commit pair is not taken", () => {
  expect(stateOf([[api, answer(sha("1"), sha("2"))]])).toBe("reading");
  expect(
    stateOf([
      [api, answer(sha("1"), sha("2"))],
      [web, answer(sha("5"), sha("4"))],
    ]),
  ).toBe("reading");
  expect(
    stateOf([
      [api, answer(sha("1"), sha("2"))],
      [web, answer(sha("3"), sha("4"))],
    ]),
  ).toBe("known");
});
