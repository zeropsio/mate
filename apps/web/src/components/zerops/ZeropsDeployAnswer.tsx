/**
 * What HQ answered of the deploys a verb asked for (`deployAnswerSaid`): said where the verb was
 * pressed — a merge's review, a release's, a stop's Run again — at once, by environment, before
 * HQ's stream brings the jobs to their rows.
 */
import type { ReviewPress } from "@t3tools/client-runtime/zerops";
import { deployAnswerSaid } from "@t3tools/client-runtime/zerops/hq";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import type { ReactNode } from "react";

export function ZeropsDeployAnswer({ answer }: { readonly answer: HqDeployAnswer }) {
  const said = deployAnswerSaid(answer);
  if (said.environments.length === 0 && said.note === undefined) return null;
  return (
    <div
      className="flex flex-col gap-1 text-xs leading-4 text-muted-foreground"
      data-zerops-surface="deploy-answer"
    >
      {said.environments.map(({ environment, jobs }) => (
        <p key={environment}>
          <span className="text-foreground">{environment}</span>
          {jobs.map((job, index) => (
            <span data-zerops-job-state={job.state} key={`${String(index)} ${job.text}`}>
              {" · "}
              {job.text}
            </span>
          ))}
        </p>
      ))}
      {said.note === undefined ? null : <p>{said.note}</p>}
    </div>
  );
}

/** What a press that is done says of its deploys, where HQ answered them; nothing else. */
export function answeredDeploys(press: ReviewPress): ReactNode {
  return press.kind === "done" && press.deploys !== undefined ? (
    <ZeropsDeployAnswer answer={press.deploys} />
  ) : undefined;
}
