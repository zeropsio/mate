import { expect, it } from "vite-plus/test";
import { invalidCiSteps } from "./gate-changed.ts";

// witness: scripts/gate-changed.ts | if (step.run === undefined) return []; → if (step.run !== undefined) return [];
it("GA+1: A required CI job cannot run a command outside the landing gate's stage table", () => {
  const workflow = `jobs:
  check:
    steps:
      - name: Stage
        run: node scripts/gate-changed.ts --stage files
      - name: Rogue check
        run: echo unchecked
  check_types:
    steps: []
  check_build:
    steps: []
  check_guards:
    steps: []
  t1:
    steps: []
`;
  expect(invalidCiSteps(workflow)).toEqual(["check: Rogue check"]);
});
