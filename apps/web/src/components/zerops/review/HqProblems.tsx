import { problemSaid } from "@t3tools/client-runtime/zerops/hq";
import type { HqProblem } from "@t3tools/shared/hqProblems";
import { TriangleAlertIcon } from "lucide-react";

/**
 * What HQ found, in both reviews: each finding one statement, then who acts next and how. Its
 * identifiers (where, rule, evidence) are a person's to quote, not to read first: they open under
 * *Details*.
 */
export function HqProblems({
  problems,
}: {
  readonly problems: ReadonlyArray<HqProblem> | undefined;
}) {
  if (problems === undefined || problems.length === 0) return null;
  return (
    <section aria-label="What HQ found">
      <ol className="rv-findings">
        {problems.map((problem, index) => {
          const said = problemSaid(problem);
          return (
            <li className="rv-finding" key={index}>
              <TriangleAlertIcon aria-hidden="true" />
              <p className="rv-finding-what">{said.what}</p>
              <p className="rv-finding-next">
                <span>Next, for {said.who}:</span> {said.action}
              </p>
              <details className="rv-finding-more">
                <summary>Details</summary>
                <dl>
                  <div>
                    <dt>Where</dt>
                    <dd>{said.where}</dd>
                  </div>
                  <div>
                    <dt>Rule</dt>
                    <dd>{said.rule}</dd>
                  </div>
                  {said.evidence === undefined ? null : (
                    <div>
                      <dt>Evidence</dt>
                      <dd>{said.evidence}</dd>
                    </div>
                  )}
                </dl>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
