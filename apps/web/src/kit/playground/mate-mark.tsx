import { MATE_MARK_LIDS, MATE_TINT_IDS, type MateMarkState } from "@t3tools/shared/brand";

import { MateMark } from "~/components/MateMark";

import { definePlayground, jsxElement } from "../kitPlayground";

const TINTS = ["brand", ...MATE_TINT_IDS] as const;
// Every state the live mark draws, read from the lids that draw it.
const STATES = ["own", ...(Object.keys(MATE_MARK_LIDS) as MateMarkState[])] as const;

/** The box its place gives it: the mark takes the size of whatever holds it. */
const SIZE_CLASS = {
  "16": "size-4",
  "24": "size-6",
  "32": "size-8",
  "48": "size-12",
  "64": "size-16",
} as const;
const SIZES = Object.keys(SIZE_CLASS) as (keyof typeof SIZE_CLASS)[];

export default definePlayground({
  section: "mate-mark",
  name: "MateMark",
  imports: 'import { MateMark } from "~/components/MateMark";',
  controls: {
    tint: { kind: "enum", options: TINTS, note: "brand: the product; a tint: one Mate's mark" },
    size: { kind: "enum", options: SIZES, note: "its holder's box, in px" },
    playful: { kind: "boolean", note: "the live mark: it idles, blinks and reacts to hover" },
    awake: { kind: "boolean", note: "live and already open as it mounts: no waking band" },
    state: { kind: "enum", options: STATES, note: "drives a live mark's face; own: it idles" },
  },
  initial: { tint: "brand", size: "48", playful: false, awake: false, state: "own" },
  render: ({ tint, size, playful, awake, state }) => (
    <div className="flex size-40 items-center justify-center">
      <MateMark
        awake={playful && awake}
        className={SIZE_CLASS[size]}
        key={awake ? "awake" : "asleep"}
        playful={playful}
        tint={tint === "brand" ? undefined : tint}
        {...(playful && state !== "own" ? { state } : {})}
      />
    </div>
  ),
  jsx: ({ tint, size, playful, awake, state }) =>
    jsxElement(
      "MateMark",
      {
        className: SIZE_CLASS[size],
        tint: tint === "brand" ? undefined : tint,
        playful,
        awake: playful ? awake : undefined,
        state: playful && state !== "own" ? state : undefined,
      },
      undefined,
      { playful: false, awake: false },
    ),
  usage: {
    do: [
      "Use it for the product itself: the menu's corner, sign-in, the boot frame.",
      "Wear it as the Chief's face: the organization's Mate is the product's mark.",
      "Give it a Mate's tint only where it stands for that one Mate: an empty chat, a draft's headline.",
    ],
    dont: [
      "Use it for a coding agent's state: Claude, Codex and the others have their own marks.",
      "Stand it in for an ordinary Mate: a Mate is its MateFace.",
      "Recolour it with className: its colour is the brand's teal or a Mate's tint.",
    ],
  },
});
