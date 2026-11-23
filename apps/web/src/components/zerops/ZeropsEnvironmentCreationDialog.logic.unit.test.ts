import { expect, it } from "vite-plus/test";
import {
  environmentSheetSubmit,
  offeredBotName,
  type RecipeOption,
} from "./ZeropsEnvironmentCreationDialog.logic.ts";

const empty: RecipeOption = {
  id: "none",
  label: "Empty",
  detail: "Nothing yet",
  choice: { kind: "none" },
};
const seeing = [
  { clientUserId: "member-ada", roleCode: "DEVELOPER" },
  { clientUserId: "member-bo", roleCode: "GUEST" },
];

// witness: apps/web/src/components/zerops/ZeropsEnvironmentCreationDialog.logic.ts | ...(userRoles.length === 0 ? {} : { userRoles }), → ...(userRoles.length === 0 ? { userRoles } : {}),
it("MN9: A new stage keeps the people who could see its project", () => {
  const sent = environmentSheetSubmit({
    role: "stage",
    name: "bakery-stage",
    withAgent: true,
    options: [empty],
    recipe: "present",
    people: { kind: "ready", userRoles: seeing },
  });
  expect(sent.kind).toBe("create");
  expect(sent.kind === "create" ? sent.choice.userRoles : undefined).toEqual(seeing);

  expect(
    environmentSheetSubmit({
      role: "stage",
      name: "bakery-stage",
      withAgent: true,
      options: [empty],
      recipe: "present",
      people: { kind: "reading" },
    }).kind,
  ).toBe("held");
});

// witness: apps/web/src/components/zerops/ZeropsEnvironmentCreationDialog.logic.ts | judge(proposal).kind === "refuse" ? another?.(proposal) : proposal → proposal
it("MN+1: New project offers a Mate name only once every name is read and the refusal would take it; breaks: the form proposes a taken name, refuses it, and Create sends nothing", () => {
  const ask = { tier: undefined, tierLoading: false, another: () => "Ada" };

  const unread = offeredBotName({
    ...ask,
    typed: null,
    proposal: "Heidi",
    takenBotNames: { names: [], complete: false },
  });
  expect(unread.botName).toBe("");
  expect(unread.submit).toEqual({ kind: "wait", on: "names" });

  const typedMeanwhile = offeredBotName({
    ...ask,
    typed: "Vera",
    proposal: "Heidi",
    takenBotNames: { names: [], complete: false },
  });
  expect(typedMeanwhile.botName).toBe("Vera");

  const read = offeredBotName({
    ...ask,
    typed: null,
    proposal: "Heidi",
    takenBotNames: { names: ["heidi"], complete: true },
  });
  expect(read.botName).toBe("Ada");
  expect(read.submit.kind).toBe("create");
});

// witness: apps/web/src/components/zerops/ZeropsEnvironmentCreationDialog.logic.ts | judge(proposal).kind === "refuse" ? another?.(proposal) : proposal → judge(proposal).kind !== "create" ? another?.(proposal) : proposal
it("MN+2: New Mate keeps a free proposal while its recipe is read and replaces one read as taken; breaks: the name changes under the person, or Add waits on a name it will refuse", () => {
  const ask = {
    typed: null,
    appName: "Acme",
    tier: undefined,
    tierLoading: true,
    another: () => "Ada",
  };

  const free = offeredBotName({
    ...ask,
    proposal: "Wren",
    takenBotNames: { names: ["Heidi"], complete: true },
  });
  expect(free.botName).toBe("Wren");
  expect(free.submit).toEqual({ kind: "wait", on: "recipe" });

  const taken = offeredBotName({
    ...ask,
    proposal: "Heidi",
    takenBotNames: { names: ["Heidi"], complete: true },
  });
  expect(taken.botName).toBe("Ada");
  expect(taken.submit).toEqual({ kind: "wait", on: "recipe" });
});
