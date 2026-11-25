import { ProcessSteps, type ProcessStep } from "~/components/zerops/primitives";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

const DENSITIES = ["default", "compact"] as const;
const MOMENTS = ["under way", "failed", "finished"] as const;

const BUILD: ProcessStep = {
  id: "build",
  label: "Build",
  state: "done",
  stateLabel: "Done",
  durationMs: 42_000,
};
const ADDRESS_DONE: ProcessStep = {
  id: "address",
  label: "Give it an address",
  state: "done",
  stateLabel: "Done",
  durationMs: 3_000,
};

/** A deploy's steps at one moment of its run. */
const STEPS: Record<(typeof MOMENTS)[number], ReadonlyArray<ProcessStep>> = {
  "under way": [
    BUILD,
    { id: "deploy", label: "Deploy", state: "running", stateLabel: "Running", durationMs: 12_000 },
    { id: "address", label: "Give it an address", state: "queued", stateLabel: "Waiting" },
  ],
  failed: [
    BUILD,
    {
      id: "deploy",
      label: "Deploy",
      state: "failed",
      stateLabel: "Failed",
      note: "exit 1",
      durationMs: 9_000,
    },
  ],
  finished: [
    BUILD,
    { id: "deploy", label: "Deploy", state: "done", stateLabel: "Done", durationMs: 31_000 },
    ADDRESS_DONE,
  ],
};

function stepCode(step: ProcessStep): string {
  const fields = [
    `id: "${step.id}"`,
    `label: "${step.label}"`,
    `state: "${step.state}"`,
    `stateLabel: "${step.stateLabel}"`,
    ...(step.note === undefined ? [] : [`note: "${step.note}"`]),
    ...(step.durationMs === undefined ? [] : [`durationMs: ${step.durationMs}`]),
  ];
  return `{ ${fields.join(", ")} }`;
}

export default definePlayground({
  section: "process-steps",
  name: "ProcessSteps",
  imports: 'import { ProcessSteps } from "~/components/zerops/primitives";',
  controls: {
    moment: { kind: "enum", options: MOMENTS, note: "where the Zerops process is" },
    density: {
      kind: "enum",
      options: DENSITIES,
      note: "compact inside a card of results",
    },
  },
  initial: { moment: "under way", density: "default" },
  render: ({ moment, density }) => (
    <div className="w-md">
      <ProcessSteps density={density} steps={STEPS[moment]} />
    </div>
  ),
  jsx: ({ moment, density }) =>
    jsxElement(
      "ProcessSteps",
      {
        density,
        steps: jsxCode(
          `[\n${STEPS[moment].map((step) => `    ${stepCode(step)},`).join("\n")}\n  ]`,
        ),
      },
      undefined,
      { density: "default" },
    ),
  usage: {
    do: [
      "Show a Zerops process's steps as Zerops runs them, each with its own words and time.",
      "Use compact in a card of results, so a column of green rings does not outweigh the words.",
      "Carry the source's note beside the step it belongs to, as exit 1 is.",
    ],
    dont: [
      "Use it for one of Mate's own operations: that is a Progress row.",
      "Say Done or Waiting in words: the glyph already does.",
      "Invent a step or a time the process did not report.",
    ],
  },
});
