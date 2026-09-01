// @effect-diagnostics nodeBuiltinImport:off -- This architecture test verifies native route wiring.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const mobileRoot = new URL("../../../", import.meta.url);
const readSource = (relativePath: string) =>
  NodeFS.readFileSync(new URL(relativePath, mobileRoot), "utf8");

describe("mobile Zerops integration", () => {
  it("keeps the Zerops session outside the legacy relay provider", () => {
    const app = readSource("src/App.tsx");
    expect(app.indexOf("<ZeropsSessionProvider>")).toBeLessThan(app.indexOf("<CloudAuthProvider>"));
  });

  it("uses account-backed connection as the primary route and keeps pairing as fallback", () => {
    const stack = readSource("src/Stack.tsx");
    const onboarding = readSource("src/connection/onboarding.ts");

    expect(stack).toContain("screen: ZeropsConnectRouteScreen");
    expect(stack).toContain("ConnectionsPairing: createNativeStackScreen");
    expect(onboarding).toContain("onboarding.registerZeropsIdentity(input)");
    expect(onboarding).toContain("onboarding.registerPairing({ pairingUrl })");
  });

  it("selects the connected environment before leaving either Zerops connect route", () => {
    const connectRoute = readSource("src/features/zerops/ZeropsConnectRouteScreen.tsx");

    expect(connectRoute).toContain("props.onDone(candidate.environmentId)");
    expect(connectRoute).toContain("props.onDone(result.environmentId)");
    expect(connectRoute).toContain("useSetHomeEnvironmentId");
    expect(connectRoute.indexOf("setHomeEnvironmentId(environmentId)")).toBeLessThan(
      connectRoute.indexOf('StackActions.replace("Home")'),
    );
  });

  it("globally locks picker mutations and preserves long project identities", () => {
    const connectRoute = readSource("src/features/zerops/ZeropsConnectRouteScreen.tsx");

    expect(connectRoute).toContain("disabled={isConnecting}");
    expect(connectRoute).toContain("numberOfLines={2}");
    expect(connectRoute).toContain("visibleError ? null");
  });

  it("surfaces retryable session restore and one-time recovery states", () => {
    const connectRoute = readSource("src/features/zerops/ZeropsConnectRouteScreen.tsx");

    expect(connectRoute).toContain("restoreError");
    expect(connectRoute).toContain("retryRestore");
    expect(connectRoute).toContain("newRecoveryToken");
    expect(connectRoute).toContain("clearNewRecoveryToken");
    expect(connectRoute).toContain("Save your new recovery code");
    expect(connectRoute).toContain("selectable");
  });
});
