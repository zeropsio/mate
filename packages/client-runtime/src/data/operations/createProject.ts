/**
 * Creating a project, at Zerops: `POST /client/{id}/project` answers with the project, whose id is
 * the operation's handle and its result. The project's `project.create` process says how it ended —
 * read in the project's process history, held from acceptance until then. No clock decides that
 * Zerops did not confirm it.
 *
 * @module data/operations/createProject
 */
import type { ProcessValue } from "../families/process.ts";
import { projectsScope } from "../families/project.ts";
import type { OperationReceipt } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import {
  PROJECT_CREATE_ACTION,
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

/** The project's newest `project.create` process the account holds; `undefined` before one. */
function creationOf(read: ProjectionReads, projectId: string): ProcessValue | undefined {
  let newest: ProcessValue | undefined;
  for (const id of read.index("project", projectId)) {
    const fact = read.fact("process", id);
    if (fact.kind !== "known" || fact.value.actionName !== PROJECT_CREATE_ACTION) continue;
    if (newest === undefined || fact.value.created > newest.created) newest = fact.value;
  }
  return newest;
}

export const createProject: OperationKind<"create-project"> = {
  kind: "create-project",
  executor: "zerops",
  reflected: (read, _intent, receipt) => read.fact("project", projectOf(receipt)).kind === "known",
  settledBy: (read, _intent, receipt) => {
    const process = creationOf(read, projectOf(receipt));
    if (process === undefined) return null;
    const outcome = projectCreationOutcome({
      processId: process.id,
      status: process.status,
      error: process.error ?? null,
    });
    if (outcome.kind === "running") return null;
    return outcome.kind === "finished"
      ? { kind: "succeeded" }
      : { kind: "failed", reason: projectCreationFailureSentence(outcome) };
  },
  observedIn: (intent, receipt) =>
    receipt.handles.length === 0
      ? null
      : { family: "process", listing: "history", ownerId: projectOf(receipt) },
  // After a lost answer: a project of its name in the organization; one already there at the send
  // is never it.
  effectHandles: (read, intent) => {
    // Only a wholly read listing says which projects were there before the send.
    const listed = read.members(projectsScope(intent.orgId));
    if (listed.coverage !== "complete") return null;
    return listed.ids.filter((id) => {
      const project = read.fact("project", id);
      return project.kind === "known" && project.value.name === intent.name;
    });
  },
  adoptedResult: (projectId) => ({ projectId }),
};
