import { expect, it } from "vite-plus/test";
import { mateLinkVerbs } from "../../zerops/mateRecovery.logic.ts";

// witness: apps/web/src/zerops/mateRecovery.logic.ts | restart: input.verbs?.restart === true || input.restartOffered, → restart: input.verbs?.restart === true,
it("MN+3: A Mate HQ offers a restart of shows a Restart beside Open in Zerops that its press runs, and one without the offer shows its verbs as before; breaks: a Mate that stopped answering while Zerops shows it running offers no way back but Zerops", () => {
  const notAnswering = ["try-now", "open-in-zerops"] as const;
  const quiet = { start: false, restart: false };
  const read = (restartOffered: boolean) => {
    const verbs = mateLinkVerbs({ actions: notAnswering, verbs: quiet, restartOffered });
    return { shown: verbs.actions.includes("restart"), pressable: verbs.restart };
  };
  expect([read(true), read(false)]).toEqual([
    { shown: true, pressable: true },
    { shown: false, pressable: false },
  ]);
});
