import {
  MATE_MARK_LIDS,
  MATE_SHAPE_IDS,
  MATE_TINT_IDS,
  type MateMarkState,
} from "@t3tools/shared/brand";
import type { CSSProperties } from "react";

import { MateFace, type MateFaceSize } from "~/components/zerops/primitives";
import { MATE_MOMENTS } from "~/zerops/mateMoments.logic";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

// Every state the face draws, read from the lids that draw it: a new state appears here by itself.
const STATES = Object.keys(MATE_MARK_LIDS) as MateMarkState[];
const SIZES = variantsOf<`${MateFaceSize}`>({
  "16": true,
  "20": true,
  "24": true,
  "32": true,
  "64": true,
});
/** `own`: the tint's own silhouette (`MATE_SHAPE_OF_TINT`), as a Mate without a chosen one wears. */
const SHAPES = ["own", ...MATE_SHAPE_IDS] as const;
const GAZES = ["level", "up", "down"] as const;
const MOMENTS = ["none", ...MATE_MOMENTS] as const;

/** How far a pacing face walks either way, as the arrival stage gives it. */
const PACE: CSSProperties = { "--mate-face-pace": "48px" } as CSSProperties;

export default definePlayground({
  section: "mate-face",
  name: "MateFace",
  imports: 'import { MateFace } from "~/components/zerops/primitives";',
  controls: {
    tint: { kind: "enum", options: MATE_TINT_IDS, note: "the Mate's colour, chosen once" },
    shape: {
      kind: "enum",
      options: SHAPES,
      note: "own: the tint's silhouette; a chosen one is HQ's record",
    },
    state: { kind: "enum", options: STATES, note: "the eyes carry it" },
    size: { kind: "enum", options: SIZES, note: "one scale with PersonAvatar" },
    gaze: { kind: "enum", options: GAZES, note: "up thinking, down writing: the run's line only" },
    moment: {
      kind: "enum",
      options: MOMENTS,
      note: "a cue it greets; pick another to play one again",
    },
    mark: { kind: "boolean", note: "drawn as the product's mark: a Chief" },
    restarting: { kind: "boolean", note: "its container restarts: a slow TV loop" },
    paces: { kind: "boolean", note: "it stands something up: walks to and fro" },
    tracks: { kind: "boolean", note: "alone on a page: its eyes follow the pointer" },
  },
  initial: {
    tint: "coral",
    shape: "own",
    state: "idle",
    size: "64",
    gaze: "level",
    moment: "none",
    mark: false,
    restarting: false,
    paces: false,
    tracks: false,
  },
  render: ({ tint, shape, state, size, gaze, moment, mark, restarting, paces, tracks }) => (
    <div className="flex size-40 items-center justify-center" style={paces ? PACE : undefined}>
      <MateFace
        cues={moment === "none" ? undefined : [{ moment, key: moment }]}
        gaze={gaze === "level" ? undefined : gaze}
        mark={mark}
        paces={paces}
        restarting={restarting}
        shape={shape === "own" ? undefined : shape}
        size={Number(size) as MateFaceSize}
        state={state}
        tint={tint}
        tracks={tracks}
      />
    </div>
  ),
  jsx: ({ tint, shape, state, size, gaze, moment, mark, restarting, paces, tracks }) =>
    jsxElement(
      "MateFace",
      {
        tint,
        shape: shape === "own" ? undefined : shape,
        state,
        size: Number(size),
        gaze: gaze === "level" ? undefined : gaze,
        cues: moment === "none" ? undefined : jsxCode(`[{ moment: "${moment}", key: "…" }]`),
        mark,
        restarting,
        paces,
        tracks,
      },
      undefined,
      { size: 24, mark: false, restarting: false, paces: false, tracks: false },
    ),
  usage: {
    do: [
      "Draw a Mate with its face wherever it is named: the menu, its page, a card, a chat line.",
      "Pass the Mate's own tint and shape from its record; never pick one for the look.",
      "Let the state say what it does: needs waits on you, working works, sleep is out of reach.",
      "Seat it beside a PersonAvatar of the same size: a Mate stands as tall as a person.",
    ],
    dont: [
      "Draw a Mate as an icon, a letter or a coloured dot.",
      "Recolour it, outline it or put a ring round it with className.",
      "Make idle eyes move: a menu of faces must not blink at you.",
      "Play a moment for something the face did not watch happen; a reload replays nothing.",
    ],
  },
});
