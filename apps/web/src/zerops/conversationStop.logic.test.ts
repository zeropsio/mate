import { describe, expect, it } from "vite-plus/test";

import {
  conversationStop,
  stopRefusal,
  withStopPress,
  type StopPress,
} from "./conversationStop.logic";

const pressed = (turnId: string | null, refused: string | null = null): StopPress => ({
  turnId,
  refused,
});

// S21-02: the person pressed the menu row's Stop and nothing visible happened for 10 s; the turn
// ended, its helper went on, and a second Stop on another control read as a restart.
describe("a Mate's one Stop", () => {
  it.each([
    {
      name: "nothing pressed and nothing in force reads as no Stop",
      press: null,
      stopping: false,
      working: true,
      turnId: "nova/r/3",
      shows: { kind: "none" },
    },
    {
      name: "a press reads as stopping at once, before the Mate answers",
      press: pressed("nova/r/3"),
      stopping: false,
      working: true,
      turnId: "nova/r/3",
      shows: { kind: "stopping" },
    },
    {
      name: "the Mate's word that a Stop is in force reads as stopping on every device, pressed here or not",
      press: null,
      stopping: true,
      working: true,
      turnId: "nova/r/3",
      shows: { kind: "stopping" },
    },
    {
      name: "once nothing runs, a pressed Stop says it is over: nothing more will change",
      press: pressed("nova/r/3"),
      stopping: false,
      working: false,
      turnId: "nova/r/3",
      shows: { kind: "stopped" },
    },
    {
      name: "a refused Stop says why and gives the control back",
      press: pressed("nova/r/3", "The Mate is offline."),
      stopping: false,
      working: true,
      turnId: "nova/r/3",
      shows: { kind: "refused", reason: "The Mate is offline." },
    },
    {
      name: "a later turn's work is its own: a Stop pressed under an earlier turn says nothing of it",
      press: pressed("nova/r/3"),
      stopping: false,
      working: true,
      turnId: "nova/r/4",
      shows: { kind: "none" },
    },
  ])("$name", ({ press, stopping, working, turnId, shows }) => {
    expect(conversationStop({ press, stopping, working, turnId })).toEqual(shows);
  });

  it.each([
    { name: "another control or device asked first", code: "stop-already-asked", says: null },
    { name: "what it would stop already ended", code: "run-not-running", says: null },
    { name: "its run ended as it was asked", code: "run-ended", says: null },
    {
      name: "the Mate refused it",
      code: "authorization",
      says: "You may not stop this Mate.",
    },
  ])("a Stop's failure says why only when it was refused: $name", ({ code, says }) => {
    expect(stopRefusal({ code, message: "You may not stop this Mate." })).toBe(says);
  });

  const working = { kind: "working", turnId: "nova/r/3" } as const;
  it.each([
    {
      name: "a press on its turn makes its row say stopping",
      activity: working,
      press: pressed("nova/r/3"),
      stopping: true,
    },
    {
      name: "no press leaves its row as the Mate says",
      activity: working,
      press: null,
      stopping: false,
    },
    {
      name: "a refused press gives its row back",
      activity: working,
      press: pressed("nova/r/3", "The Mate is offline."),
      stopping: false,
    },
    {
      name: "a press under an earlier turn leaves a later turn's row alone",
      activity: { ...working, turnId: "nova/r/4" },
      press: pressed("nova/r/3"),
      stopping: false,
    },
    {
      name: "nothing running has nothing to stop",
      activity: { kind: "idle", turnId: "nova/r/3" },
      press: pressed("nova/r/3"),
      stopping: false,
    },
  ] as const)(
    "the menu row reads this tab's press at once: $name",
    ({ activity, press, stopping }) => {
      expect(
        withStopPress<{ kind: string; turnId?: string; stopping?: true }>(activity, press)
          ?.stopping === true,
      ).toBe(stopping);
    },
  );
});
