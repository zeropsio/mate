/** Only measured locations participate; missing samples supply no measured default. */
import type { ZeropsLocation } from "../../zerops/api.ts";
import { locationLatencyId } from "../families/locationLatency.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
export const regionRecommendation: Projection<
  {
    readonly orgId: string;
    readonly locations: ReadonlyArray<ZeropsLocation>;
  },
  string | null
> = {
  name: "regionRecommendation",
  keyOf: (key) => JSON.stringify(key),
  equals: sameValue,
  derive: (read, { orgId, locations }) => {
    let fastest: { id: string; latency: number } | null = null;
    for (const location of locations) {
      const sample = read.fact("locationLatency", locationLatencyId(orgId, location));
      if (sample.kind !== "known") continue;
      if (fastest === null || sample.value.latencyMs < fastest.latency)
        fastest = { id: location.id, latency: sample.value.latencyMs };
    }
    return fastest?.id ?? null;
  },
};
