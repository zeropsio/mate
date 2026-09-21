import { describe, expect, it } from "vite-plus/test";

import { registryHoldsCreate, type RegistryReadState } from "./ZeropsNewProjectWizard.logic";

describe("registryHoldsCreate", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly giteaKnown: boolean;
    readonly registryRead: RegistryReadState;
    readonly held: boolean;
  }> = [
    {
      name: "an account with no Gitea waits for nothing",
      giteaKnown: false,
      registryRead: "loading",
      held: false,
    },
    {
      name: "a read in flight holds it — pressing now would stand up a second Gitea",
      giteaKnown: true,
      registryRead: "loading",
      held: true,
    },
    {
      name: "a read that answered releases it",
      giteaKnown: true,
      registryRead: "ready",
      held: false,
    },
    {
      // The live fault: the gate was `registry === null`, which a failed read
      // satisfies for ever, so the only button on the page died silently.
      name: "a read that failed does NOT hold it — the create is written for that",
      giteaKnown: true,
      registryRead: "failed",
      held: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(
        registryHoldsCreate({
          giteaKnown: testCase.giteaKnown,
          registryRead: testCase.registryRead,
        }),
      ).toBe(testCase.held);
    });
  }
});
