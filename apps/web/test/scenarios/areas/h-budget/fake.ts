import type { ScenarioDrivers, ScenarioExtension } from "../../harness/scenario.ts";
import { observeTraffic } from "../../fakes/h-budget/traffic.ts";
import { deadline } from "../../harness/http.ts";
import { observeBrowserBudget } from "../../fakes/h-budget/browserBudget.ts";

export interface BudgetObservations {
  hq: Awaited<ReturnType<typeof observeTraffic>>;
  browser: Awaited<ReturnType<typeof observeBrowserBudget>>;
  mateHttp: Map<string, string[]>;
  mateReady: (name: string) => Promise<void>;
}

const observations = new WeakMap<ScenarioDrivers, BudgetObservations>();

export const installBudget: ScenarioExtension = async (drivers) => {
  const browser = await observeBrowserBudget(drivers.zerops);
  drivers.routes["https://api.app-prg1.zerops.io"] = browser.origin;
  drivers.routes["https://app.zerops.io"] = browser.origin;
  drivers.cleanup.push(browser.close);
  const origin = "https://hqzone.prg1-zerops.zone";
  const hq = await observeTraffic(drivers.routes[origin]!);
  drivers.routes[origin] = hq.origin;
  drivers.cleanup.push(hq.close);
  const mateHttp = new Map<string, string[]>();
  const connected = new Map<string, Promise<void>>();
  drivers.onMate.push((mate) => {
    let received = () => {};
    connected.set(
      mate.projectId,
      new Promise<void>((resolve) => {
        received = resolve;
      }),
    );
    mate.rpcHandlers.push(() => {
      received();
      return false;
    });
    const requests: string[] = [];
    mateHttp.set(mate.projectId, requests);
    const handle = mate.handle;
    mate.handle = (request) => {
      requests.push(`${request.method} ${request.url.pathname}`);
      return handle(request);
    };
  });
  observations.set(drivers, {
    hq,
    browser,
    mateHttp,
    mateReady: (name) => {
      const receipt = connected.get(name);
      if (!receipt) throw new Error(`No Mate fixture ${name}`);
      return deadline(receipt, `${name} first Mate RPC`);
    },
  });
};

export function budgetObservations(drivers: ScenarioDrivers) {
  const observation = observations.get(drivers);
  if (!observation) throw new Error("Install the budget extension before fixtures");
  return observation;
}
