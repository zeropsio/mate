import { describe, expect, it } from "vite-plus/test";

import { STOP_ARM_MS, stopArmStep, type StopArm, type StopArmEvent } from "./SidebarStopArm.logic";

// Stopping a run from its row is two presses (the owner, 2026-10-01: "this has confirm,
// right?"): the first arms the row, a second within 3 s stops; anything else lets it go.
describe("stopArmStep — a row's stop, armed then pressed", () => {
  const ARMED: StopArm = { armedAt: 1_000 };
  it.each<{ case: string; state: StopArm; event: StopArmEvent; next: StopArm; stop: boolean }>([
    {
      case: "first press arms",
      state: null,
      event: { kind: "press", at: 1_000 },
      next: ARMED,
      stop: false,
    },
    {
      case: "second press within 3 s stops",
      state: ARMED,
      event: { kind: "press", at: 1_000 + STOP_ARM_MS - 1 },
      next: null,
      stop: true,
    },
    {
      case: "a press after 3 s arms again, never stops",
      state: ARMED,
      event: { kind: "press", at: 1_000 + STOP_ARM_MS },
      next: { armedAt: 1_000 + STOP_ARM_MS },
      stop: false,
    },
    {
      case: "the pointer leaving the row disarms",
      state: ARMED,
      event: { kind: "leave" },
      next: null,
      stop: false,
    },
    { case: "Esc disarms", state: ARMED, event: { kind: "escape" }, next: null, stop: false },
    {
      case: "focus leaving the row disarms",
      state: ARMED,
      event: { kind: "blur" },
      next: null,
      stop: false,
    },
    {
      case: "the run ending by itself disarms",
      state: ARMED,
      event: { kind: "run-ended" },
      next: null,
      stop: false,
    },
    {
      case: "3 s passing disarms",
      state: ARMED,
      event: { kind: "tick", at: 1_000 + STOP_ARM_MS },
      next: null,
      stop: false,
    },
    {
      case: "a tick before 3 s keeps it armed",
      state: ARMED,
      event: { kind: "tick", at: 1_000 + STOP_ARM_MS - 1 },
      next: ARMED,
      stop: false,
    },
    {
      case: "nothing armed stays unarmed",
      state: null,
      event: { kind: "escape" },
      next: null,
      stop: false,
    },
  ])("$case", ({ state, event, next, stop }) => {
    expect(stopArmStep(state, event)).toEqual({ state: next, stop });
  });
});
