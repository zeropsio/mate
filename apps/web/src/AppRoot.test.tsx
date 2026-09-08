import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";

import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import type { AppRouter } from "./router";
import { ZeropsSessionProvider } from "./zerops/ZeropsSessionProvider";
import { ZeropsDataProvider } from "./zerops/ZeropsDataProvider";
import { ZeropsInventoryProvider } from "./zerops/ZeropsInventoryProvider";
import { AppRoot, ZeropsAccountDataBoundary, ZeropsProductHosts } from "./AppRoot";

function childrenOf(node: unknown): ReadonlyArray<ReactNode> {
  return isValidElement(node)
    ? Children.toArray((node as ReactElement<{ readonly children: ReactNode }>).props.children)
    : [];
}

describe("AppRoot", () => {
  it("keeps the Zerops account session around routed UI and renderer-wide hosts", () => {
    const root = AppRoot({ router: {} as AppRouter });

    expect(root.type).toBe(ZeropsSessionProvider);
    expect(childrenOf(root)).toHaveLength(1);
  });

  it.each(["loading", "unavailable", "signed-out", "totp-required"] as const)(
    "mounts no renderer-wide product host while the account is %s",
    (status) => {
      expect(ZeropsProductHosts({ status })).toBeNull();
    },
  );

  it("mounts the renderer-wide product host only after account sign-in", () => {
    const host = ZeropsProductHosts({ status: "signed-in" });

    expect(isValidElement(host) && host.type).toBe(QuitHoldOverlay);
  });

  it("mounts the account runtime before inventory consumers", () => {
    const boundary = ZeropsAccountDataBoundary({ children: "product" });
    expect(boundary.type).toBe(ZeropsDataProvider);
    const inventory = childrenOf(boundary)[0];
    expect(isValidElement(inventory) && inventory.type).toBe(ZeropsInventoryProvider);
  });
});
