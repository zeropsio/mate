/**
 * Handing a Mate over, at Zerops (guide 0.8, D11): a transfer — a Mate has one OWNER (F23). The
 * person picked is made its OWNER; then whoever else the project names OWNER, as Zerops answers
 * that write, has it taken off theirs. A first write whose answer was lost is resolved by reading
 * the project before anything else is written. A before-send refusal changed nothing; a refusal
 * of a later write retains the original previous owners for deliberate Finish hand-over. A lost
 * later answer remains unresolved unless a read proves it landed. Recovery never assigns the
 * chosen owner again or removes a newly added owner. The single OWNER row reflects completion.
 *
 * @module data/operations/assignMateOwner
 */
import type { OperationKind } from "./kind.ts";
import type { ProjectionReads } from "../store.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "assign-mate-owner": {
      readonly orgId: string;
      readonly projectId: string;
      /** The `clientUser` id of the person it is handed to. */
      readonly clientUserId: string;
    };
    readonly "finish-mate-handover": {
      readonly orgId: string;
      readonly projectId: string;
      readonly clientUserId: string;
      /** Only the previous owners named by the original accepted assignment. */
      readonly previousOwnerIds: ReadonlyArray<string>;
    };
  }
  interface OperationResults {
    readonly "assign-mate-owner": { readonly previousOwnerIds: ReadonlyArray<string> };
    readonly "finish-mate-handover": { readonly previousOwnerIds: ReadonlyArray<string> };
  }
}

const singleOwnerShown = (
  read: ProjectionReads,
  intent: { readonly projectId: string; readonly clientUserId: string },
) => {
  const project = read.fact("project", intent.projectId);
  if (project.kind !== "known") return false;
  const owners = (project.value.userRoles ?? []).filter((role) => role.roleCode === "OWNER");
  return owners.length === 1 && owners[0]!.clientUserId === intent.clientUserId;
};

export const assignMateOwner: OperationKind<"assign-mate-owner"> = {
  kind: "assign-mate-owner",
  executor: "zerops",
  reflected: singleOwnerShown,
  settledBy: (read, intent) => (singleOwnerShown(read, intent) ? { kind: "succeeded" } : null),
  observedIn: (intent) => ({ family: "project", listing: "project", ownerId: intent.projectId }),
};

export const finishMateHandover: OperationKind<"finish-mate-handover"> = {
  kind: "finish-mate-handover",
  executor: "zerops",
  reflected: singleOwnerShown,
  settledBy: (read, intent) => (singleOwnerShown(read, intent) ? { kind: "succeeded" } : null),
  observedIn: (intent) => ({ family: "project", listing: "project", ownerId: intent.projectId }),
};
