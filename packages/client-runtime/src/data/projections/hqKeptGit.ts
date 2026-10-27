import type { KeptGitQuestion } from "@t3tools/contracts";
import { hqKeptGitScope, keptGitRequestId } from "../families/hqKeptGit.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { operationProgress } from "./operation.ts";

export interface KeptGitQuestionView {
  readonly question: KeptGitQuestion;
  readonly requestId: string;
  readonly pending: boolean;
  readonly message: string | null;
}
export const hqKeptGitQuestions: Projection<string, ReadonlyArray<KeptGitQuestionView>> = {
  name: "hqKeptGitQuestions",
  keyOf: (orgId) => orgId,
  equals: sameValue,
  derive: (read, orgId) =>
    read.members(hqKeptGitScope(orgId)).ids.flatMap((id) => {
      const fact = read.fact("hqKeptGit", id);
      if (fact.kind !== "known") return [];
      const question = fact.value;
      let attempt = 1;
      while (read.operation(keptGitRequestId(orgId, question, attempt)) !== undefined) attempt++;
      const previousId = keptGitRequestId(orgId, question, attempt - 1);
      const progress = attempt === 1 ? null : operationProgress.derive(read, previousId);
      const retryable = progress?.stage === "refused" || progress?.stage === "unsent";
      const pending = progress !== null && !retryable;
      return [
        {
          question,
          requestId: pending ? previousId : keptGitRequestId(orgId, question, attempt),
          pending,
          message:
            progress === null
              ? null
              : retryable
                ? (progress.reason ?? "HQ did not take this answer.")
                : progress.stage === "uncertain" || progress.stage === "unresolved"
                  ? "HQ has not confirmed your answer."
                  : progress.stage === "done"
                    ? "Answer sent. Waiting for HQ to close this question."
                    : "Sending your answer…",
        },
      ];
    }),
};
