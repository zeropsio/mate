import { InlineButton } from "~/components/ui/button";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "button",
  name: "InlineButton",
  imports: 'import { InlineButton } from "~/components/ui/button";',
  controls: {
    tone: {
      kind: "enum",
      options: ["default", "muted", "plain", "destructive", "picker"],
      note: "plain for a name that opens what it names",
    },
    children: { kind: "text", note: "the word that acts" },
    disabled: { kind: "boolean" },
  },
  initial: { tone: "default", children: "open its logs", disabled: false },
  render: ({ tone, children, disabled }) => (
    <p className="m-0 max-w-sm text-body">
      The build failed on step 3;{" "}
      <InlineButton disabled={disabled} tone={tone}>
        {children}
      </InlineButton>{" "}
      to see why.
    </p>
  ),
  jsx: ({ tone, children, disabled }) =>
    jsxElement("InlineButton", { tone, disabled }, children, { tone: "default", disabled: false }),
  usage: {
    do: [
      "Use it for a word that acts inside a sentence; it keeps the text's size.",
      "Use the plain tone for a name that opens what it names: a file, a release, a run.",
    ],
    dont: [
      "Stand it alone: a press on its own line is a Button.",
      "Use a browser link's default blue underline in its place.",
    ],
  },
});
