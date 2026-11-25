import { Text, type TextVariant } from "~/components/ui/text";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const VARIANTS = variantsOf<TextVariant>({
  headline: true,
  heading: true,
  label: true,
  description: true,
  remark: true,
  note: true,
  meta: true,
  error: true,
  code: true,
});

export default definePlayground({
  section: "text",
  name: "Text",
  imports: 'import { Text } from "~/components/ui/text";',
  controls: {
    variant: { kind: "enum", options: VARIANTS, note: "what the words are" },
    truncate: { kind: "boolean", note: "one line, cut with an ellipsis" },
    children: { kind: "text" },
  },
  initial: {
    variant: "note",
    truncate: false,
    children: "Use a key made only for Mate, with a spending limit.",
  },
  render: ({ variant, truncate, children }) => (
    <div className="w-80">
      <Text render={<p />} truncate={truncate} variant={variant}>
        {children}
      </Text>
    </div>
  ),
  jsx: ({ variant, truncate, children }) =>
    jsxElement("Text", { variant, truncate }, children, { truncate: false }),
  usage: {
    do: [
      "Name the words by what they are: a hint under a field is a note, a time beside a name is meta.",
      "Render it as the element the words are: render={<p />} for a sentence, <h3 /> for a heading.",
      "Place it with className: margin, width, flex, alignment.",
    ],
    dont: [
      "Restyle it with a size, an ink or a weight: pick the variant that says what the words are.",
      "Use it for words a kit piece already draws: a row's title and line, a section's label, a page's title, an empty place's line.",
    ],
  },
});
