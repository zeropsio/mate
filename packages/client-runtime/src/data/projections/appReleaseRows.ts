/** Release absence needs HQ's affirmative releases record; retained rows survive outages. */
import { flowReleaseOf, type FlowRelease } from "../../zerops/release.ts";
import type { Projection } from "../store.ts";
import { hqAppDetail, type HqAppKey } from "./hqAppDetail.ts";
import { sameValue } from "./equal.ts";
export type AppReleaseRows =
  | { readonly kind: "unread"; readonly reason: string | null }
  | {
      readonly kind: "known";
      readonly releases: ReadonlyArray<FlowRelease>;
      readonly live: boolean;
      readonly reason: string | null;
    };
export const appReleaseRows: Projection<HqAppKey, AppReleaseRows> = {
  name: "appReleaseRows",
  keyOf: hqAppDetail.keyOf,
  equals: sameValue,
  derive: (read, key) => {
    const detail = hqAppDetail.derive(read, key);
    const reason = detail.failure?.message ?? null;
    return detail.releases === undefined
      ? { kind: "unread", reason }
      : { kind: "known", releases: detail.releases.map(flowReleaseOf), live: detail.live, reason };
  },
};
