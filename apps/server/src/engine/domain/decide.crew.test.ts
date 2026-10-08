import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ConversationId,
  type CrewCard,
  type KnownEngineEvent,
  type Principal,
} from "@t3tools/contracts";

import type { Command, Decision, EffectDraft } from "./command.ts";
import { decide } from "./decide.ts";
import { fold, stampEvents } from "./evolve.ts";
import { initialState, type ConversationState } from "./state.ts";

const conversation = ConversationId.make("crew-main-backend-1");
const crew: Principal = { kind: "crew", startedBy: "karel" };
const T0 = 1_000_000_000;

const CARD: CrewCard = {
  kind: "task",
  taskId: "t1",
  number: 1,
  title: "Add pagination",
  why: "Cursor based.",
  doneWhen: null,
  links: [],
};

interface Scene {
  readonly state: ConversationState;
  readonly decision: Decision;
  readonly events: ReadonlyArray<KnownEngineEvent>;
  readonly effects: ReadonlyArray<EffectDraft>;
}

const play = (steps: ReadonlyArray<Command>): Scene => {
  let state = initialState(conversation);
  let scene: Scene | undefined;
  steps.forEach((command, index) => {
    const envelope = {
      commandId: CommandId.make(`c${index}`),
      conversationId: conversation,
      principal: crew,
      command,
    };
    const decision = decide(state, envelope, T0);
    const events =
      decision._tag === "Accept"
        ? stampEvents(state.headSeq, envelope, decision.step.events, T0)
        : [];
    state = fold(state, events);
    scene = {
      state,
      decision,
      events,
      effects: decision._tag === "Accept" ? decision.step.effects : [],
    };
  });
  return scene!;
};

const opened = (scene: Scene) =>
  scene.events.flatMap((event) => (event._tag === "ItemOpened" ? [event.body] : []));

describe("decide: the crew's words in a crewmate's conversation", () => {
  it("a card the crew sends opens its run as the card, never as the person's message", () => {
    const scene = play([{ _tag: "Send", text: "[Crew task card]\n#1 Add pagination", card: CARD }]);
    expect(opened(scene)).toEqual([
      {
        kind: "note",
        text: "[Crew task card]\n#1 Add pagination",
        streaming: false,
        answer: false,
        card: CARD,
      },
    ]);
    expect(scene.events.find((event) => event._tag === "RunQueued")).toMatchObject({
      text: "[Crew task card]\n#1 Add pagination",
    });
  });

  it("a person's message sent through the crew stays the person's", () => {
    const scene = play([{ _tag: "Send", text: "Also sort them." }]);
    expect(opened(scene)).toMatchObject([{ kind: "person", text: "Also sort them." }]);
  });

  it("a seam is a line in the record between turns, with its words", () => {
    const scene = play([
      {
        _tag: "MarkSeam",
        seam: { seam: "landed", taskId: "t1", number: 1, commit: "abc1234" } as never,
        words: "#1 landed on your tree.",
      },
    ]);
    expect(opened(scene)).toEqual([
      {
        kind: "marker",
        marker: {
          kind: "crew.seam",
          reason: "#1 landed on your tree.",
          seam: { seam: "landed", taskId: "t1", number: 1, commit: "abc1234" },
        },
      },
    ]);
    expect(scene.events.some((event) => event._tag === "RunQueued")).toBe(false);
  });
});
