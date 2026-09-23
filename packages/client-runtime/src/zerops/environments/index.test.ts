import { describe, expect, it } from "vite-plus/test";

import * as environments from "./index.ts";

describe("@t3tools/client-runtime/zerops/environments", () => {
  it("exports the machine, its driver, the reachability projection, the route gate and the interim regions", () => {
    expect(typeof environments.initialEnvironment).toBe("function");
    expect(typeof environments.makeExchangeDriver).toBe("function");
    expect(typeof environments.transitionEnvironment).toBe("function");
    expect(typeof environments.identityRestartOffered).toBe("function");
    expect(typeof environments.selectReachability).toBe("function");
    expect(typeof environments.reachabilityPhrase).toBe("function");
    expect(typeof environments.environmentLinkable).toBe("function");
    expect(typeof environments.interimContainerVerdict).toBe("function");
    expect(typeof environments.selectRouteGate).toBe("function");
    expect(typeof environments.routeGatePhrase).toBe("function");
    expect(typeof environments.interimReachability).toBe("function");
    expect(typeof environments.interimRouteTarget).toBe("function");
  });
});
