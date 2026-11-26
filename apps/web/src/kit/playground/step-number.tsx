import type { CSSProperties } from "react";

import { StepNumber, type StepNumberState, type StepNumberTone } from "~/components/ui/step-number";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const TONES = variantsOf<StepNumberTone>({ muted: true, tint: true, annotation: true });

const STATES = variantsOf<StepNumberState>({
  todo: true,
  current: true,
  busy: true,
  done: true,
  attention: true,
  failed: true,
});

export default definePlayground({
  section: "step-number",
  name: "StepNumber",
  imports: 'import { StepNumber } from "~/components/ui/step-number";',
  controls: {
    n: { kind: "enum", options: ["1", "2", "3", "12"] as const },
    state: {
      kind: "enum",
      options: STATES,
      note: "current is the step the person is on; busy spins, done is a check, attention and failed a mark",
    },
    tone: {
      kind: "enum",
      options: TONES,
      note: "a step still to come: tint reads --step-tint, annotation is a picture note's",
    },
    size: { kind: "enum", options: ["md", "sm"], note: "sm: 18 px, in a line of words" },
    words: { kind: "text", note: "the step's words beside it" },
  },
  initial: {
    n: "1",
    state: "todo",
    tone: "muted",
    size: "md",
    words: "In Terminal, connect it to this project's VPN.",
  },
  render: ({ n, state, tone, size, words }) => (
    <span
      className="grid max-w-80 grid-cols-[24px_minmax(0,1fr)] items-start gap-3 text-body"
      style={{ "--step-tint": "var(--zerops-mate-tint-violet)" } as CSSProperties}
    >
      <StepNumber n={Number(n)} size={size} state={state} tone={tone} />
      <span className="pt-0.5">{words}</span>
    </span>
  ),
  jsx: ({ n, state, tone, size }) =>
    jsxElement("StepNumber", { n: Number(n), state, tone, size }, undefined, {
      state: "todo",
      tone: "muted",
      size: "md",
    }),
  usage: {
    do: [
      "Number the steps the person takes, in order, each before its words.",
      "Mark a step done or failed in its place, so the list keeps its shape.",
    ],
    dont: [
      "Number work the system does on its own: that is ProcessSteps.",
      "Use it as a count or a label: that is Badge.",
    ],
  },
});
