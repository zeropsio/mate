import { MATE_TINT_IDS, type MateMarkState } from "@t3tools/shared/brand";
import type { ComponentProps } from "react";

import { MateDot } from "~/components/zerops/MateDot";
import { MateFace } from "~/components/zerops/primitives";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

type DotProps = ComponentProps<typeof MateDot>;

const TONES = variantsOf<DotProps["tone"]>({
  attention: true,
  unread: true,
  failed: true,
  working: true,
});
const PLACES = variantsOf<DotProps["place"]>({ before: true, corner: true, inline: true });

/** The face a dot sits on wears the state the dot says. */
const FACE_OF_TONE: Readonly<Record<DotProps["tone"], MateMarkState>> = {
  attention: "needs",
  unread: "done",
  failed: "needs",
  working: "working",
};

export default definePlayground({
  section: "mate-dot",
  name: "MateDot",
  imports: 'import { MateDot } from "~/components/zerops/MateDot";',
  controls: {
    tone: {
      kind: "enum",
      options: TONES,
      note: "amber waits on you, blue unseen, red stopped, its tint at work",
    },
    place: {
      kind: "enum",
      options: PLACES,
      note: "before: hung before a row's time; corner: on a face; inline: in a line",
    },
    tint: { kind: "enum", options: MATE_TINT_IDS, note: "the working tone's hue: its Mate's" },
  },
  initial: { tone: "attention", place: "corner", tint: "sky" },
  render: ({ tone, place, tint }) => {
    const dot = <MateDot place={place} tint={tone === "working" ? tint : undefined} tone={tone} />;
    if (place === "corner") {
      return (
        <span className="relative flex">
          <MateFace size={32} state={FACE_OF_TONE[tone]} tint={tint} />
          {dot}
        </span>
      );
    }
    return place === "before" ? (
      <span className="relative text-caption text-muted-foreground">{dot}2 min</span>
    ) : (
      <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
        {dot}2 min
      </span>
    );
  },
  jsx: ({ tone, place, tint }) =>
    jsxElement("MateDot", { tone, place, tint: tone === "working" ? tint : undefined }),
  usage: {
    do: [
      "Say a Mate's state with this one dot wherever the Mate is drawn: the menu, the rail, a card.",
      "Hang it before a time (place before) so it coming and going moves nothing.",
      "Give the working dot its Mate's own tint.",
    ],
    dont: [
      "Draw a dot of your own for a Mate's state, or a Badge in its place.",
      "Use it for a service or a release: their states are Badges and status tones.",
      "Keep the unread dot after the person has seen the result: it says unseen, nothing more.",
    ],
  },
});
