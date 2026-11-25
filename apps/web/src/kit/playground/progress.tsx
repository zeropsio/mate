import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Progress, type ProgressView } from "~/components/ui/progress";
import { useSecondsNowMs } from "~/zerops/useNowMs";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

const MIN = 60_000;
const STEPS = [
  "Creating its project",
  "Starting its services",
  "Deploying it",
  "Giving it an address",
] as const;
const STATES = ["running", "done", "failed"] as const;
const AT = ["0", "1", "2", "3"] as const;
// Each estimate with a clock that reads as it says: well inside, past it, none measured yet.
const ESTIMATES = {
  inside: { estimateMs: 5 * MIN, seconds: 80, code: "5 * 60_000" },
  past: { estimateMs: 2 * MIN, seconds: 4 * 60 + 44, code: "2 * 60_000" },
  unknown: { estimateMs: null, seconds: 5, code: "null" },
} as const;
const ESTIMATE_NAMES = ["inside", "past", "unknown"] as const satisfies ReadonlyArray<
  keyof typeof ESTIMATES
>;

const RESULT = "Cookbook is set up";
const CAUSE = "Giving it an address didn't finish. Zerops answered that the domain is taken.";
const DETAILS = "domainAlreadyInUse";

function viewOf(
  state: (typeof STATES)[number],
  action: boolean,
): { readonly view: ProgressView; readonly code: string | undefined } {
  if (state === "done") {
    return action
      ? {
          view: { state, result: RESULT, action: <Button size="sm">Open</Button> },
          code: `{ state: "done", result: "${RESULT}", action: <Button size="sm">Open</Button> }`,
        }
      : { view: { state, result: RESULT }, code: `{ state: "done", result: "${RESULT}" }` };
  }
  if (state === "failed") {
    return action
      ? {
          view: {
            state,
            cause: CAUSE,
            details: DETAILS,
            action: <Button size="sm">Try again</Button>,
          },
          code: `{\n    state: "failed",\n    cause: "${CAUSE}",\n    details: "${DETAILS}",\n    action: <Button size="sm">Try again</Button>,\n  }`,
        }
      : {
          view: { state, cause: CAUSE, details: DETAILS },
          code: `{ state: "failed", cause: "${CAUSE}", details: "${DETAILS}" }`,
        };
  }
  return { view: { state }, code: undefined };
}

/** A row on a clock of its own: started `seconds` before it mounted, ended there once it is over. */
function PlayedProgress({
  at,
  seconds,
  estimateMs,
  view,
}: {
  readonly at: number;
  readonly seconds: number;
  readonly estimateMs: number | null;
  readonly view: ProgressView;
}) {
  const running = view.state === "running";
  const nowMs = useSecondsNowMs(running);
  const [mountedAt] = useState(nowMs);
  return (
    <Progress
      at={at}
      endedAtMs={running ? null : mountedAt}
      estimateMs={estimateMs}
      label="Setting up Cookbook"
      nowMs={running ? nowMs : mountedAt}
      startedAtMs={mountedAt - seconds * 1000}
      steps={STEPS}
      view={view}
    />
  );
}

export default definePlayground({
  section: "progress",
  name: "Progress",
  imports: 'import { Progress } from "~/components/ui/progress";',
  controls: {
    state: { kind: "enum", options: STATES, note: "done becomes its result, failed says why" },
    at: { kind: "enum", options: AT, note: "the step it is on, from 0" },
    estimate: {
      kind: "enum",
      options: ESTIMATE_NAMES,
      note: "the measured usual duration, and how the clock reads against it",
    },
    action: { kind: "boolean", note: "once it ends: where to go next, or what fixes it" },
  },
  initial: { state: "running", at: "1", estimate: "inside", action: true },
  render: ({ state, at, estimate, action }) => {
    const { estimateMs, seconds } = ESTIMATES[estimate];
    return (
      <div className="w-120">
        <PlayedProgress
          at={Number(at)}
          estimateMs={estimateMs}
          // A new key restarts its clock and lets its bar start afresh.
          key={`${state}-${at}-${estimate}-${action}`}
          seconds={seconds}
          view={viewOf(state, action).view}
        />
      </div>
    );
  },
  jsx: ({ state, at, estimate, action }) =>
    jsxElement("Progress", {
      label: "Setting up Cookbook",
      steps: jsxCode(`[${STEPS.map((step) => `"${step}"`).join(", ")}]`),
      at: Number(at),
      startedAtMs: jsxCode("startedAtMs"),
      endedAtMs: state === "running" ? undefined : jsxCode("endedAtMs"),
      estimateMs: jsxCode(ESTIMATES[estimate].code),
      view: state === "running" ? undefined : jsxCode(viewOf(state, action).code ?? ""),
    }),
  usage: {
    do: [
      "Use it for a long operation with steps: one row whose words replace themselves in place.",
      "Give it the measured usual duration; the row says when it overruns it.",
      "End it as its result with where to go next, or say why it stopped and what fixes it.",
      "Put it on a StatusPage when the whole page waits on it.",
    ],
    dont: [
      "List the steps as they pass: the row says the one it is on.",
      "Move the bar back or guess a time the source does not give.",
      "Use it for a wait with no steps or end: that is a Spinner in its press.",
    ],
  },
});
