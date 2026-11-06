import { describe, expect, it } from "vite-plus/test";
import { mateVariablesFamily } from "./mateVariables.ts";

/** The complete /user-data/search row measured 2026-10-07, with the Mate key. */
const row = (content: string, sensitive = false) => ({
  _version: 3,
  id: "u1",
  clientId: "org",
  projectId: "p1",
  serviceStackId: "zcp",
  serviceStackName: "appdev",
  key: "ZCP_MATE_ENABLED",
  content,
  type: "USER",
  editable: true,
  sensitive,
  internal: false,
  created: "2026-10-07T10:00:00Z",
  lastUpdate: "2026-10-07T11:00:00Z",
});
const decode = mateVariablesFamily.sampled!.decode;

describe("a Mate's container's variables, as one search answers them", () => {
  it.each([
    { name: "its flag on", answer: { items: [row("1")], totalHits: 1 }, expected: { flag: true } },
    {
      name: "its flag written off",
      answer: { items: [row("0")], totalHits: 1 },
      expected: { flag: false },
    },
    {
      name: "a redacted flag does not prove whether it is on",
      answer: { items: [row("REDACTED", true)], totalHits: 1 },
      expected: { flag: "unknown" },
    },
  ])("$name", ({ answer, expected }) => {
    expect(decode(answer)).toEqual(expected);
  });

  it("asks only its enable flag, leaving setup markers to HQ navigation", () => {
    expect(mateVariablesFamily.sampled!.search!({ orgId: "org", ownerId: "zcp" })).toEqual({
      search: [
        { name: "clientId", operator: "eq", value: "org" },
        { name: "serviceStackId", operator: "eq", value: "zcp" },
        { name: "key", operator: "in", value: ["ZCP_MATE_ENABLED"] },
      ],
      sort: [],
      limit: 1,
    });
  });
});
