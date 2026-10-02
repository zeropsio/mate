import { describe, expect, it } from "vite-plus/test";

import * as forge from "./index.ts";

describe("@t3tools/client-runtime/zerops/forge", () => {
  it("exports the Gitea session machine, its projections and the account's sessions", () => {
    expect(typeof forge.makeGiteaSessions).toBe("function");
    expect(typeof forge.transitionGiteaSession).toBe("function");
    expect(typeof forge.giteaSessionView).toBe("function");
    expect(forge.GITEA_SIGNED_OUT).toEqual({
      signedIn: false,
      readable: false,
      login: undefined,
      trouble: null,
    });
  });
});
