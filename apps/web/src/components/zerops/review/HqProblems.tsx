import { problemSaid } from "@t3tools/client-runtime/zerops/hq";
import type { HqProblem } from "@t3tools/shared/hqProblems";
import { TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { FailureDetails } from "~/components/ui/failure";

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
      <ol className="m-0 grid list-none gap-2 p-0">
        {problems.map((problem, index) => {
          const said = problemSaid(problem);
          return (
            <li key={index}>
              <Alert
                controlAlignment="first-line"
                icon={<TriangleAlertIcon aria-hidden="true" />}
                role="group"
                surface="tint"
                variant="warning"
              >
                <AlertTitle>{said.what}</AlertTitle>
                <AlertDescription>
                  <p className="m-0">
                    <span className="text-foreground">Next, for {said.who}:</span> {said.action}
                  </p>
                  <FailureDetails
                    fields={[
                      { label: "Where", value: said.where },
                      { label: "Rule", value: said.rule },
                      ...(said.evidence === undefined
                        ? []
                        : [{ label: "Evidence", value: said.evidence }]),
                    ]}
                  />
                </AlertDescription>
              </Alert>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
