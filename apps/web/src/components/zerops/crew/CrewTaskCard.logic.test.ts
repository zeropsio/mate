import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { describe, expect, it } from "vite-plus/test";

import { crewTaskCardModel } from "./CrewTaskCard.logic";

const TASKS = crewSnapshotFixture().board.tasks.map((task) =>
  task.number === 12
    ? { ...task, source: "you" as const, doneWhen: "/api/items takes ?cursor; npm test passes" }
    : task.number === 15
      ? { ...task, source: "lead" as const }
      : task,
);

describe("crewTaskCardModel", () => {
  it.each<{
    readonly name: string;
    readonly card: { readonly title: string; readonly text: string };
    readonly model: ReturnType<typeof crewTaskCardModel>;
  }>([
    {
      name: "names a board task by its number and title, where it came from and when it is done",
      card: {
        title: "#12 Add pagination to /api/items",
        text: "Add cursor pagination to /api/items, 50 per page.\nDone when: /api/items takes ?cursor; npm test passes",
      },
      model: {
        heading: "#12 Add pagination to /api/items",
        source: "from you",
        text: "Add cursor pagination to /api/items, 50 per page.",
        doneWhen: "/api/items takes ?cursor; npm test passes",
      },
    },
    {
      name: "says a task the lead planned came from the lead, with the board's done-when",
      card: { title: "#15 Camera rig follows the player", text: "" },
      model: {
        heading: "#15 Camera rig follows the player",
        source: "from the lead",
        text: "",
        doneWhen: "The camera follows the player; npm test passes",
      },
    },
    {
      name: "keeps a card whose task is not on the board as it was written",
      card: {
        title: "#99 Something older",
        text: "The body.\nDone when: it builds",
      },
      model: {
        heading: "#99 Something older",
        source: null,
        text: "The body.",
        doneWhen: "it builds",
      },
    },
    {
      name: "keeps a card without a task number as it was written",
      card: { title: "Continue your task; your job changed (v5).", text: "" },
      model: {
        heading: "Continue your task; your job changed (v5).",
        source: null,
        text: "",
        doneWhen: null,
      },
    },
  ])("$name", ({ card, model }) => {
    expect(crewTaskCardModel(card, TASKS)).toEqual(model);
  });
});
