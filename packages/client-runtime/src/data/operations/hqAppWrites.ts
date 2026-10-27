/** HQ owns application names and deletion; its answer or its explicit facts decide the end. */
import type { KeptGitAnswer } from "@t3tools/contracts";
import type { OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "rename-app": {
      readonly orgId: string;
      readonly appId: string;
      readonly name: string;
    };
    readonly "answer-kept-git": {
      readonly orgId: string;
      readonly appId: string;
      readonly answer: KeptGitAnswer["answer"];
    };
    readonly "delete-app": {
      readonly orgId: string;
      readonly appId: string;
      /** The person's dialog listed the application's code: it goes too (HQ `?with=code`). */
      readonly withCode?: boolean;
    };
  }
}

export const renameApp: OperationKind<"rename-app"> = {
  kind: "rename-app",
  executor: "hq",
  ...shownInFacts(
    (intent) => intent.appId,
    (read, intent) => {
      const app = read.fact("hqApp", intent.appId);
      return app.kind === "known" && app.value.name === intent.name.trim();
    },
  ),
};
export const deleteApp: OperationKind<"delete-app"> = {
  kind: "delete-app",
  executor: "hq",
  ...shownInFacts(
    (intent) => intent.appId,
    (read, intent) => read.fact("hqApp", intent.appId).kind === "deleted",
  ),
};

export const answerKeptGit: OperationKind<"answer-kept-git"> = {
  kind: "answer-kept-git",
  executor: "hq",
  // Closing the question also happens when an application gains a project. Its removal
  // reflects an accepted answer, but cannot recover which answer a lost receipt accepted.
  reflected: (read, intent) => {
    const question = read.fact("hqKeptGit", intent.appId);
    return (
      question.kind === "deleted" || (question.kind === "withheld" && question.reason === "denied")
    );
  },
};
