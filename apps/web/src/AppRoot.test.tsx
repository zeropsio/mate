import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { PreviewAutomationHosts } from "./components/preview/PreviewAutomationHosts";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";
import { ZeropsSessionProvider } from "./zerops/ZeropsSessionProvider";
import { AppRoot, ZeropsProductHosts } from "./AppRoot";

function childrenOf(node: unknown): ReadonlyArray<ReactNode> {
  return isValidElement(node)
    ? Children.toArray((node as ReactElement<{ readonly children: ReactNode }>).props.children)
    : [];
}

describe("AppRoot", () => {
  it("keeps the Zerops account session around routed UI and renderer-wide hosts", () => {
    const root = AppRoot({ router: {} as AppRouter });

    expect(root.type).toBe(AppAtomRegistryProvider);
    const children = childrenOf(root);
    expect(children).toHaveLength(1);
    expect(isValidElement(children[0]) && children[0].type).toBe(ZeropsSessionProvider);
  });

  it("keeps the router and the signed-in host gate inside the session boundary", () => {
    const routed = childrenOf(childrenOf(AppRoot({ router: {} as AppRouter }))[0]);

    expect(routed).toHaveLength(2);
    expect(isValidElement(routed[0]) && routed[0].type).toBe(RouterProvider);
  });

  it.each(["loading", "signed-out", "totp-required"] as const)(
    "mounts no renderer-wide product host while the account is %s",
    (status) => {
      expect(ZeropsProductHosts({ status })).toBeNull();
    },
  );

  it("mounts every renderer-wide product host only after account sign-in", () => {
    const hosts = childrenOf(ZeropsProductHosts({ status: "signed-in" }));

    expect(hosts).toHaveLength(3);
    expect(isValidElement(hosts[0]) && hosts[0].type).toBe(PreviewAutomationHosts);
    expect(isValidElement(hosts[1]) && hosts[1].type).toBe(ElectronBrowserHost);
    expect(isValidElement(hosts[2]) && hosts[2].type).toBe(QuitHoldOverlay);
  });
});
