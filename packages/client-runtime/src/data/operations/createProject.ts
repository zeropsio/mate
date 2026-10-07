/**
 * Creating a project, at Zerops: `POST /client/{id}/project` answers with the project, whose id is
 * the operation's handle and its result. The project's `project.create` process says how it ended —
 * read in the project's process history, held from acceptance until then. No clock decides that
 * Zerops did not confirm it.
 *
 * @module data/operations/createProject
 */
import type { OperationReceipt } from "../model.ts";
import { projectCreations } from "../projections/creation.ts";
import {
  projectCreationFailureSentence,
  projectCreationOutcome,
} from "../../zerops/projectCreation.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "create-project": {
      /** The organization it is made in, whose link observes it. */
      readonly orgId: string;
      readonly name: string;
      readonly tagList: ReadonlyArray<string>;
      readonly location?: string;
    };
  }
  interface OperationResults {
    readonly "create-project": { readonly projectId: string };
  }
}

const projectOf = (receipt: OperationReceipt) => receipt.handles[0] ?? "";

export const createProject: OperationKind<"create-project"> = {
  kind: "create-project",
  executor: "zerops",
  reflected: (read, _intent, receipt) => read.fact("project", projectOf(receipt)).kind === "known",
  settledBy: (read, intent, receipt) => {
    const projectId = projectOf(receipt);
    const outcome = projectCreationOutcome(
      projectCreations.derive(read, { orgId: intent.orgId, projectIds: [projectId] })[projectId],
    );
    if (outcome.kind === "running") return null;
    return outcome.kind === "finished"
      ? { kind: "succeeded" }
      : { kind: "failed", reason: projectCreationFailureSentence(outcome) };
  },
  observedIn: (intent, receipt) =>
    receipt.handles.length === 0
      ? null
      : { family: "process", listing: "history", ownerId: projectOf(receipt) },
};
