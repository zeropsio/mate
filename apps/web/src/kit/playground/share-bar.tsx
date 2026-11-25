import { seriesColor } from "~/components/ui/chart";
import { ShareBar } from "~/components/ui/share-bar";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

const COUNTS = ["2", "3", "4", "6", "8"] as const;
const NAMES = ["Codex", "Claude", "Grok", "Cursor", "OpenCode", "Antigravity", "Gemini", "Other"];
const AMOUNTS = [4.2, 2.8, 1.6, 0.9, 0.5, 0.3, 0.2, 0.05];

export default definePlayground({
  section: "share-bar",
  name: "ShareBar",
  imports: 'import { ShareBar } from "~/components/ui/share-bar";',
  controls: {
    parts: { kind: "enum", options: COUNTS, note: "series, each in its palette slot" },
    legend: { kind: "boolean", note: "the key under the bar" },
    label: { kind: "text", note: "the whole, for a screen reader" },
  },
  initial: { parts: "4", legend: true, label: "Cost by agent" },
  render: ({ parts, legend, label }) => (
    <div className="w-96">
      <ShareBar
        format={(value) => `$${value.toFixed(2)}`}
        label={label}
        legend={legend}
        parts={NAMES.slice(0, Number(parts)).map((name, index) => ({
          label: name,
          value: AMOUNTS[index] ?? 0,
          color: seriesColor(index),
        }))}
      />
    </div>
  ),
  jsx: ({ legend, label }) =>
    jsxElement(
      "ShareBar",
      { label, parts: jsxCode("parts"), format: jsxCode("formatUsd"), legend },
      undefined,
      { legend: false },
    ),
  usage: {
    do: [
      "Split one whole into its parts: cost by type, a balance by source, tokens by person.",
      "Give each part its series colour from the palette, in a fixed order that follows the part.",
      "Turn the legend on unless rows beside the bar already name each part with a swatch.",
    ],
    dont: [
      "Show one amount against a limit: that is a Meter.",
      "Repaint the parts when one drops out: a part keeps its colour.",
    ],
  },
});
