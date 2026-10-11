import { describe, expect, it } from "vite-plus/test";

import { menuLitMate, type MenuPress } from "./menuPress.logic";

describe("menuLitMate — the Mate the menu lights", () => {
  const fromAda: MenuPress = { projectId: "bea", from: "ada", fromOverview: false };
  const fromOverview: MenuPress = { projectId: "bea", from: null, fromOverview: true };
  it.each([
    {
      case: "a Mate pressed, its route still on the one open before",
      press: fromAda,
      now: { active: "ada", overviewOpen: false },
      lit: "bea",
    },
    {
      case: "a Mate pressed, the route between two pages",
      press: fromAda,
      now: { active: null, overviewOpen: false },
      lit: "bea",
    },
    {
      case: "its route arrived",
      press: fromAda,
      now: { active: "bea", overviewOpen: false },
      lit: "bea",
    },
    {
      case: "another Mate opened since",
      press: fromAda,
      now: { active: "cid", overviewOpen: false },
      lit: "cid",
    },
    {
      case: "the overview opened since",
      press: fromAda,
      now: { active: null, overviewOpen: true },
      lit: null,
    },
    {
      case: "a Mate pressed on the overview, its route on its way",
      press: fromOverview,
      now: { active: null, overviewOpen: true },
      lit: "bea",
    },
    {
      case: "nothing pressed",
      press: null,
      now: { active: "ada", overviewOpen: false },
      lit: "ada",
    },
  ])(
    "lights the pressed Mate from the press, until its route does: $case",
    ({ press, now, lit }) => {
      expect(menuLitMate(press, now)).toBe(lit);
    },
  );
});
