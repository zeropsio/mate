import type { ScenarioExtension, ScenarioDrivers } from "../../harness/scenario.ts";
import { CreationFake } from "../../fakes/f-create/creation.ts";
import { MateFake } from "../../fakes/mate.ts";
import { replyLossProxy } from "../../fakes/f-create/replyLoss.ts";
import { serve } from "../../harness/http.ts";

const controls = new WeakMap<ScenarioDrivers, CreationFake>();
export const creationOf = (drivers: ScenarioDrivers) => {
  const control = controls.get(drivers);
  if (!control) throw new Error("Install f-create before using its driver");
  return control;
};

export const installCreation: ScenarioExtension = async (drivers) => {
  const creation = new CreationFake(drivers.zerops);
  controls.set(drivers, creation);
  drivers.zerops.handlers.push(creation.handle);
  const proxy = await replyLossProxy(drivers.zerops, creation);
  drivers.routes["https://api.app-prg1.zerops.io"] = proxy.origin;
  drivers.cleanup.push(proxy.close);
  // Predictable platform ids allow routes to be installed before any page opens.
  const mate = new MateFake("created-1", "Nova");
  for (const install of drivers.onMate) install(mate);
  drivers.mates.set("created-1", mate);
  const server = await serve(mate.handle, mate.socket);
  drivers.routes["https://zcp-created-1-8080.prg1.zerops.app"] = server.origin;
  drivers.cleanup.push(server.close);
};
