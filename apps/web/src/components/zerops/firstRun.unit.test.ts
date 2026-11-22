import { expect, it } from "vite-plus/test";

import { accountFirstRun } from "../../zerops/firstRun.ts";

// witness: apps/web/src/zerops/firstRun.ts | if (input.creating) return input.standing; → if (input.creating || input.standing) return input.standing;
it("MN+1: The first run stands while HQ lists nothing for the person, a birth this tab presses keeps only the first-run screen that pressed it, and HQ listing the person's Mates again ends a standing first run at that frame; breaks: the first-run screen stays over the menu after access is given back, or New project's wizard flashes the first run before HQ lists its Mate", () => {
  const known = (listsNothing: boolean) => ({ state: "known" as const, listsNothing });
  const cases = [
    // A demotion: HQ lists nothing for the person any more.
    { menu: known(true), listingSaysNone: false, creating: false, standing: false },
    // The give-back: HQ lists the person's Mate again while the screen stands.
    { menu: known(false), listingSaysNone: true, creating: false, standing: true },
    // The screen's own Create, before HQ lists its Mate: the screen carries it.
    { menu: known(false), listingSaysNone: true, creating: true, standing: true },
    // The wizard's birth, landing here before HQ lists it: no first run flashes.
    { menu: known(true), listingSaysNone: true, creating: true, standing: false },
    // Before HQ's first answer, whatever Zerops lists.
    {
      menu: { state: "loading" as const, listsNothing: false },
      listingSaysNone: true,
      creating: false,
      standing: false,
    },
    // HQ refusing: Zerops' listing says it.
    {
      menu: { state: "refused" as const, listsNothing: false },
      listingSaysNone: true,
      creating: false,
      standing: false,
    },
    {
      menu: { state: "refused" as const, listsNothing: false },
      listingSaysNone: false,
      creating: false,
      standing: true,
    },
  ];
  expect(cases.map(accountFirstRun)).toEqual([true, false, true, false, false, true, false]);
});
