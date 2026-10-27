import type { ScenarioExtension, ScenarioDrivers } from "../../harness/scenario.ts";
import { MergeGate, HqFrameHold, changeTransport } from "../../fakes/d-change/transport.ts";

const gates = new WeakMap<ScenarioDrivers, { merge: MergeGate; hqFrames: HqFrameHold }>();

export const installArea: ScenarioExtension = async (drivers) => {
  const merge = new MergeGate();
  const hqFrames = new HqFrameHold();
  gates.set(drivers, { merge, hqFrames });
  const transport = await changeTransport(
    drivers.routes["https://hqzone.prg1-zerops.zone"]!,
    merge,
    hqFrames,
  );
  drivers.routes["https://hqzone.prg1-zerops.zone"] = transport.origin;
  drivers.cleanup.push(transport.close);
};

export function mergeFor(drivers: ScenarioDrivers) {
  const merge = gates.get(drivers);
  if (merge === undefined)
    throw new Error("Install the change area before using its merge control");
  return merge.merge;
}

export function hqFramesFor(drivers: ScenarioDrivers) {
  const controls = gates.get(drivers);
  if (controls === undefined) throw new Error("Install the change area before holding HQ frames");
  return controls.hqFrames;
}
