import { ArrowDownIcon } from "lucide-react";

import { FloatingAction } from "~/components/ui/floating-action";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "floating-action",
  name: "FloatingAction",
  imports: 'import { FloatingAction } from "~/components/ui/floating-action";',
  controls: {
    shown: { kind: "boolean", note: "it rises in and sinks out instead of mounting" },
    label: { kind: "text", note: "what it does, for the reader: it shows only its icon" },
  },
  initial: { shown: true, label: "Scroll to end" },
  render: ({ shown, label }) => (
    <FloatingAction label={label} onClick={() => undefined} shown={shown}>
      <ArrowDownIcon aria-hidden="true" />
    </FloatingAction>
  ),
  jsx: ({ shown, label }) => jsxElement("FloatingAction", { label, shown }, "<ArrowDownIcon />"),
  usage: {
    do: [
      "Float the one press a scrolling surface needs back over it: the way to its end.",
      "Place it from its parent, beside the content rather than on its words.",
      "Keep it in the document and let shown ease it in and out.",
    ],
    dont: [
      "Show a row's or a card's tools on its hover with it: those belong to the row or the card.",
      "Put it over a picture on the dark stage: that is DialogMediaStep or the scrim button.",
      "Give it words: it is one icon, named by its label.",
    ],
  },
});
