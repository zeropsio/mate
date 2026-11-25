import { Badge } from "~/components/ui/badge";

import { definePlayground, jsxElement } from "../kitPlayground";

const TONES = ["neutral", "info", "success", "warning", "danger"] as const;

export default definePlayground({
  section: "badge",
  name: "Badge",
  imports: 'import { Badge } from "~/components/ui/badge";',
  controls: {
    tone: { kind: "enum", options: TONES, note: "meaning, never decoration" },
    dot: { kind: "boolean", note: "a status dot before its words" },
    pulse: { kind: "boolean", note: "the dot breathes while work runs" },
    hollow: { kind: "boolean", note: "the dot's ring only: nothing there yet, or at rest" },
    door: { kind: "boolean", note: "a pill that opens what it names: its hairline firms on hover" },
    children: { kind: "text", note: "a short word or count" },
  },
  initial: {
    tone: "success",
    dot: false,
    pulse: false,
    hollow: false,
    door: false,
    children: "Running",
  },
  render: ({ tone, dot, pulse, hollow, door, children }) =>
    dot ? (
      <Badge door={door} dot hollow={hollow} pulse={pulse} tone={tone}>
        {children}
      </Badge>
    ) : (
      <Badge door={door} tone={tone}>
        {children}
      </Badge>
    ),
  jsx: ({ tone, dot, pulse, hollow, door, children }) =>
    jsxElement(
      "Badge",
      { tone, dot, pulse: dot ? pulse : undefined, hollow: dot ? hollow : undefined, door },
      children,
      { tone: "neutral", dot: false, pulse: false, hollow: false, door: false },
    ),
  usage: {
    do: [
      "Use danger for what broke and to name Production.",
      "Give a dot without words an aria-label.",
      "Keep it to a word or a count beside the thing it describes.",
    ],
    dont: [
      "Make it a Button: a label never reads as a press; one that opens what it names is a door.",
      "Pick a tone for its colour; each tone carries a meaning.",
    ],
  },
});
