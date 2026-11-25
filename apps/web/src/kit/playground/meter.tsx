import { Meter } from "~/components/ui/meter";

import { definePlayground, jsxElement } from "../kitPlayground";

const VALUES = ["0", "0.1", "0.42", "0.75", "0.95", "1"] as const;
const MARKERS = ["none", "0.25", "0.5", "0.75"] as const;
const TONES = ["neutral", "primary", "info", "success", "warning", "danger"] as const;
const COLORS = {
  tone: undefined,
  "series-1": "var(--color-series-1)",
  "series-2": "var(--color-series-2)",
  claude: "var(--color-agent-claude)",
  spend: "var(--color-spend-compute)",
} as const;
const COLOR_NAMES = Object.keys(COLORS) as (keyof typeof COLORS)[];

export default definePlayground({
  section: "meter",
  name: "Meter",
  imports: 'import { Meter } from "~/components/ui/meter";',
  controls: {
    value: { kind: "enum", options: VALUES, note: "the share filled, 0 to 1" },
    size: {
      kind: "enum",
      options: ["sm", "md", "lg"],
      note: "sm a row, md a list, lg the subject",
    },
    tone: { kind: "enum", options: TONES, note: "what the fill means" },
    color: { kind: "enum", options: COLOR_NAMES, note: "a series' colour in place of the tone" },
    marker: { kind: "enum", options: MARKERS, note: "a hairline where even pacing would be" },
    label: { kind: "text", note: "what it measures, for a screen reader" },
  },
  initial: {
    value: "0.42",
    size: "sm",
    tone: "info",
    color: "tone",
    marker: "none",
    label: "RAM used",
  },
  render: ({ value, size, tone, color, marker, label }) => (
    <Meter
      className="w-64"
      color={COLORS[color]}
      label={label === "" ? undefined : label}
      marker={marker === "none" ? null : Number(marker)}
      size={size}
      tone={tone}
      value={Number(value)}
    />
  ),
  jsx: ({ value, size, tone, color, marker, label }) =>
    jsxElement(
      "Meter",
      {
        value: Number(value),
        size,
        tone: color === "tone" ? tone : undefined,
        color: COLORS[color],
        marker: marker === "none" ? undefined : Number(marker),
        label: label === "" ? undefined : label,
      },
      undefined,
      { size: "sm", tone: "neutral" },
    ),
  usage: {
    do: [
      "Show one amount against its limit: a resource of what the service holds, a window's tokens.",
      "Say the figure in words beside it; the bar is the glance, the words are the fact.",
      "Turn the tone where the caller's own rule says it is nearly full or over.",
    ],
    dont: [
      "Split a whole into parts: that is a ShareBar.",
      "Show an operation moving forward over time: that is Progress, which draws a Meter itself.",
      "Draw a bar by hand from a width or a scale: every bar is a Meter.",
    ],
  },
});
