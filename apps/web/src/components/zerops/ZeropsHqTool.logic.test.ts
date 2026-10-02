import { describe, expect, it } from "vite-plus/test";

import { hqToolLine, type HqToolInput } from "./ZeropsHqTool.logic";

const OFFICIAL = { kind: "official", projectId: "hq", address: "https://hq" } as const;
const BASE: HqToolInput = {
  status: "ready",
  hq: OFFICIAL,
  standing: { kind: "healthy" },
  birth: undefined,
  mayBear: false,
  admins: [{ id: "a", user: { fullName: "Ada" } }],
};

describe("hqToolLine — what the Tools row says of the organization's HQ", () => {
  it.each<[string, Partial<HqToolInput>, ReturnType<typeof hqToolLine>]>([
    [
      "nothing while the member list is read",
      { status: "loading", hq: { kind: "none" } },
      { kind: "none" },
    ],
    ["the official HQ answering", {}, { kind: "healthy" }],
    ["the official HQ not read yet", { standing: { kind: "unknown" } }, { kind: "none" }],
    [
      "the official HQ not answering, since when",
      { standing: { kind: "unavailable", since: 1_000 } },
      { kind: "unavailable", since: 1_000 },
    ],
    [
      "an owner or admin with no HQ is offered one",
      { hq: { kind: "none" }, mayBear: true },
      { kind: "set-up" },
    ],
    [
      "anybody else with no HQ is told whom to ask",
      { hq: { kind: "none" } },
      { kind: "ask", line: "No HQ yet. Ask Ada to set it up." },
    ],
    [
      "nobody to name is said without names",
      { hq: { kind: "none" }, admins: [] },
      { kind: "ask", line: "No HQ yet. Ask an owner or admin to set it up." },
    ],
    [
      "its birth under way says which step",
      { hq: { kind: "none" }, mayBear: true, birth: { kind: "running", doing: "Deploying HQ" } },
      { kind: "setting-up", doing: "Deploying HQ" },
    ],
    [
      "its birth stopped says why, and offers to go on",
      {
        hq: { kind: "none" },
        mayBear: true,
        birth: { kind: "failed", reason: "Deploying HQ: offline.", tryAgain: true },
      },
      { kind: "failed", reason: "Deploying HQ: offline.", tryAgain: true },
    ],
    [
      "a birth that ended stands back for the HQ its anchor names",
      { birth: { kind: "running", doing: "Waiting for HQ to answer" } },
      { kind: "healthy" },
    ],
    [
      "two projects marked as HQ",
      { hq: { kind: "unclear", projectIds: ["a", "b"] } },
      {
        kind: "unclear",
        line: "More than one project is marked as this organization's HQ. An owner deletes the wrong mate-hq tokens in Zerops.",
      },
    ],
  ])("%s", (_name, over, expected) => {
    expect(hqToolLine({ ...BASE, ...over })).toEqual(expected);
  });
});
