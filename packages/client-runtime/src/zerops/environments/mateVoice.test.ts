import { describe, expect, it } from "vite-plus/test";

import { MATE_VOICE_QUIET_MS, mateVoice } from "./mateVoice.ts";
import type { Reachability } from "./reachability.ts";

const NOW = 1_000_000;
const LONG = MATE_VOICE_QUIET_MS + 1;
const BLIP = MATE_VOICE_QUIET_MS - 1;

const RESTARTING: Reachability = {
  kind: "container",
  container: {
    level: "restarting",
    by: "platform",
    overdue: false,
  },
};
const UPDATING: Reachability = {
  kind: "container",
  container: { level: "updating", overdue: false },
};

const banner = (text: string, actions: ReadonlyArray<string> = []) => ({
  surface: "banner",
  text,
  actions,
  processes: false,
});
const stage = (text: string | null, actions: ReadonlyArray<string> = [], processes = false) => ({
  surface: "stage",
  text,
  actions,
  processes,
});

// One surface speaks in each state of the link: the stage where no conversation is shown, the
// banner where one is, and nothing where nothing needs saying (the owner, 2026-09-30).
describe("mateVoice — the one voice of a Mate's link", () => {
  it.each([
    {
      state: "up",
      reachability: { kind: "ready", notice: null },
      shown: true,
      held: LONG,
      voice: { surface: "none" },
    },
    {
      state: "first load, conversation shown",
      reachability: { kind: "connecting", waitingOn: "exchange" },
      shown: true,
      held: LONG,
      voice: { surface: "none" },
    },
    {
      state: "first load, nothing shown, a blip",
      reachability: { kind: "connecting", waitingOn: "exchange" },
      shown: false,
      held: BLIP,
      voice: stage(null),
    },
    {
      state: "first load, nothing shown, slow: the Mate opens, its processes under it",
      reachability: { kind: "connecting", waitingOn: "descriptor" },
      shown: false,
      held: LONG,
      voice: stage("Opening Quinn…", [], true),
    },
    {
      state: "first load waiting on the tab: its own cause",
      reachability: { kind: "connecting", waitingOn: "visible" },
      shown: false,
      held: LONG,
      voice: stage("Paused while this tab is in the background."),
    },
    {
      state: "reconnecting, a blip",
      reachability: { kind: "reconnecting" },
      shown: true,
      held: BLIP,
      voice: { surface: "none" },
    },
    {
      state: "reconnecting after a drop",
      reachability: { kind: "reconnecting" },
      shown: true,
      held: LONG,
      voice: banner("Reconnecting to Quinn…", ["try-now"]),
    },
    {
      state: "Zerops restarting it, conversation shown",
      reachability: RESTARTING,
      shown: true,
      held: BLIP,
      voice: banner("Quinn is restarting."),
    },
    {
      state: "Zerops restarting it, a reload while down",
      reachability: RESTARTING,
      shown: false,
      held: BLIP,
      voice: stage("Quinn is restarting."),
    },
    {
      state: "updating, the version it goes to not known",
      reachability: UPDATING,
      shown: true,
      held: LONG,
      voice: banner("Quinn is updating."),
    },
    {
      state: "a restart under a live link",
      reachability: {
        kind: "ready",
        notice: (RESTARTING as Extract<Reachability, { kind: "container" }>).container,
      },
      shown: true,
      held: BLIP,
      voice: banner("Quinn is restarting."),
    },
    {
      state: "a restart past its cap: its own words and Restart",
      reachability: {
        kind: "container",
        container: { level: "restarting", by: "platform", overdue: true },
      },
      shown: true,
      held: LONG,
      voice: banner("Quinn is taking longer than usual to start.", ["restart"]),
    },
    {
      state: "retrying: its cause and Try now",
      reachability: {
        kind: "retrying",
        retryAtMs: NOW + 5_000,
        last: { kind: "network" },
        restart: false,
      },
      shown: true,
      held: LONG,
      voice: banner("This Mate isn't answering. Trying again in 5 s.", ["try-now"]),
    },
    {
      state: "nothing names the target yet, nothing shown",
      reachability: null,
      shown: false,
      held: LONG,
      voice: stage(null),
    },
  ] as const)("$state", ({ reachability, shown, held, voice }) => {
    expect(
      mateVoice({
        reachability: reachability as Reachability | null,
        conversationShown: shown,
        heldMs: held,
        nowMs: NOW,
        mateName: "Quinn",
      }),
    ).toEqual(voice);
  });
});
