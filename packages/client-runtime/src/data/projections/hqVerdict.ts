import type { HqVerdict } from "../families/hqVerdict.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

/** Whether the organization has an official HQ, as the account decided it; pending until it did. */
export const hqVerdict: Projection<string, HqVerdict> = {
  name: "hqVerdict",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const fact = read.fact("hqVerdict", orgId);
    return fact.kind === "known" ? fact.value.verdict : "pending";
  },
  equals: sameValue,
};
