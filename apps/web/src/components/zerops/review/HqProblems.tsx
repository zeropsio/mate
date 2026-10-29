import { problemPresentation } from "@t3tools/client-runtime/zerops/hq";
import type { HqProblem } from "@t3tools/shared/hqProblems";
import { ReviewSection } from "./ZeropsReviewSurface";

/** Both reviews show the finding HQ supplied, including its concrete recovery. */
export function HqProblems({
  problems,
}: {
  readonly problems: ReadonlyArray<HqProblem> | undefined;
}) {
  if (problems === undefined || problems.length === 0) return null;
  return (
    <ReviewSection title="HQ findings">
      <ol>
        {problems.map((problem, index) => {
          const shown = problemPresentation(problem);
          return (
            <li key={index}>
              <p className="rv-words">{shown.what}</p>
              <dl>
                <div>
                  <dt>Where</dt>
                  <dd>{shown.where}</dd>
                </div>
                <div>
                  <dt>Rule</dt>
                  <dd>{shown.rule}</dd>
                </div>
                <div>
                  <dt>Next</dt>
                  <dd>{shown.next}</dd>
                </div>
                {shown.evidence === undefined ? null : (
                  <div>
                    <dt>Evidence</dt>
                    <dd>{shown.evidence}</dd>
                  </div>
                )}
              </dl>
            </li>
          );
        })}
      </ol>
    </ReviewSection>
  );
}
