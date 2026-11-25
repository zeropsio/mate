import { CodeBlock } from "~/components/ui/code-block";

import { definePlayground, jsxElement } from "../kitPlayground";
import { KIT_ANSWER, KIT_YAML } from "../sections/code-block";

const TEXTS = { yaml: KIT_YAML, json: KIT_ANSWER } as const;

export default definePlayground({
  section: "code-block",
  name: "CodeBlock",
  imports: 'import { CodeBlock } from "~/components/ui/code-block";',
  controls: {
    text: { kind: "enum", options: ["yaml", "json"], note: "what it holds" },
    title: { kind: "text", note: "its name on a header line: a path, a file" },
    copy: { kind: "boolean", note: "the one Copy press, in the header or the corner" },
    tone: { kind: "enum", options: ["default", "error"], note: "error: a failed step's own words" },
    height: {
      kind: "enum",
      options: ["auto", "sm", "md", "pane"],
      note: "how tall before it scrolls inside; pane a fixed pane",
    },
    wrap: { kind: "boolean", note: "break long lines, or keep them whole and scroll sideways" },
  },
  initial: {
    text: "yaml",
    title: "zerops.yaml",
    copy: true,
    tone: "default",
    height: "auto",
    wrap: false,
  },
  render: ({ text, title, copy, tone, height, wrap }) => (
    <CodeBlock
      className="w-full max-w-120"
      height={height}
      tone={tone}
      wrap={wrap}
      {...(title === "" ? {} : { title })}
      {...(copy ? { copy: title === "" ? "the text" : title } : {})}
    >
      {TEXTS[text]}
    </CodeBlock>
  ),
  jsx: ({ title, copy, tone, height, wrap }) =>
    jsxElement(
      "CodeBlock",
      {
        title: title === "" ? undefined : title,
        copy: copy ? (title === "" ? "the text" : title) : undefined,
        tone,
        height,
        wrap,
      },
      "{text}",
      { tone: "default", height: "auto", wrap: true },
    ),
  usage: {
    do: [
      "Show text a machine or a person wrote whole: a config, YAML, JSON, a command's output.",
      "Keep wrap for prose-like output; set wrap={false} where the indent is the meaning.",
      "Give it copy where the text is meant to be taken elsewhere: to support, to a terminal.",
    ],
    dont: [
      'Put code inside a sentence in it: that is Text variant="code".',
      "Show one value to copy in it: that is CopyLine.",
      "Stream lines into it: a log is LogView.",
    ],
  },
});
