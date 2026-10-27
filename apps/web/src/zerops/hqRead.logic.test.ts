import { describe, expect, it } from "vite-plus/test";
import { hqNavigationSettled, NO_ZEROPS_ACCESS_LINE, unreadFlowWords } from "./hqRead.logic";

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
    expect(unreadFlowWords({ groupsRead, groupKnown, failure, orgRole: "OWNER" })).toBe(words);
  });

  // HQ lists only the projects Zerops gives the viewer; a role below read-only sees only those it
  // grants, so a project missing from the list is not proof that it is gone.
  it.each([
    ["a member whose Zerops role covers no project of it", "NO_ACCESS", NO_ZEROPS_ACCESS_LINE],
    [
      "a member whose Zerops role reads every project",
      "READ_ONLY",
      "This project isn't here any more.",
    ],
    ["a member whose role is not read yet", undefined, null],
  ] as const)("%s", (_case, orgRole, words) => {
    expect(
      unreadFlowWords({ groupsRead: true, groupKnown: false, failure: undefined, orgRole }),
    ).toBe(words);
  });
});

describe("the active organization's HQ navigation settlement", () => {
  const base = {
    organizationId: "org-a",
    navigation: {
      orgId: "org-a",
      read: "reading",
      live: false,
      reconnecting: false,
      capped: false,
      refusal: null,
    },
  } as const;
  it.each([
    ["HQ has not answered", {}, false],
    ["HQ's catchup ended", { navigation: { ...base.navigation, read: "read", live: true } }, true],
    [
      "HQ stream failed before its catchup",
      { navigation: { ...base.navigation, reconnecting: true } },
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
      { navigation: { ...base.navigation, orgId: "org-b", read: "read", live: true } },
      false,
    ],
    ["local mode has no HQ source", { organizationId: null }, true],
  ] as const)("%s", (_case, over, settled) => {
    expect(hqNavigationSettled({ ...base, ...over })).toBe(settled);
  });
});
