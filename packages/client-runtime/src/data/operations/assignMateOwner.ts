/**
 * Handing a Mate over, at Zerops (guide 0.8, D11): a transfer — a Mate has one OWNER (F23). The
 * person picked is made its OWNER; then whoever else the project names OWNER, as Zerops answers
 * that write, has it taken off theirs. A refusal of the first write changed nothing; one of a later
 * write ends it failed, the person picked holding it beside its previous owner. The project's row
 * naming the person picked as its one OWNER reflects it and, after a lost answer, adopts it.
 *
 * @module data/operations/assignMateOwner
 */
import type { OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "assign-mate-owner": {
      readonly orgId: string;
      readonly projectId: string;
      /** The `clientUser` id of the person it is handed to. */
      readonly clientUserId: string;
    };
  }
}

export const assignMateOwner: OperationKind<"assign-mate-owner"> = {
  kind: "assign-mate-owner",
  executor: "zerops",
  ...shownInFacts(
    (intent) => intent.projectId,
    (read, intent) => {
      const project = read.fact("project", intent.projectId);
      if (project.kind !== "known") return false;
      const owners = (project.value.userRoles ?? []).filter((role) => role.roleCode === "OWNER");
      return owners.length === 1 && owners[0]!.clientUserId === intent.clientUserId;
    },
  ),
};
