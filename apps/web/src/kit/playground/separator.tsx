import type { ComponentProps } from "react";

import { Separator } from "~/components/ui/separator";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const ORIENTATIONS = variantsOf<NonNullable<ComponentProps<typeof Separator>["orientation"]>>({
  horizontal: true,
  vertical: true,
});

const TONES = variantsOf<NonNullable<ComponentProps<typeof Separator>["tone"]>>({
  default: true,
  info: true,
});

export default definePlayground({
  section: "separator",
  name: "Separator",
  imports: 'import { Separator } from "~/components/ui/separator";',
  controls: {
    orientation: { kind: "enum", options: ORIENTATIONS, note: "vertical between items on a line" },
    words: { kind: "text", note: "words on the line: a labelled rule (across only)" },
    tone: { kind: "enum", options: TONES, note: "info: a break worth seeing (labelled only)" },
  },
  initial: { orientation: "horizontal", words: "", tone: "default" },
  render: ({ orientation, words, tone }) =>
    orientation === "vertical" ? (
      <div className="flex h-6 items-center gap-3 text-body text-foreground">
        <span>Stage</span>
        <Separator orientation="vertical" />
        <span>Production</span>
      </div>
    ) : words === "" ? (
      <div className="flex w-72 flex-col gap-3 text-body text-foreground">
        <span>Shared vault</span>
        <Separator />
        <span>Each app's own</span>
      </div>
    ) : (
      <div className="w-72">
        <Separator tone={tone}>{words}</Separator>
      </div>
    ),
  jsx: ({ orientation, words, tone }) =>
    orientation === "horizontal" && words !== ""
      ? jsxElement("Separator", { tone }, words, { tone: "default" })
      : jsxElement("Separator", { orientation }, undefined, { orientation: "horizontal" }),
  usage: {
    do: [
      "Part two different parts that spacing alone cannot part: a card's head and body, a toolbar's groups.",
      "Stand a vertical one between items on one line; it stretches to the line's height.",
      "Put words on it for a break in a sequence: a day, where the unread part begins, an or.",
    ],
    dont: [
      "Rule between every item of a list by hand: the items' List draws those rules.",
      "Draw a border on a div, or an h-px span, for the same line.",
    ],
  },
});
