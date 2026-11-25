import { RealName } from "~/components/ui/real-name";

import { definePlayground, jsxElement } from "../kitPlayground";

/** The line it stands in: its size and its ink are the line's. */
const LINES = ["body", "line", "caption"] as const;

const LINE_CLASS: Record<(typeof LINES)[number], string> = {
  body: "text-body text-foreground",
  line: "text-line text-muted-foreground",
  caption: "text-caption text-muted-foreground",
};

export default definePlayground({
  section: "real-name",
  name: "RealName",
  imports: 'import { RealName } from "~/components/ui/real-name";',
  controls: {
    name: { kind: "text", note: "the thing's own name, as it is spelled" },
    line: {
      kind: "enum",
      options: LINES,
      note: "the words it stands in, whose size and ink it takes",
    },
  },
  initial: { name: "api", line: "body" },
  render: ({ name, line }) => (
    <span className={LINE_CLASS[line]}>
      Deployed to <RealName>{name}</RealName> a minute ago
    </span>
  ),
  jsx: ({ name }) => jsxElement("RealName", {}, name),
  usage: {
    do: [
      "Print a hostname, a repository's slug, a version or a branch as it is spelled.",
      "Let it take the line's size and ink: it sets neither.",
    ],
    dont: [
      "Set the app's own words in it: only a real thing's name.",
      "Give it a colour of its own: it reads in the line's ink.",
    ],
  },
});
