import { DiffStat } from "~/components/ui/diff-stat";

import { definePlayground, jsxElement } from "../kitPlayground";

const COUNTS = { small: [42, 3], large: [12480, 1730], added: [18, 0], none: [0, 0] } as const;

export default definePlayground({
  section: "diff-stat",
  name: "DiffStat",
  imports: 'import { DiffStat } from "~/components/ui/diff-stat";',
  controls: {
    counts: { kind: "enum", options: ["small", "large", "added", "none"], note: "what changed" },
    compact: { kind: "boolean", note: "cut large counts: 12.5k" },
    aligned: { kind: "boolean", note: "each count in a column of its own" },
  },
  initial: { counts: "small", compact: false, aligned: false },
  render: ({ counts, compact, aligned }) => (
    <span className="text-body">
      <DiffStat
        additions={COUNTS[counts][0]}
        aligned={aligned}
        compact={compact}
        deletions={COUNTS[counts][1]}
      />
    </span>
  ),
  jsx: ({ counts, compact, aligned }) =>
    jsxElement(
      "DiffStat",
      { additions: COUNTS[counts][0], deletions: COUNTS[counts][1], compact, aligned },
      undefined,
      { compact: false, aligned: false },
    ),
  usage: {
    do: ["Say a change's size wherever it is shown: a menu row, a file's row, a review's count."],
    dont: ["Colour +/− counts by hand: the inks and the minus sign are DiffStat's."],
  },
});
