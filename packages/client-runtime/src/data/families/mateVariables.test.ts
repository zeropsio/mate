import { describe, expect, it } from "vite-plus/test";

import { mateVariablesFamily } from "./mateVariables.ts";

const decode = mateVariablesFamily.sampled!.decode;
const row = (key: string, content: unknown, extra: object = {}) => ({
  id: `${key}-id`,
  serviceStackId: "zcp",
  key,
  content,
  ...extra,
});

describe("a Mate's container's variables, as one search answers them", () => {
  it.each<{ readonly name: string; readonly answer: unknown; readonly expected: unknown }>([
    {
      name: "no rows: no flag, no marker",
      answer: { items: [] },
      expected: { flag: null, marker: false },
    },
    {
      name: "its flag on and the press's marker present",
      answer: { items: [row("ZCP_MATE_ENABLED", "1"), row("MATE_SETUP_RUNTIMES", "aW1wb3J0")] },
      expected: { flag: true, marker: true },
    },
    {
      name: "its flag written off",
      answer: { items: [row("ZCP_MATE_ENABLED", "0")] },
      expected: { flag: false, marker: false },
    },
    {
      name: "a redacted flag does not prove whether it is on",
      answer: { items: [row("ZCP_MATE_ENABLED", "REDACTED", { sensitive: true })] },
      expected: { flag: "unknown", marker: false },
    },
    {
      name: "a visible off value stays off even when the variable is sensitive",
      answer: { items: [row("ZCP_MATE_ENABLED", "0", { sensitive: true })] },
      expected: { flag: false, marker: false },
    },
    {
      name: "a sensitive flag with no disclosed content is unknown",
      answer: { items: [{ key: "ZCP_MATE_ENABLED", sensitive: true }] },
      expected: { flag: "unknown", marker: false },
    },
    {
      name: "a row of another key is not kept",
      answer: { items: [row("DB_PASSWORD", "secret")] },
      expected: { flag: null, marker: false },
    },
    { name: "an answer it cannot read", answer: "nonsense", expected: null },
    { name: "a missing list proves no absence", answer: {}, expected: null },
    {
      name: "a damaged flag proves neither off nor absent",
      answer: { items: [row("ZCP_MATE_ENABLED", 1)] },
      expected: null,
    },
    {
      name: "a flag without its content proves neither off nor absent",
      answer: { items: [{ key: "ZCP_MATE_ENABLED" }] },
      expected: null,
    },
    {
      name: "a damaged marker does not disappear beside a valid flag",
      answer: { items: [row("ZCP_MATE_ENABLED", "1"), row("MATE_SETUP_RUNTIMES", 123)] },
      expected: null,
    },
    {
      name: "two rows of the same key have no arrival-order winner",
      answer: { items: [row("ZCP_MATE_ENABLED", "0"), row("ZCP_MATE_ENABLED", "1")] },
      expected: null,
    },
    {
      name: "a truncated list proves no absence",
      answer: { items: [row("ZCP_MATE_ENABLED", "1")], totalHits: 2 },
      expected: null,
    },
  ])("$name", ({ answer, expected }) => {
    expect(decode(answer)).toEqual(expected);
  });

  it("asks only its two keys, of its one service", () => {
    expect(mateVariablesFamily.sampled!.search!({ orgId: "org", ownerId: "zcp" })).toEqual({
      search: [
        { name: "clientId", operator: "eq", value: "org" },
        { name: "serviceStackId", operator: "eq", value: "zcp" },
        { name: "key", operator: "in", value: ["ZCP_MATE_ENABLED", "MATE_SETUP_RUNTIMES"] },
      ],
      sort: [],
      limit: 2,
    });
  });
});
