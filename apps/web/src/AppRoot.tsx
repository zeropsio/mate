import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { ZeropsAccountData } from "./zerops/ZeropsAccountData";
import { ZeropsAccountEnvironmentProvider } from "./zerops/ZeropsAccountEnvironmentProvider";
import { ZeropsInventoryProvider } from "./zerops/ZeropsInventoryProvider";
import { ZeropsMenuPreview } from "./zerops/useMenuRows";
import { ZeropsHqNavigation } from "./zerops/hqNavigation";
import { ZeropsHostedLanding } from "./components/zerops/landing/ZeropsHostedLanding";
import { zeropsSignInMode } from "./zerops/deviceLogin";
import { driveZeropsHqSignIn } from "./zerops/hqSignIn";
import { appBasePath } from "./basePath";
import { resolveZeropsAccountGate } from "./routes/-accountGate";
import { RouterProvider } from "@tanstack/react-router";

import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { RenderErrorBoundary } from "./components/RenderErrorBoundary";
import { ZeropsAppFailed } from "./components/zerops/landing/ZeropsAppFailed";
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

/**
 * The verified account's platform-data owner precedes every inventory consumer; beside the
 * product, the organization's structure from its HQ, which places the inventory's projects.
 */
export function ZeropsAccountDataBoundary({ children }: { readonly children: ReactNode }) {
  return (
    <ZeropsAccountEnvironmentProvider pending={<ZeropsMenuPreview />}>
      <ZeropsHqNavigation />
      <ZeropsInventoryProvider>{children}</ZeropsInventoryProvider>
    </ZeropsAccountEnvironmentProvider>
  );
}

function AccountProductBoundary({ router }: { readonly router: AppRouter }) {
  const { status, user, client, adoptDeviceLogin } = useZeropsSession();
  // A trip through HQ from its Mate card settles with the session check (`hqSignIn.ts`): it runs for
  // a signed-out tab of a device-login build, and is spent unrun any other way.
  useEffect(() => {
    if (status === "loading") return;
    driveZeropsHqSignIn(
      status === "signed-out" && zeropsSignInMode() === "device-login"
        ? { apiBase: client.baseUrl, adopt: adoptDeviceLogin }
        : null,
    );
  }, [adoptDeviceLogin, client, status]);
  useEffect(() => {
    if (window.location.pathname.replace(/\/$/, "") === `${appBasePath()}/pair`) {
      window.history.replaceState(null, "", `${appBasePath()}/zerops`);
    }
  }, []);
  // The route the hand-over returned to, followed as it changes: a sign-in completes there and
  // opens the account in place once it routes on.
  const pathname = useSyncExternalStore(
    useCallback((changed: () => void) => router.history.subscribe(changed), [router]),
    () => router.history.location.pathname,
  );
  // The hand-over's callback and the component kit route with no account data beneath them.
  const preAccount =
    resolveZeropsAccountGate({ pathname: pathname.slice(appBasePath().length), status }) ===
    "pre-account";
  if (status !== "signed-in" && !preAccount) {
    return <ZeropsHostedLanding />;
  }
  return (
    <AppAtomRegistryProvider key={user?.id ?? "handover"}>
      {preAccount ? (
        <RouterProvider router={router} />
      ) : (
        <ZeropsAccountData>
          <ZeropsAccountDataBoundary>
            <RouterProvider router={router} />
            <ZeropsProductHosts status={status} />
          </ZeropsAccountDataBoundary>
        </ZeropsAccountData>
      )}
    </AppAtomRegistryProvider>
  );
}

/** No route loader or connection runtime exists before account verification. */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  // A throw above the router says so, rather than leaving the boot frame with nothing to say.
  return (
    <RenderErrorBoundary fallback={<ZeropsAppFailed onReload={() => window.location.reload()} />}>
      <ZeropsSessionProvider>
        <AccountProductBoundary router={router} />
      </ZeropsSessionProvider>
    </RenderErrorBoundary>
  );
}
