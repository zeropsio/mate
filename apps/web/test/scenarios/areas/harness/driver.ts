import type { ScenarioDrivers } from "../../harness/scenario.ts";

/** Receipts at the platform boundary distinguish Core HTTP from its in-memory test backend. */
export function platformIdentityWasRead(drivers: ScenarioDrivers, person: string) {
  const credential = person === "HQ" ? "hq" : `personal-${person}`;
  const request = person === "HQ" ? "GET /client/ORG/user/list" : "GET /user/info";
  return (drivers.zerops.requestsByCredential.get(credential)?.get(request) ?? 0) > 0;
}
