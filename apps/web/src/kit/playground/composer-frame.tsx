import type { ComponentProps } from "react";
import { ArrowUpIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ComposerFrame } from "~/components/ui/composer-frame";
import { Textarea } from "~/components/ui/textarea";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const SIZES = variantsOf<NonNullable<ComponentProps<typeof ComposerFrame>["size"]>>({
  sheet: true,
  card: true,
});

export default definePlayground({
  section: "composer-frame",
  name: "ComposerFrame",
  imports: 'import { ComposerFrame } from "~/components/ui/composer-frame";',
  controls: {
    size: { kind: "enum", options: SIZES, note: "sheet: a page's foot; card: inside a panel" },
    locked: { kind: "boolean", note: "nothing can be written here now" },
    placeholder: { kind: "text", note: "what the field asks for" },
  },
  initial: { size: "sheet", locked: false, placeholder: "Give the crew something to do…" },
  render: ({ size, locked, placeholder }) => (
    <ComposerFrame className="w-full max-w-xl" locked={locked} size={size}>
      <Textarea
        aria-label={placeholder}
        className="flex-1"
        disabled={locked}
        placeholder={placeholder}
        rows={1}
        size="line"
      />
      <Button aria-label="Send" disabled={locked} shape="round" size="icon-sm">
        <ArrowUpIcon />
      </Button>
    </ComposerFrame>
  ),
  jsx: ({ size, locked, placeholder }) =>
    jsxElement(
      "ComposerFrame",
      { size, locked },
      `<Textarea placeholder="${placeholder}" rows={1} size="line" />`,
      { size: "sheet", locked: false },
    ),
  usage: {
    do: [
      "Write every message box on it: a tell, a comment, a reply in a panel.",
      'Put its words in a Textarea size="line" and its presses at its end.',
    ],
    dont: [
      "Draw a composer's ground, edge, lift or corner by hand.",
      "Use it for a form's field: a field is an Input or a Textarea.",
    ],
  },
});
