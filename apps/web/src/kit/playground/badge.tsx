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
    children: { kind: "text", note: "a short word or count" },
  },
  initial: { tone: "success", dot: false, pulse: false, children: "Running" },
  render: ({ tone, dot, pulse, children }) =>
    dot ? (
      <Badge dot pulse={pulse} tone={tone}>
        {children}
      </Badge>
    ) : (
      <Badge tone={tone}>{children}</Badge>
    ),
  jsx: ({ tone, dot, pulse, children }) =>
    jsxElement("Badge", { tone, dot, pulse: dot ? pulse : undefined }, children, {
      tone: "neutral",
      dot: false,
      pulse: false,
    }),
  usage: {
    do: [
      "Use danger for what broke and to name Production.",
      "Give a dot without words an aria-label.",
      "Keep it to a word or a count beside the thing it describes.",
    ],
    dont: [
      "Make it pressable: a label never reads as a press.",
      "Pick a tone for its colour; each tone carries a meaning.",
    ],
  },
});
