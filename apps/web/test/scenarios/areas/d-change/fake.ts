import type { ScenarioExtension, ScenarioDrivers } from "../../harness/scenario.ts";
import { MergeGate, changeTransport } from "../../fakes/d-change/transport.ts";

const gates = new WeakMap<ScenarioDrivers, MergeGate>();

export const installArea: ScenarioExtension = async (drivers) => {
  const merge = new MergeGate();
  gates.set(drivers, merge);
  const transport = await changeTransport(
    drivers.routes["https://hqzone.prg1-zerops.zone"]!,
    merge,
  );
  drivers.routes["https://hqzone.prg1-zerops.zone"] = transport.origin;
  drivers.cleanup.push(transport.close);
};

export function mergeFor(drivers: ScenarioDrivers) {
  const merge = gates.get(drivers);
  if (merge === undefined)
    throw new Error("Install the change area before using its merge control");
  return merge;
}
