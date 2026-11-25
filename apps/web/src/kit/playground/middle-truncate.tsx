import { MiddleTruncate } from "~/components/ui/middle-truncate";

import { definePlayground, jsxElement } from "../kitPlayground";

/** The box it is cut to, in px: the room a row or a panel gives it. */
const WIDTHS = {
  "120": "flex w-30 text-body",
  "160": "flex w-40 text-body",
  "224": "flex w-56 text-body",
  "320": "flex w-80 text-body",
} as const;
const WIDTH_IDS = Object.keys(WIDTHS) as (keyof typeof WIDTHS)[];
/** `auto`: the last path segment, capped, or 10 characters. */
const TAILS = ["auto", "6", "12", "20"] as const;

export default definePlayground({
  section: "middle-truncate",
  name: "MiddleTruncate",
  imports: 'import { MiddleTruncate } from "~/components/ui/middle-truncate";',
  controls: {
    value: { kind: "text", note: "a branch, a path, a long service name" },
    width: { kind: "enum", options: WIDTH_IDS, note: "the room it is given, in px" },
    tail: { kind: "enum", options: TAILS, note: "characters kept at the end" },
    showTitle: { kind: "boolean", note: "the whole value on hover; off where a tooltip has it" },
  },
  initial: {
    value: "apps/web/src/components/zerops/addresses/AddressesSheetContainer.tsx",
    width: "224",
    tail: "auto",
    showTitle: true,
  },
  render: ({ value, width, tail, showTitle }) => (
    <div className={WIDTHS[width]}>
      <MiddleTruncate
        showTitle={showTitle}
        value={value}
        {...(tail === "auto" ? {} : { tail: Number(tail) })}
      />
    </div>
  ),
  jsx: ({ value, tail, showTitle }) =>
    jsxElement(
      "MiddleTruncate",
      { value, tail: tail === "auto" ? undefined : Number(tail), showTitle },
      undefined,
      { showTitle: true },
    ),
  usage: {
    do: [
      "Cut a name whose two ends both mean something: a branch's date, a path's file name.",
      "Give it a flex parent with a width; it costs no more than truncate in a long list.",
      "Turn showTitle off where a tooltip already carries the whole value.",
    ],
    dont: [
      "Use it for words in a sentence: those wrap or truncate at their end.",
      "Measure and cut the string yourself: both halves stay real text to copy and read.",
    ],
  },
});
