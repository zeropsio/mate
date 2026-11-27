import type { HqBirthDeletion } from "../../zerops/hq/client.ts";
import { hqBirthDeletionsScope } from "../families/hqBirthDeletion.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

/** One presentation and acknowledgement per outcome in this account's operation store. */
export const birthDeletionAcknowledgementId = (orgId: string, id: string) =>
  `birth-deletion/ack/${encodeURIComponent(orgId)}/${encodeURIComponent(id)}`;

export const birthDeletionOutcomes: Projection<string, ReadonlyArray<HqBirthDeletion>> = {
  name: "birthDeletionOutcomes",
  keyOf: (orgId) => orgId,
  equals: sameValue,
  derive: (read, orgId) =>
    read.members(hqBirthDeletionsScope(orgId)).ids.flatMap((id) => {
      const fact = read.fact("hqBirthDeletion", id);
      if (fact.kind !== "known" || read.operation(birthDeletionAcknowledgementId(orgId, id)))
        return [];
      const { outcome, operation } = fact.value;
      return outcome === "done" ||
        outcome === "unconfirmed_setup" ||
        (operation.failure !== undefined && operation.continueBy === undefined)
        ? [fact.value]
        : [];
    }),
};
