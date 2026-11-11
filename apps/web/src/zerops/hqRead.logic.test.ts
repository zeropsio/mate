import { describe, expect, it } from "vite-plus/test";
import { hqNavigationSettled, NO_ACCESS, unreadFlowWords } from "./hqRead.logic";

describe("an unread HQ project's words", () => {
  it.each([
    ["still reading", false, false, undefined, null],
    ["HQ's current structure lacks it", true, false, undefined, NO_ACCESS],
    ["HQ does not answer", false, true, "HQ isn't answering.", "HQ isn't answering."],
    ["its flow has not landed", true, true, undefined, null],
  ] as const)("%s", (_case, groupsRead, groupKnown, failure, words) => {
    expect(unreadFlowWords({ groupsRead, groupKnown, failure })).toBe(words);
  });
});

describe("the active organization's HQ navigation settlement", () => {
  const base = {
    organizationId: "org-a",
    navigation: {
      orgId: "org-a",
      read: "reading",
      retrying: false,
      capped: false,
      refusal: null,
    },
  } as const;
  it.each([
    ["HQ has not answered", {}, false],
    ["HQ's catchup ended", { navigation: { ...base.navigation, read: "read" } }, true],
    [
      "HQ stream failed before its catchup",
      { navigation: { ...base.navigation, retrying: true } },
      true,
    ],
    [
      "HQ refused its stream",
      { navigation: { ...base.navigation, refusal: "Zerops refused HQ." } },
      true,
    ],
    ["HQ's retries capped", { navigation: { ...base.navigation, capped: true } }, true],
    [
      "another org's navigation",
      { navigation: { ...base.navigation, orgId: "org-b", read: "read" } },
      false,
    ],
    ["local mode has no HQ source", { organizationId: null }, true],
  ] as const)("%s", (_case, over, settled) => {
    expect(hqNavigationSettled({ ...base, ...over })).toBe(settled);
  });
});
