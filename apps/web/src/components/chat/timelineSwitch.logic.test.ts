import { describe, expect, it } from "vite-plus/test";

import {
  initialTimelineSwitch,
  stepTimelineSwitch,
  type TimelineSwitchEvent,
  type TimelineSwitchState,
} from "./timelineSwitch.logic";

const shown = (key: string): TimelineSwitchState => ({
  key,
  painted: true,
  waiting: false,
  freeze: null,
});
const placing = (key: string): TimelineSwitchState => ({
  key,
  painted: false,
  waiting: false,
  freeze: null,
});
const waiting = (key: string): TimelineSwitchState => ({
  key,
  painted: false,
  waiting: true,
  freeze: null,
});
const held = (key: string, from: string): TimelineSwitchState => ({
  key,
  painted: false,
  waiting: false,
  freeze: { from, fading: false },
});
const fading = (key: string, from: string, painted = true): TimelineSwitchState => ({
  key,
  painted,
  waiting: false,
  freeze: { from, fading: true },
});

describe("switching between conversations", () => {
  it("opens on a conversation not yet painted, with nothing held over it", () => {
    expect(initialTimelineSwitch("nova")).toEqual(placing("nova"));
  });

  it.each<{
    readonly case: string;
    readonly state: TimelineSwitchState;
    readonly event: TimelineSwitchEvent;
    readonly reducedMotion?: boolean;
    readonly next: TimelineSwitchState;
    readonly effect: "capture" | "fade" | "remove" | "none";
  }>([
    {
      case: "a painted conversation left stays on screen, still, over the next",
      state: shown("nova"),
      event: { type: "switch", to: "juno" },
      next: held("juno", "nova"),
      effect: "capture",
    },
    {
      case: "one showing its Mate at work, left, stays on screen as it was",
      state: waiting("juno"),
      event: { type: "switch", to: "fen" },
      next: held("fen", "juno"),
      effect: "capture",
    },
    {
      case: "one showing its Mate at work under the picture held over it keeps that picture",
      state: { ...held("juno", "nova"), waiting: true },
      event: { type: "switch", to: "fen" },
      next: held("fen", "nova"),
      effect: "none",
    },
    {
      case: "one left before it painted keeps the picture already up",
      state: held("juno", "nova"),
      event: { type: "switch", to: "fen" },
      next: held("fen", "nova"),
      effect: "none",
    },
    {
      case: "with nothing painted and nothing up, there is nothing to hold",
      state: placing("nova"),
      event: { type: "switch", to: "juno" },
      next: placing("juno"),
      effect: "none",
    },
    {
      case: "one left while the picture gives way to it is what shows: a new picture of it",
      state: fading("juno", "nova"),
      event: { type: "switch", to: "fen" },
      next: held("fen", "juno"),
      effect: "capture",
    },
    {
      case: "one left before it painted, while the picture gave way, keeps that picture",
      state: fading("juno", "nova", false),
      event: { type: "switch", to: "fen" },
      next: fading("fen", "nova", false),
      effect: "none",
    },
    {
      case: "the route naming the same conversation again changes nothing",
      state: held("juno", "nova"),
      event: { type: "switch", to: "juno" },
      next: held("juno", "nova"),
      effect: "none",
    },
    {
      case: "the next conversation in place: the picture fades",
      state: held("juno", "nova"),
      event: { type: "painted", key: "juno" },
      next: fading("juno", "nova"),
      effect: "fade",
    },
    {
      case: "with reduced motion the picture goes in the frame the next one shows",
      state: held("juno", "nova"),
      event: { type: "painted", key: "juno" },
      reducedMotion: true,
      next: shown("juno"),
      effect: "remove",
    },
    {
      case: "a conversation in place with nothing over it just shows",
      state: placing("nova"),
      event: { type: "painted", key: "nova" },
      next: shown("nova"),
      effect: "none",
    },
    {
      case: "a conversation already left says nothing any more",
      state: held("fen", "nova"),
      event: { type: "painted", key: "juno" },
      next: held("fen", "nova"),
      effect: "none",
    },
    {
      case: "one painting while the picture already gives way just shows under it",
      state: fading("juno", "nova", false),
      event: { type: "painted", key: "juno" },
      next: fading("juno", "nova"),
      effect: "none",
    },
    {
      case: "painting twice is painting once",
      state: fading("juno", "nova"),
      event: { type: "painted", key: "juno" },
      next: fading("juno", "nova"),
      effect: "none",
    },
    {
      case: "one slow to come: the picture gives way to its Mate at work",
      state: held("juno", "nova"),
      event: { type: "held-too-long", key: "juno" },
      next: fading("juno", "nova", false),
      effect: "fade",
    },
    {
      case: "one slow to come, with reduced motion: the picture goes at once",
      state: held("juno", "nova"),
      event: { type: "held-too-long", key: "juno" },
      reducedMotion: true,
      next: placing("juno"),
      effect: "remove",
    },
    {
      case: "the wait of a conversation already left ends nothing",
      state: held("fen", "nova"),
      event: { type: "held-too-long", key: "juno" },
      next: held("fen", "nova"),
      effect: "none",
    },
    {
      case: "a wait ending while the picture already fades changes nothing",
      state: fading("juno", "nova"),
      event: { type: "held-too-long", key: "juno" },
      next: fading("juno", "nova"),
      effect: "none",
    },
    {
      case: "its Mate at work showing on its pane is something on screen",
      state: placing("juno"),
      event: { type: "waiting", key: "juno" },
      next: waiting("juno"),
      effect: "none",
    },
    {
      case: "the Mate at work of a conversation already left shows nothing",
      state: placing("fen"),
      event: { type: "waiting", key: "juno" },
      next: placing("fen"),
      effect: "none",
    },
    {
      case: "a conversation in place does not wait",
      state: shown("juno"),
      event: { type: "waiting", key: "juno" },
      next: shown("juno"),
      effect: "none",
    },
    {
      case: "its Mate at work giving way to its rows is held until they stand",
      state: waiting("juno"),
      event: { type: "placing", key: "juno" },
      next: held("juno", "juno"),
      effect: "capture",
    },
    {
      case: "a pane that showed nothing yet holds nothing",
      state: placing("juno"),
      event: { type: "placing", key: "juno" },
      next: placing("juno"),
      effect: "none",
    },
    {
      case: "a pane going under the picture of the one left keeps that picture",
      state: { ...held("juno", "nova"), waiting: true },
      event: { type: "placing", key: "juno" },
      next: { ...held("juno", "nova"), waiting: true },
      effect: "none",
    },
    {
      case: "a pane going while the picture gives way to it lets the picture go",
      state: { ...fading("juno", "nova", false), waiting: true },
      event: { type: "placing", key: "juno" },
      next: { ...fading("juno", "nova", false), waiting: true },
      effect: "none",
    },
    {
      case: "a conversation standing already holds nothing",
      state: shown("juno"),
      event: { type: "placing", key: "juno" },
      next: shown("juno"),
      effect: "none",
    },
    {
      case: "the pane of a conversation left holds nothing",
      state: waiting("fen"),
      event: { type: "placing", key: "juno" },
      next: waiting("fen"),
      effect: "none",
    },
    {
      case: "its rows in place over its Mate at work: the picture of it fades",
      state: { ...held("juno", "juno") },
      event: { type: "painted", key: "juno" },
      next: fading("juno", "juno"),
      effect: "fade",
    },
    {
      case: "the fade over, the picture is taken down",
      state: fading("juno", "nova"),
      event: { type: "faded" },
      next: shown("juno"),
      effect: "remove",
    },
    {
      case: "the fade over before the next painted leaves it placing",
      state: fading("juno", "nova", false),
      event: { type: "faded" },
      next: placing("juno"),
      effect: "remove",
    },
    {
      case: "a fade replaced by a new picture has nothing left to take down",
      state: held("fen", "juno"),
      event: { type: "faded" },
      next: held("fen", "juno"),
      effect: "none",
    },
  ])("$case", ({ state, event, reducedMotion = false, next, effect }) => {
    expect(stepTimelineSwitch(state, event, { reducedMotion })).toEqual({ state: next, effect });
  });
});
