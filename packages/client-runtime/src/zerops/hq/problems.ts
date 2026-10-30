import type { HqProblem } from "@t3tools/shared/hqProblems";
import type { ReviewFix } from "../reviewVerdict.ts";

/** Render HQ's finding without deriving a second classification or remedy. */
export function problemPresentation(problem: HqProblem) {
  const { where, rule, next, evidence } = problem;
  return {
    what: problem.what,
    where: Object.entries(where)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(" · "),
    rule: [
      rule.source,
      rule.code,
      rule.schemaPath,
      rule.instancePath,
      rule.schemaUrl,
      rule.schemaDigest,
    ]
      .filter((value) => value !== undefined)
      .join(" · "),
    next: `${next.actor}: ${next.action}${next.target === undefined ? "" : ` (${next.target})`}`,
    evidence:
      evidence === undefined
        ? undefined
        : Object.entries(evidence)
            .map(([key, value]) => `${key}: ${value}`)
            .join(" · "),
  };
}

/** The fix composer receives the same findings the person can read. */
export function problemsFix(problems: ReadonlyArray<HqProblem>): ReviewFix | undefined {
  if (problems.length === 0) return undefined;
  return {
    verb: "address it",
    problem: {
      what: problems.map((problem) => problem.what).join("\n"),
      ask: problems.map((problem) => problemPresentation(problem).next).join("\n"),
      problems,
    },
  };
}
