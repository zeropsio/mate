import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { describe, expect, it } from "vite-plus/test";

import { ThreadId } from "@t3tools/contracts";

import { crewCardOrigin, crewTaskCardModel } from "./CrewTaskCard.logic";

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
      name: "names a board task by its title and when it is done — never its number or source",
      card: {
        title: "#12 Add pagination to /api/items · from you",
        text: "Add cursor pagination to /api/items, 50 per page.\nDone when: /api/items takes ?cursor; npm test passes",
      },
      model: {
        heading: "Add pagination to /api/items",
        text: "Add cursor pagination to /api/items, 50 per page.",
        doneWhen: "/api/items takes ?cursor; npm test passes",
      },
    },
    {
      name: "takes the board's done-when for a task the card says none for",
      card: { title: "#15 Camera rig follows the player · from the lead", text: "" },
      model: {
        heading: "Camera rig follows the player",
        text: "",
        doneWhen: "The camera follows the player; npm test passes",
      },
    },
    {
      name: "reads a card whose task is not on the board by its own title",
      card: {
        title: "#99 Something older · rework after review",
        text: "The body.\nDone when: it builds",
      },
      model: {
        heading: "Something older",
        text: "The body.",
        doneWhen: "it builds",
      },
    },
    {
      name: "keeps a card without a task number as it was written",
      card: { title: "Continue your task; your job changed.", text: "" },
      model: {
        heading: "Continue your task; your job changed.",
        text: "",
        doneWhen: null,
      },
    },
  ])("$name", ({ card, model }) => {
    expect(crewTaskCardModel(card, TASKS)).toEqual(model);
  });
});

describe("crewCardOrigin", () => {
  const first = { threadId: ThreadId.make("thread-crew-backend-1"), reason: null };
  const second = {
    threadId: ThreadId.make("thread-crew-backend-2"),
    reason: "You cleared its conversation",
  };
  const third = { threadId: ThreadId.make("thread-crew-backend-3"), reason: null };
  const stints = [first, second, third];

  it.each<{
    readonly name: string;
    readonly threadId: ThreadId;
    readonly seamed: boolean;
    readonly origin: ReturnType<typeof crewCardOrigin>;
  }>([
    {
      name: "a crewmate's first conversation has none",
      threadId: first.threadId,
      seamed: false,
      origin: null,
    },
    {
      name: "a later one says why it began and links the one before",
      threadId: second.threadId,
      seamed: false,
      origin: { text: "You cleared its conversation", previousThreadId: first.threadId },
    },
    {
      name: "a later one without a reason is a new conversation",
      threadId: third.threadId,
      seamed: false,
      origin: { text: "New conversation", previousThreadId: second.threadId },
    },
    {
      name: "none where the engine's own seam says it already",
      threadId: second.threadId,
      seamed: true,
      origin: null,
    },
    {
      name: "none for a thread the crewmate's stints do not list",
      threadId: ThreadId.make("thread-other"),
      seamed: false,
      origin: null,
    },
  ])("$name", ({ threadId, seamed, origin }) => {
    expect(crewCardOrigin({ stints, threadId, seamed })).toEqual(origin);
  });
});
