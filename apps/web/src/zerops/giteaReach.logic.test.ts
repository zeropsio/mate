import { describe, expect, it } from "vite-plus/test";

import { giteaReach, giteaReachWords, unreadFlowWords } from "./giteaReach.logic";

const state = (over: {
  readonly phase?: "running" | "provisioning" | "unavailable";
  readonly url?: string | undefined;
  readonly brokerUrl?: string | undefined;
  readonly brokerImported?: boolean;
}) => ({
  phase: over.phase ?? "running",
  url: "url" in over ? over.url : "https://web-gitea.example.test",
  brokerUrl: "brokerUrl" in over ? over.brokerUrl : "https://broker-gitea.example.test",
  brokerImported: over.brokerImported ?? true,
});

describe("giteaReach: whether the app can fetch its own Gitea session, and why not", () => {
  it.each([
    ["no Gitea project in the organization", { holdsGitea: false, state: undefined }, "none"],
    [
      "a Gitea project whose services are not read yet",
      { holdsGitea: true, state: undefined },
      "unknown",
    ],
    ["being set up", { holdsGitea: true, state: state({ phase: "provisioning" }) }, "setting-up"],
    ["being removed", { holdsGitea: true, state: state({ phase: "unavailable" }) }, "unavailable"],
    [
      "its web has no public address",
      { holdsGitea: true, state: state({ url: undefined }) },
      "no-address",
    ],
    [
      "no broker service",
      { holdsGitea: true, state: state({ brokerUrl: undefined, brokerImported: false }) },
      "no-broker",
    ],
    [
      "a broker with no public address",
      { holdsGitea: true, state: state({ brokerUrl: undefined }) },
      "no-broker-address",
    ],
    ["everything in place", { holdsGitea: true, state: state({}) }, "ready"],
  ] as const)("%s", (_case, input, reach) => {
    expect(giteaReach(input)).toBe(reach);
  });

  it("names a cause only where the person or their admin must act", () => {
    expect(
      (["unknown", "ready", "none", "setting-up"] as const).map(
        (reach) => giteaReachWords(reach) === null,
      ),
    ).toEqual([true, true, false, false]);
  });
});

describe("unreadFlowWords: a detail page whose flow is not read ends in its own words", () => {
  const base = {
    signInTrouble: null,
    gitea: "ready",
    groupsRead: true,
    groupKnown: true,
    failure: undefined,
  } as const;
  it.each([
    ["being read", {}, null],
    ["the app's Gitea session on its way", { gitea: "unknown" }, null],
    ["the registry not read yet", { groupsRead: false, groupKnown: false }, null],
    ["Gitea refused the app's sign-in", { signInTrouble: "Gitea refused" }, "Gitea refused"],
    ["no Gitea in the organization", { gitea: "none" }, "This organization has no Gitea."],
    [
      "a group the registry does not hold",
      { groupKnown: false },
      "This project isn't here any more.",
    ],
    ["both of its reads failed", { failure: "Gitea did not answer" }, "Gitea did not answer"],
  ] as const)("%s", (_case, over, words) => {
    expect(unreadFlowWords({ ...base, ...over })).toBe(words);
  });
});
