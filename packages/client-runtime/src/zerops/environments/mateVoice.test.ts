import { describe, expect, it } from "vite-plus/test";

import {
  MATE_VOICE_QUIET_MS,
  MATE_VOICE_SLOW_MS,
  mateVoice,
  mateVoiceQuietKey,
  mateVoiceSpeaks,
} from "./mateVoice.ts";
import type { Reachability } from "./reachability.ts";

const NOW = 1_000_000;
const LONG = MATE_VOICE_QUIET_MS + 1;
const BLIP = MATE_VOICE_QUIET_MS - 1;
const SLOW = MATE_VOICE_SLOW_MS;

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
      state: "a first connect that never comes up, conversation shown: slow, it opens with Try now",
      reachability: { kind: "connecting", waitingOn: "exchange" },
      shown: true,
      held: SLOW,
      voice: banner("Opening Quinn…", ["try-now"]),
    },
    {
      state: "presence never read, conversation shown, slow",
      reachability: { kind: "resolving" },
      shown: true,
      held: SLOW,
      voice: banner("Opening Quinn…", ["try-now"]),
    },
    {
      state: "a first connect that never comes up, nothing shown: Try now joins its line",
      reachability: { kind: "connecting", waitingOn: "exchange" },
      shown: false,
      held: SLOW,
      voice: stage("Opening Quinn…", ["try-now"], true),
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
        kind: "failed",
        stage: "exchange",
        last: { kind: "network" },
        restart: false,
      },
      shown: true,
      held: LONG,
      voice: banner("This Mate isn't answering.", ["try-now"]),
    },
    {
      state: "nothing names the target yet, nothing shown, a blip",
      reachability: null,
      shown: false,
      held: BLIP,
      voice: stage(null),
    },
    {
      state: "nothing names the target yet, nothing shown, slow: being looked for is opening it",
      reachability: null,
      shown: false,
      held: LONG,
      voice: stage("Opening Quinn…", [], true),
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

describe("mateVoiceQuietKey — the quiet is kept by what the voice would say", () => {
  it.each([
    { a: null, b: { kind: "resolving" }, same: true },
    { a: { kind: "resolving" }, b: { kind: "connecting", waitingOn: "descriptor" }, same: true },
    {
      a: { kind: "connecting", waitingOn: "descriptor" },
      b: { kind: "connecting", waitingOn: "exchange" },
      same: true,
    },
    { a: { kind: "connecting", waitingOn: "exchange" }, b: { kind: "reconnecting" }, same: false },
    {
      a: { kind: "connecting", waitingOn: "exchange" },
      b: { kind: "connecting", waitingOn: "visible" },
      same: false,
    },
  ] as const)("$a.kind → $b.kind keeps the quiet: $same", ({ a, b, same }) => {
    expect(
      mateVoiceQuietKey(a as Reachability | null) === mateVoiceQuietKey(b as Reachability | null),
    ).toBe(same);
  });
});

describe("mateVoiceSpeaks — a refused send is explained only where the banner has words", () => {
  it.each([
    { voice: { surface: "none" }, speaks: false },
    {
      voice: { surface: "banner", text: "Reconnecting to Quinn…", actions: [], processes: false },
      speaks: true,
    },
    { voice: { surface: "banner", text: null, actions: [], processes: false }, speaks: false },
    {
      voice: { surface: "stage", text: "Opening Quinn…", actions: [], processes: true },
      speaks: false,
    },
  ] as const)("$voice.surface $voice.text → $speaks", ({ voice, speaks }) => {
    expect(mateVoiceSpeaks(voice)).toBe(speaks);
  });
});
