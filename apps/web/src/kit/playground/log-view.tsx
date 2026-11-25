import { LogView } from "~/components/ui/code-block";

import { definePlayground, jsxElement } from "../kitPlayground";
import { KIT_LOG } from "../sections/log-view";

export default definePlayground({
  section: "log-view",
  name: "LogView",
  imports: 'import { LogView } from "~/components/ui/code-block";',
  controls: {
    times: { kind: "boolean", note: "lines carry their time: a column of its own" },
    copy: { kind: "boolean", note: "a Copy press in the corner, copying every line" },
    live: { kind: "boolean", note: "lines still arrive: announced, the end followed" },
    height: {
      kind: "enum",
      options: ["auto", "sm", "md", "pane"],
      note: "how tall before it scrolls inside; pane a fixed pane for a stream",
    },
  },
  initial: { times: true, copy: true, live: false, height: "auto" },
  render: ({ times, copy, live, height }) => (
    <LogView
      className="w-full max-w-160"
      height={height}
      label="Build log"
      lines={times ? KIT_LOG : KIT_LOG.map(({ time: _time, ...line }) => line)}
      live={live}
      {...(copy ? { copy: "the log" } : {})}
    />
  ),
  jsx: ({ copy, live, height }) =>
    jsxElement(
      "LogView",
      {
        label: "Build log",
        lines: { code: "lines" },
        live,
        copy: copy ? "the log" : undefined,
        height,
      },
      undefined,
      { live: false, height: "auto" },
    ),
  usage: {
    do: [
      "Show lines a machine wrote one by one; give each its tone: failed, warning, quiet.",
      'Stand a streaming log in height="pane", so arriving lines never move the page.',
    ],
    dont: ["Show a config or an answer read whole in it: that is CodeBlock."],
  },
});
