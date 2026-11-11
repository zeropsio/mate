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

/** Who HQ says acts next, as a person reads it; an actor HQ adds later keeps HQ's own word. */
const NEXT_ACTOR: Readonly<Record<string, string>> = {
  person: "you",
  "application-mate": "a Mate of this project",
  author: "the change's author",
  administrator: "an administrator",
  "hq-operator": "whoever runs HQ",
  hq: "HQ",
};

/**
 * HQ's finding as its review says it: what is wrong, then who acts next and how, each once. Its
 * identifiers (where, rule, evidence) are the same `problemPresentation` gives, kept for whoever
 * needs to quote them and shown folded.
 */
export function problemSaid(problem: HqProblem) {
  const shown = problemPresentation(problem);
  const { next } = problem;
  return {
    what: problem.what,
    who: NEXT_ACTOR[next.actor] ?? next.actor,
    action: `${next.action}${next.target === undefined ? "" : ` (${next.target})`}`,
    where: shown.where,
    rule: shown.rule,
    evidence: shown.evidence,
  };
}

/**
 * HQ's open findings that a service stop it asked for in this Zerops project is not confirmed. Each
 * stands until HQ's next verdict on the same rollout replaces it; none says the service stopped.
 */
export function unverifiedStops(
  problems: ReadonlyArray<HqProblem> | undefined,
  projectId: string,
): ReadonlyArray<HqProblem> {
  return (problems ?? []).filter(
    ({ code, where }) => code === "service_stop_unverified" && where.projectId === projectId,
  );
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
