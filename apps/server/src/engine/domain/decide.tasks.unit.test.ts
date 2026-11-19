import { expect, it } from "vite-plus/test";
import { CrewCard, Principal, type KnownEngineEvent } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { play, send } from "../testing/scene.ts";

const task: Principal = { kind: "task", taskId: "task-1" };
const source = {
  kind: "github-issue" as const,
  repo: "acme/tea-shop",
  number: 42,
  url: "https://github.com/acme/tea-shop/issues/42",
  title: "The cart forgets its teas",
  author: "nova",
};
const crew = Schema.decodeUnknownSync(Principal)({ kind: "crew", startedBy: "karel" });
const CARD = Schema.decodeUnknownSync(CrewCard)({
  kind: "task",
  taskId: "t1",
  number: 1,
  title: "Add pagination",
  why: "Cursor based.",
  doneWhen: null,
  links: [],
});

const openedItem = (events: ReadonlyArray<KnownEngineEvent>) => {
  const item = events.find((event) => event._tag === "ItemOpened");
  return item?._tag === "ItemOpened" ? item.body : undefined;
};
const openedBodies = (events: ReadonlyArray<KnownEngineEvent>) =>
  events.flatMap((event) => (event._tag === "ItemOpened" ? [event.body] : []));

// witness: apps/server/src/engine/domain/decide.send.ts | ...(command.taskId === undefined ? {} : { taskId: command.taskId }), → ...(command.taskId === undefined ? {} : {}),
it("ED109: A task's messages name their task, so one conversation holds many tasks, and a person's message carries no task", () => {
  const tasked = play([
    { command: send("Work issue #42", { task: source, taskId: "task-1" }), by: task },
  ]);
  expect(openedItem(tasked.events)).toMatchObject({ kind: "person", taskId: "task-1" });

  const person = play([send("hello")]);
  expect(openedItem(person.events)).not.toHaveProperty("task");
  expect(openedItem(person.events)).not.toHaveProperty("taskId");
});

// witness: apps/server/src/engine/domain/decide.send.ts | : { kind: "note", text: command.text, streaming: false, answer: false, card: command.card }, → : { kind: "note", text: command.text, streaming: false, answer: false },
it("ED110: A card the crew sends opens its run as the card, never as the person's message, and a person's message sent through the crew stays the person's", () => {
  const card = play([
    {
      command: { _tag: "Send", text: "[Crew task card]\n#1 Add pagination", card: CARD },
      by: crew,
    },
  ]);
  expect(openedBodies(card.events)).toEqual([
    {
      kind: "note",
      text: "[Crew task card]\n#1 Add pagination",
      streaming: false,
      answer: false,
      card: CARD,
    },
  ]);
  expect(card.events.find((event) => event._tag === "RunQueued")).toMatchObject({
    text: "[Crew task card]\n#1 Add pagination",
  });

  const person = play([{ command: send("Also sort them."), by: crew }]);
  expect(openedBodies(person.events)).toMatchObject([{ kind: "person", text: "Also sort them." }]);
});
