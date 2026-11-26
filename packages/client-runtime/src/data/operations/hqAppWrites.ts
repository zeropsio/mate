/** HQ owns answers to kept-code questions and their reflection in facts. */
import type { KeptGitAnswer } from "@t3tools/contracts";
import { removedForViewer } from "../model.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "answer-kept-git": {
      readonly orgId: string;
      readonly appId: string;
      readonly answer: KeptGitAnswer["answer"];
    };
  }
}

export const answerKeptGit: OperationKind<"answer-kept-git"> = {
  kind: "answer-kept-git",
  executor: "hq",
  // Closing the question also happens when an application gains a project. Its removal
  // reflects an accepted answer, but cannot recover which answer a lost receipt accepted.
  reflected: (read, intent) => removedForViewer(read.fact("hqKeptGit", intent.appId)),
};
