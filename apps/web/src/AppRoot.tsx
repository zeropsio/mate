import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { PreviewAutomationHosts } from "./components/preview/PreviewAutomationHosts";
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

  return (
    <>
      <PreviewAutomationHosts />
      <ElectronBrowserHost />
      <QuitHoldOverlay />
    </>
  );
}

function SignedInProductHosts() {
  const { status } = useZeropsSession();
  return <ZeropsProductHosts status={status} />;
}

/**
 * Owns renderer-wide providers. The Electron browser host intentionally sits
 * outside the router so its webviews survive route transitions, but it must
 * share the same atom registry as routed UI.
 *
 * The Zerops session is the outer product boundary. The router stays mounted
 * so the bare handover route can consume its fragment, but renderer-wide
 * product hosts do not mount until the account is signed in.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <ZeropsSessionProvider>
        <RouterProvider router={router} />
        <SignedInProductHosts />
      </ZeropsSessionProvider>
    </AppAtomRegistryProvider>
  );
}
