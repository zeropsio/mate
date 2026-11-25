import type { ComponentProps } from "react";

import { Separator } from "~/components/ui/separator";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const ORIENTATIONS = variantsOf<NonNullable<ComponentProps<typeof Separator>["orientation"]>>({
  horizontal: true,
  vertical: true,
});

export default definePlayground({
  section: "separator",
  name: "Separator",
  imports: 'import { Separator } from "~/components/ui/separator";',
  controls: {
    orientation: { kind: "enum", options: ORIENTATIONS, note: "vertical between items on a line" },
  },
  initial: { orientation: "horizontal" },
  render: ({ orientation }) =>
    orientation === "vertical" ? (
      <div className="flex h-6 items-center gap-3 text-body text-foreground">
        <span>Stage</span>
        <Separator orientation="vertical" />
        <span>Production</span>
      </div>
    ) : (
      <div className="flex w-72 flex-col gap-3 text-body text-foreground">
        <span>Shared vault</span>
        <Separator />
        <span>Each app's own</span>
      </div>
    ),
  jsx: ({ orientation }) =>
    jsxElement("Separator", { orientation }, undefined, { orientation: "horizontal" }),
  usage: {
    do: [
      "Part two groups that spacing alone cannot part: a menu's sections, a toolbar's halves.",
      "Stand a vertical one between items on one line; it stretches to the line's height.",
    ],
    dont: [
      "Rule between every row of a list: rows part by their spacing.",
      "Draw a border on a div for the same line.",
    ],
  },
});
