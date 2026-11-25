import { GitPullRequestIcon } from "lucide-react";

import { Dot, type DotCorner, type DotTone } from "~/components/ui/dot";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const TONES = variantsOf<DotTone>({
  neutral: true,
  info: true,
  success: true,
  warning: true,
  danger: true,
  current: true,
});

const PLACES = [
  "line",
  ...variantsOf<DotCorner>({ "top-end": true, "top-start": true, "bottom-end": true }),
] as const;

export default definePlayground({
  section: "dot",
  name: "Dot",
  imports: 'import { Dot } from "~/components/ui/dot";',
  controls: {
    tone: {
      kind: "enum",
      options: TONES,
      note: "Badge's meanings; current takes the ink it marks",
    },
    size: { kind: "enum", options: ["md", "sm"], note: "sm 6 px: a dense line, a corner" },
    place: { kind: "enum", options: PLACES, note: "before a line, or on a corner of an icon" },
    pulse: { kind: "boolean", note: "breathes while the work it marks runs" },
    hollow: { kind: "boolean", note: "the ring only: nothing yet, at rest; never on a corner" },
  },
  initial: { tone: "info", size: "md", place: "line", pulse: false, hollow: false },
  render: ({ tone, size, place, pulse, hollow }) =>
    place === "line" ? (
      <span className="flex items-center gap-2 text-body">
        {hollow ? (
          <Dot hollow size={size} tone={tone} />
        ) : (
          <Dot pulse={pulse} size={size} tone={tone} />
        )}
        Deploying to stage
      </span>
    ) : (
      <span className="relative inline-flex text-muted-foreground">
        <GitPullRequestIcon aria-hidden="true" className="size-5" />
        <Dot corner={place} pulse={pulse} size={size} tone={tone} />
      </span>
    ),
  jsx: ({ tone, size, place, pulse, hollow }) =>
    jsxElement(
      "Dot",
      {
        tone,
        size,
        corner: place === "line" ? undefined : place,
        pulse,
        hollow: place === "line" ? hollow : false,
      },
      undefined,
      { tone: "neutral", size: "md", pulse: false, hollow: false },
    ),
  usage: {
    do: [
      "Mark a line's state before its words, or something new on an icon's corner.",
      "Pulse it only while the work it marks runs.",
      "Give it an aria-label when it is the only word for what it means.",
    ],
    dont: [
      "Draw a dot by hand with rounded-full and a ground.",
      "Use it for a chart's legend: that is the chart's swatch.",
      "Put a status's words beside it yourself: that is Badge's dot form.",
    ],
  },
});
