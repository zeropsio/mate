import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  configureZeropsGui,
  serviceDashboardUrl,
  zeropsProjectUrl,
  zeropsTokenManagementUrl,
} from "./gui.ts";
import { buildZeropsAuthorizeUrl } from "./handover.ts";

afterEach(() => configureZeropsGui(undefined));

describe("the Zerops GUI a build links to", () => {
  it("links to app.zerops.io when the build names no Zerops app", () => {
    expect(zeropsProjectUrl("p1")).toBe("https://app.zerops.io/project/p1");
    expect(serviceDashboardUrl("s1")).toBe("https://app.zerops.io/service-stack/s1");
  });

  it("sends every Zerops link and the sign-in hand-over to the Zerops app the build names", () => {
    configureZeropsGui("https://gui.alpha.example/");
    expect(zeropsProjectUrl("p1")).toBe("https://gui.alpha.example/project/p1");
    expect(serviceDashboardUrl("s1")).toBe("https://gui.alpha.example/service-stack/s1");
    expect(zeropsTokenManagementUrl()).toBe("https://gui.alpha.example/settings/token-management");
    const authorize = new URL(
      buildZeropsAuthorizeUrl({ nonce: "n", origin: "https://web.example", path: "" }),
    );
    expect(authorize.origin).toBe("https://gui.alpha.example");
  });
});
