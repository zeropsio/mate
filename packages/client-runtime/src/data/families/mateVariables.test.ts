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
      name: "a flag written sensitive reads REDACTED: present, it is on",
      answer: { items: [row("ZCP_MATE_ENABLED", "REDACTED", { sensitive: true })] },
      expected: { flag: true, marker: false },
    },
    {
      name: "a row of another key is not kept",
      answer: { items: [row("DB_PASSWORD", "secret")] },
      expected: { flag: null, marker: false },
    },
    { name: "an answer it cannot read", answer: "nonsense", expected: null },
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
