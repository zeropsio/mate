import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";

import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { RenderErrorBoundary } from "./components/RenderErrorBoundary";
import { ZeropsAppFailed } from "./components/zerops/landing/ZeropsAppFailed";
import type { AppRouter } from "./router";
import { ZeropsSessionProvider } from "./zerops/ZeropsSessionProvider";
import { ZeropsAccountEnvironmentProvider } from "./zerops/ZeropsAccountEnvironmentProvider";
import { ZeropsInventoryProvider } from "./zerops/ZeropsInventoryProvider";
import { ZeropsHqNavigation } from "./zerops/hqNavigation";
import { AppRoot, ZeropsAccountDataBoundary, ZeropsProductHosts } from "./AppRoot";

function childrenOf(node: unknown): ReadonlyArray<ReactNode> {
  return isValidElement(node)
    ? Children.toArray((node as ReactElement<{ readonly children: ReactNode }>).props.children)
    : [];
}

describe("AppRoot", () => {
  it("keeps the Zerops account session around routed UI and renderer-wide hosts", () => {
    const root = AppRoot({ router: {} as AppRouter });
    const session = childrenOf(root)[0];

    expect(isValidElement(session) && session.type).toBe(ZeropsSessionProvider);
    expect(childrenOf(session)).toHaveLength(1);
  });

  it("says the app could not open when anything above the router throws", () => {
    const root = AppRoot({ router: {} as AppRouter });
    const { fallback } = root.props as { readonly fallback: ReactNode };

    expect(root.type).toBe(RenderErrorBoundary);
    expect(isValidElement(fallback) && fallback.type).toBe(ZeropsAppFailed);
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

  it("starts HQ before runtime admission and inventory", () => {
    const boundary = ZeropsAccountDataBoundary({ children: "product" });
    expect(boundary.type).toBe(ZeropsAccountEnvironmentProvider);
    const parts = childrenOf(boundary);
    expect(isValidElement(parts[0]) && parts[0].type).toBe(ZeropsHqNavigation);
    const inventory = parts[1];
    expect(isValidElement(inventory) && inventory.type).toBe(ZeropsInventoryProvider);
    expect(childrenOf(inventory)).toEqual(["product"]);
  });
});
