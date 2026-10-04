import { describe, expect, it } from "vite-plus/test";
import { hqMatesSettled, unreadFlowWords } from "./hqRead.logic";

describe("an unread HQ project's words", () => {
  it.each([
    ["still reading", false, false, undefined, null],
    [
      "HQ's current structure lacks it",
      true,
      false,
      undefined,
      "This project isn't here any more.",
    ],
    ["HQ does not answer", false, true, "HQ isn't answering.", "HQ isn't answering."],
    ["its flow has not landed", true, true, undefined, null],
  ] as const)("%s", (_case, groupsRead, groupKnown, failure, words) => {
    expect(unreadFlowWords({ groupsRead, groupKnown, failure })).toBe(words);
  });
});

describe("the active organization's HQ Mate list settlement", () => {
  const base = {
    organizationId: "org-a",
    accountHq: { status: "ready", hq: { kind: "official" } },
    mates: null,
    structure: null,
  } as const;
  it.each([
    ["HQ has not answered", {}, false],
    [
      "member list still loading",
      { accountHq: { status: "loading", hq: { kind: "none" } } },
      false,
    ],
    ["member list not started", { accountHq: { status: "idle", hq: { kind: "none" } } }, false],
    ["definitely no HQ", { accountHq: { status: "ready", hq: { kind: "none" } } }, true],
    ["member read failed", { accountHq: { status: "failed", hq: { kind: "none" } } }, true],
    ["HQ snapshot lists no Mates", { mates: { organizationId: "org-a", current: true } }, true],
    [
      "remembered list while HQ reads",
      { mates: { organizationId: "org-a", current: false } },
      false,
    ],
    [
      "HQ stream failed before its snapshot",
      { structure: { organizationId: "org-a", unavailableSince: 1 } },
      true,
    ],
    [
      "HQ stream still opening",
      { structure: { organizationId: "org-a", unavailableSince: null } },
      false,
    ],
    ["another org's snapshot", { mates: { organizationId: "org-b", current: true } }, false],
    [
      "another org's failure",
      { structure: { organizationId: "org-b", unavailableSince: 1 } },
      false,
    ],
    ["local mode has no HQ source", { organizationId: null }, true],
  ] as const)("%s", (_case, over, settled) => {
    expect(hqMatesSettled({ ...base, ...over })).toBe(settled);
  });
});
