import { StepNumber, type StepNumberState } from "~/components/ui/step-number";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const STATES = variantsOf<StepNumberState>({
  todo: true,
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
      note: "busy spins, done is a check, attention and failed a mark",
    },
    size: { kind: "enum", options: ["md", "sm"], note: "sm: 18 px, in a line of words" },
    words: { kind: "text", note: "the step's words beside it" },
  },
  initial: {
    n: "1",
    state: "todo",
    size: "md",
    words: "In Terminal, connect it to this project's VPN.",
  },
  render: ({ n, state, size, words }) => (
    <span className="grid max-w-80 grid-cols-[24px_minmax(0,1fr)] items-start gap-3 text-body">
      <StepNumber n={Number(n)} size={size} state={state} />
      <span className="pt-0.5">{words}</span>
    </span>
  ),
  jsx: ({ n, state, size }) =>
    jsxElement("StepNumber", { n: Number(n), state, size }, undefined, {
      state: "todo",
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
