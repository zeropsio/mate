import { expect, it } from "vite-plus/test";

import { newProjectBotName } from "./ZeropsNewProjectForm.logic.ts";

// witness: apps/web/src/components/zerops/ZeropsNewProjectForm.logic.ts | judge(proposal).kind === "create" ? proposal : another(proposal) → proposal
it("MN+1: New project offers a Mate name only once every name is read and the refusal would take it; breaks: the form proposes a taken name, refuses it, and Create sends nothing", () => {
  const another = () => "Ada";

  const unread = newProjectBotName({
    typed: null,
    proposal: "Heidi",
    taken: { names: [], complete: false },
    another,
  });
  expect(unread.botName).toBe("");
  expect(unread.submit).toEqual({ kind: "wait", on: "names" });

  const typedMeanwhile = newProjectBotName({
    typed: "Vera",
    proposal: "Heidi",
    taken: { names: [], complete: false },
    another,
  });
  expect(typedMeanwhile.botName).toBe("Vera");

  const read = newProjectBotName({
    typed: null,
    proposal: "Heidi",
    taken: { names: ["heidi"], complete: true },
    another,
  });
  expect(read.botName).toBe("Ada");
  expect(read.submit.kind).toBe("create");
});
