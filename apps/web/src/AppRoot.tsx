import { useEffect } from "react";
import { ZeropsEnvironmentLifetime } from "./zerops/ZeropsEnvironmentLifetime";
import { ZeropsInventoryProvider } from "./zerops/ZeropsInventoryProvider";
import { ZEROPS_HANDOVER_CALLBACK_PATH } from "@t3tools/client-runtime/zerops/handover";
import { ZeropsHostedLanding } from "./components/zerops/landing/ZeropsHostedLanding";
import { appBasePath } from "./basePath";
import { RouterProvider } from "@tanstack/react-router";

import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";
import {
  ZeropsSessionProvider,
  type ZeropsSessionStatus,
  useZeropsSession,
} from "./zerops/ZeropsSessionProvider";

export function ZeropsProductHosts({ status }: { readonly status: ZeropsSessionStatus }) {
  if (status !== "signed-in") return null;

  return <QuitHoldOverlay />;
}

function AccountProductBoundary({ router }: { readonly router: AppRouter }) {
  const { status, user } = useZeropsSession();
  useEffect(() => {
    if (window.location.pathname.replace(/\/$/, "") === `${appBasePath()}/pair`) {
      window.history.replaceState(null, "", `${appBasePath()}/zerops`);
    }
  }, []);
  const callback = window.location.pathname === `${appBasePath()}${ZEROPS_HANDOVER_CALLBACK_PATH}`;
  if (status !== "signed-in" && !callback) {
    return <ZeropsHostedLanding />;
  }
  return (
    <AppAtomRegistryProvider key={user?.id ?? "handover"}>
      {callback ? (
        <RouterProvider router={router} />
      ) : (
        <ZeropsInventoryProvider>
          <ZeropsEnvironmentLifetime>
            <RouterProvider router={router} />
            <ZeropsProductHosts status={status} />
          </ZeropsEnvironmentLifetime>
        </ZeropsInventoryProvider>
      )}
    </AppAtomRegistryProvider>
  );
}

/** No route loader or connection runtime exists before account verification. */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <ZeropsSessionProvider>
      <AccountProductBoundary router={router} />
    </ZeropsSessionProvider>
  );
}
