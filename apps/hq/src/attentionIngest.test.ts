import { expect, it } from "@effect/vitest";
import { acceptAttention } from "./attentionIngest.ts";
import { HqAttentionValue } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";
const value = Schema.decodeSync(HqAttentionValue)({
  source: { environmentId: "env", epoch: 1, incarnation: "boot", revision: 2 },
  mainThreadId: "main",
  lastThreadId: "new",
  working: 0,
  waiting: 0,
  results: [{ threadId: "main", turnId: "result", completedAt: "2026-10-06T00:00:00.000Z" }],
  questions: [],
  truncated: false,
});
it("uses the canonical Mate attention identity normalization", () => {
  expect(
    acceptAttention(null, {
      ...value,
      source: { ...value.source, environmentId: " env ", incarnation: " boot " },
      mainThreadId: " main ",
    }),
  ).toEqual(value);
});
it("keeps newer attention; a new chat moves even with unchanged counts", () => {
  expect(acceptAttention(value, { ...value, source: { ...value.source, revision: 1 } })).toEqual(
    value,
  );
  expect(
    acceptAttention(value, {
      ...value,
      source: { ...value.source, revision: 3 },
      lastThreadId: "newer",
    })?.lastThreadId,
  ).toBe("newer");
});
it("rejects malformed attention without losing the prior value", () => {
  expect(acceptAttention(value, { ...value, results: null })).toEqual(value);
});

it.each([
  { ...value, source: { ...value.source, environmentId: "", revision: 3 } },
  { ...value, source: { ...value.source, incarnation: "  ", revision: 3 } },
  {
    ...value,
    source: { ...value.source, revision: 3 },
    results: [{ ...value.results[0], turnId: "" }],
  },
])("blank attention identity keeps previous source facts", (broken) => {
  expect(acceptAttention(value, broken)).toEqual(value);
});
