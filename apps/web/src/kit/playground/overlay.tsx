import { PaperclipIcon } from "lucide-react";

import { Overlay } from "~/components/ui/overlay";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";
import { OverlayStage } from "../sections/overlay";

const KINDS = ["drop", "hint"] as const;

export default definePlayground({
  section: "overlay",
  name: "Overlay",
  imports: 'import { Overlay } from "~/components/ui/overlay";',
  controls: {
    kind: {
      kind: "enum",
      options: KINDS,
      note: "drop: over its surface, a target; hint: over the window, a held key",
    },
    shown: { kind: "boolean", note: "it eases in and out instead of mounting" },
    icon: { kind: "boolean", note: "a glyph before the words, in the primary ink" },
    words: { kind: "text" },
  },
  initial: { kind: "drop", shown: true, icon: true, words: "Drop files to attach" },
  render: ({ kind, shown, icon, words }) => (
    <OverlayStage>
      <Overlay
        icon={icon ? <PaperclipIcon aria-hidden="true" /> : undefined}
        kind={kind}
        shown={shown}
      >
        {words}
      </Overlay>
    </OverlayStage>
  ),
  jsx: ({ kind, shown, icon, words }) =>
    jsxElement(
      "Overlay",
      { kind, shown, icon: icon ? jsxCode("<PaperclipIcon />") : undefined },
      words,
    ),
  usage: {
    do: [
      "Say what the surface does with what is over it now: a drop it takes, a key being held.",
      "Keep it in the document and let shown ease it in and out.",
    ],
    dont: [
      "Put a press in it: it takes none.",
      "Tie it to a press or a point: that is a Popover or a Tooltip.",
      "Leave a message that should stay: that is a Toast or an Alert.",
    ],
  },
});
