/** The locations a New project offers, each with this browser's latency to it once its sample is in. */
import type { ZeropsLocation } from "../../zerops/api/account.ts";
import { locationLatencyId } from "../families/locationLatency.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface LocationChoice {
  readonly id: string;
  readonly name: string;
  /** Whole milliseconds, measured from this browser; absent while unmeasured or unmeasurable. */
  readonly latencyMs?: number;
}

export const locationChoices: Projection<
  {
    readonly orgId: string;
    readonly locations: ReadonlyArray<ZeropsLocation>;
  },
  ReadonlyArray<LocationChoice>
> = {
  name: "locationChoices",
  keyOf: (key) => JSON.stringify(key),
  equals: sameValue,
  derive: (read, { orgId, locations }) =>
    locations.map((location) => {
      const sample = read.fact("locationLatency", locationLatencyId(orgId, location));
      return sample.kind === "known"
        ? { id: location.id, name: location.name, latencyMs: Math.round(sample.value.latencyMs) }
        : { id: location.id, name: location.name };
    }),
};
