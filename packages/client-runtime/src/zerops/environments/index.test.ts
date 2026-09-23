import { describe, expect, it } from "vite-plus/test";

import * as environments from "./index.ts";

describe("@t3tools/client-runtime/zerops/environments", () => {
  it("exports the machine, its driver, the reachability projection and the interim container region", () => {
    expect(typeof environments.initialEnvironment).toBe("function");
    expect(typeof environments.makeExchangeDriver).toBe("function");
    expect(typeof environments.transitionEnvironment).toBe("function");
    expect(typeof environments.identityRestartOffered).toBe("function");
    expect(typeof environments.selectReachability).toBe("function");
    expect(typeof environments.reachabilityPhrase).toBe("function");
    expect(typeof environments.environmentLinkable).toBe("function");
    expect(typeof environments.interimContainerVerdict).toBe("function");
  });
});
