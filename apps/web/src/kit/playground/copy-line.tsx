import { CopyLine } from "~/components/ui/copy-line";

import { definePlayground, jsxElement } from "../kitPlayground";

const VALUES = {
  url: "https://hq.example.com/hooks/github/4f1c2a9e-77b3-4c1e-9a0d-5be0c2f1aa31",
  command: "git clone https://git.example.com/acme/storefront.git",
  path: "/var/www/storefront/apps/web",
} as const;

export default definePlayground({
  section: "copy-line",
  name: "CopyLine",
  imports: 'import { CopyLine } from "~/components/ui/copy-line";',
  controls: {
    value: { kind: "enum", options: ["url", "command", "path"], note: "one value to copy" },
    wrap: { kind: "boolean", note: "wrap anywhere instead of cutting with an ellipsis" },
    reading: { kind: "boolean", note: "value={null}: the room held, Copy waits" },
    placeholder: { kind: "text", note: "words in its room while there is no value yet" },
  },
  initial: { value: "url", wrap: false, reading: false, placeholder: "" },
  render: ({ value, wrap, reading, placeholder }) => (
    <CopyLine
      className="w-full max-w-96"
      label={`the ${value}`}
      value={reading ? null : VALUES[value]}
      wrap={wrap}
      {...(placeholder === "" ? {} : { placeholder })}
    />
  ),
  jsx: ({ value, wrap, reading, placeholder }) =>
    jsxElement(
      "CopyLine",
      {
        label: `the ${value}`,
        value: reading ? { code: "null" } : VALUES[value],
        placeholder: placeholder === "" ? undefined : placeholder,
        wrap,
      },
      undefined,
      { wrap: false },
    ),
  usage: {
    do: [
      "Hand over one value the person takes elsewhere: a command, a path, an address, a secret.",
      "Name it with the place's own label, over or beside it.",
    ],
    dont: [
      "Put several lines in it: that is CodeBlock.",
      'Use it for a literal inside a sentence: that is Text variant="code".',
    ],
  },
});
