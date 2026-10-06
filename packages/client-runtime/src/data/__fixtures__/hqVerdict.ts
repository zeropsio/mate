/** The account's verdict on an organization's HQ, put into its store as `observeAccount` holds it. */
import { hqVerdictScope, type HqVerdict } from "../families/hqVerdict.ts";
import type { AccountStore } from "../store.ts";

let revisions = 0;

export function seedHqVerdict(store: AccountStore, orgId: string, verdict: HqVerdict): void {
  store.dispatch({
    kind: "baseline-commit",
    scope: hqVerdictScope(orgId),
    generation: 0,
    via: "zerops-read",
    members: [orgId],
    rows: [
      {
        family: "hqVerdict",
        id: orgId,
        value: { verdict },
        revision: { kind: "zerops", version: (revisions += 1) },
      },
    ],
  });
}
