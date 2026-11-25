import { PanelRightIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";

import { definePlayground, jsxElement } from "../kitPlayground";

const TONES = ["neutral", "info", "success", "warning", "danger"] as const;
const FORMS = ["pill", "count", "dot"] as const;

export default definePlayground({
  section: "badge",
  name: "Badge",
  imports: 'import { Badge } from "~/components/ui/badge";',
  controls: {
    tone: { kind: "enum", options: TONES, note: "meaning, never decoration" },
    form: { kind: "enum", options: FORMS, note: "a word, a number, or a status dot before words" },
    pulse: { kind: "boolean", note: "dot: it breathes while work runs" },
    hollow: { kind: "boolean", note: "dot: its ring only, nothing there yet, or at rest" },
    door: { kind: "boolean", note: "pill: it opens what it names, its hairline firms on hover" },
    corner: { kind: "boolean", note: "count: on a control's corner" },
    children: { kind: "text", note: "a short word, or a number" },
  },
  initial: {
    tone: "success",
    form: "pill",
    pulse: false,
    hollow: false,
    door: false,
    corner: false,
    children: "Running",
  },
  render: ({ tone, form, pulse, hollow, door, corner, children }) =>
    form === "dot" ? (
      <Badge dot hollow={hollow} pulse={pulse} tone={tone}>
        {children}
      </Badge>
    ) : form === "count" ? (
      corner ? (
        <span className="relative inline-flex size-8 items-center justify-center rounded-control bg-muted text-muted-foreground">
          <PanelRightIcon aria-hidden="true" className="size-4" />
          <Badge corner count tone={tone}>
            {children}
          </Badge>
        </span>
      ) : (
        <span className="flex items-center gap-2 font-medium text-body">
          Changes
          <Badge count tone={tone}>
            {children}
          </Badge>
        </span>
      )
    ) : (
      <Badge door={door} tone={tone}>
        {children}
      </Badge>
    ),
  jsx: ({ tone, form, pulse, hollow, door, corner, children }) =>
    jsxElement(
      "Badge",
      {
        tone,
        count: form === "count",
        corner: form === "count" ? corner : undefined,
        dot: form === "dot",
        pulse: form === "dot" ? pulse : undefined,
        hollow: form === "dot" ? hollow : undefined,
        door: form === "pill" ? door : undefined,
      },
      children,
      {
        tone: "neutral",
        count: false,
        corner: false,
        dot: false,
        pulse: false,
        hollow: false,
        door: false,
      },
    ),
  usage: {
    do: [
      "Use danger for what broke and to name Production.",
      "Give a dot without words an aria-label.",
      "Keep it to a word or a count beside the thing it describes.",
      "Say a number with the count form: beside a title, or on a control's corner.",
    ],
    dont: [
      "Make it a Button: a label never reads as a press; one that opens what it names is a door.",
      "Pick a tone for its colour; each tone carries a meaning.",
    ],
  },
});
