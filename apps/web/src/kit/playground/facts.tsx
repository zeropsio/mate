import { Card } from "~/components/ui/card";
import { Fact, Facts } from "~/components/ui/facts";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "facts",
  name: "Facts",
  imports: 'import { Fact, Facts } from "~/components/ui/facts";',
  controls: {
    mono: { kind: "boolean", note: "the values are literals, in the code face" },
    changed: { kind: "boolean", note: "the last fact changes: was → now" },
    inset: { kind: "boolean", note: "set into a card" },
  },
  initial: { mono: true, changed: true, inset: true },
  render: ({ mono, changed, inset }) => {
    const facts = (
      <Facts mono={mono}>
        <Fact label="api · type">nodejs@22</Fact>
        <Fact label="api · min RAM" was={changed ? "0.25 GB" : undefined}>
          1 GB
        </Fact>
      </Facts>
    );
    return inset ? (
      <Card className="w-72" size="sm" variant="inset">
        {facts}
      </Card>
    ) : (
      facts
    );
  },
  jsx: ({ mono, changed }) =>
    jsxElement(
      "Facts",
      { mono },
      `<Fact label="api · type">nodejs@22</Fact>\n<Fact label="api · min RAM"${changed ? ' was="0.25 GB"' : ""}>1 GB</Fact>`,
      { mono: false },
    ),
  usage: {
    do: [
      "List what a change sets or what a source said, each label beside its value.",
      "Set mono where the values are literals; set it into a Card inset inside a card.",
    ],
    dont: [
      "Draw a label/value grid by hand.",
      "Put text read whole (a config, an import) in it: that is CodeBlock.",
    ],
  },
});
