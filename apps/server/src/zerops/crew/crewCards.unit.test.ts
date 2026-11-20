import { expect, it } from "vite-plus/test";
import { CREW_CARD_OPENER } from "@t3tools/shared/userAsk";
import { carriedCard, taskCard } from "./crewCards.ts";

// witness: apps/server/src/zerops/crew/crewCards.ts | [CREW_CARD_OPENER, `#${task.number} ${task.title} · ${label}`, ...lines] → [`#${task.number} ${task.title} · ${label}`, CREW_CARD_OPENER, ...lines]
it("CM59: A task's card and a task carried into a new conversation reach the crewmate under the crew card opener, with the person's brief, Done when and text whole", () => {
  const task = { number: 12, title: "Camera rig" };
  const brief = "Follow the player.";
  const doneWhen = "the camera follows the player; `npm test` passes";
  const card = taskCard({
    ...task,
    source: "you",
    card: { brief, doneWhen, note: null },
    resetTo: null,
  });
  expect(card.split("\n")[0]).toBe(CREW_CARD_OPENER);
  expect(card).toContain(brief);
  expect(card).toContain(doneWhen);
  const text = "Now also sort them.";
  const carried = carriedCard({ ...task, reason: "Its job changed", text });
  expect(carried.split("\n")[0]).toBe(CREW_CARD_OPENER);
  expect(carried).toContain(text);
});
