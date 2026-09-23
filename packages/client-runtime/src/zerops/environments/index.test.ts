import { describe, expect, it } from "vite-plus/test";

import * as environments from "./index.ts";

describe("@t3tools/client-runtime/zerops/environments", () => {
  it("exports the machines, their stores and driver, the reachability projection, the route gate, the registration records and the interim container region", () => {
    expect(typeof environments.initialEnvironment).toBe("function");
    expect(typeof environments.makeExchangeDriver).toBe("function");
    expect(typeof environments.transitionEnvironment).toBe("function");
    expect(typeof environments.identityRestartOffered).toBe("function");
    expect(typeof environments.selectReachability).toBe("function");
    expect(typeof environments.reachabilityPhrase).toBe("function");
    expect(typeof environments.environmentLinkable).toBe("function");
    expect(typeof environments.interimContainerVerdict).toBe("function");
    expect(typeof environments.transitionContainer).toBe("function");
    expect(typeof environments.makeContainerStore).toBe("function");
    expect(typeof environments.bindContainerStore).toBe("function");
    expect(typeof environments.makeProbeStore).toBe("function");
    expect(typeof environments.selectRouteGate).toBe("function");
    expect(typeof environments.routeGatePhrase).toBe("function");
    expect(typeof environments.makeRegistrationRecords).toBe("function");
  });
});
