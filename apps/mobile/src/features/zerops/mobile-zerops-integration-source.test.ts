// @effect-diagnostics nodeBuiltinImport:off -- This architecture test verifies native route wiring.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

const mobileRoot = new URL("../../../", import.meta.url);
const repositoryRoot = NodePath.resolve(new URL("../../", mobileRoot).pathname);
const readSource = (relativePath: string) =>
  NodeFS.readFileSync(new URL(relativePath, mobileRoot), "utf8");

describe("mobile Zerops integration", () => {
  it("directs users to hosted Mate with an inactive data boundary", () => {
    const app = readSource("src/App.tsx");
    expect(app).toContain('Linking.openURL("https://mate.zerops.io")');
    expect(app).toContain("<ZeropsDataProvider account={null}>");
    expect(app.match(/<ZeropsDataProvider/g)).toHaveLength(1);
    expect(app).not.toContain("ZeropsSessionProvider");
    expect(app).not.toContain("CloudAuthProvider");
    expect(app).not.toContain('from "./Stack"');
  });

  it("reads the shared candidate selector over the runtime's knowledge", () => {
    const candidates = readSource("src/features/zerops/useZeropsCandidates.ts");

    expect(candidates).toContain("selectCandidates");
    expect(candidates).toContain("knownProjectsOf");
    expect(candidates).toContain("knownServicesOf");
    expect(candidates).toContain("organization-inventory");
    expect(candidates).not.toContain("runtime.stateAtom");
  });

  it("leaves the deleted raw candidate path with no importer anywhere", () => {
    const self = NodePath.resolve(new URL(import.meta.url).pathname);
    const roots = ["apps/mobile/src", "apps/web/src", "packages/client-runtime/src"].map((root) =>
      NodePath.join(repositoryRoot, root),
    );
    const importers = roots.flatMap((root) =>
      (NodeFS.readdirSync(root, { recursive: true }) as ReadonlyArray<string>)
        .map((file) => NodePath.join(root, file))
        .filter((file) => /\.tsx?$/u.test(file) && file !== self)
        .filter((file) =>
          /zerops\/candidateLoading|\.\/candidate-loading|projectZeropsCandidates/u.test(
            NodeFS.readFileSync(file, "utf8"),
          ),
        )
        .map((file) => NodePath.relative(repositoryRoot, file)),
    );
    const clientRuntime = JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(repositoryRoot, "packages/client-runtime/package.json"),
        "utf8",
      ),
    ) as { readonly exports: Record<string, unknown> };

    expect(importers).toEqual([]);
    expect(clientRuntime.exports["./zerops/candidateLoading"]).toBeUndefined();
    expect(
      NodeFS.existsSync(
        NodePath.join(repositoryRoot, "packages/client-runtime/src/zerops/candidateLoading.ts"),
      ),
    ).toBe(false);
    expect(
      NodeFS.existsSync(
        NodePath.join(repositoryRoot, "apps/mobile/src/features/zerops/candidate-loading.ts"),
      ),
    ).toBe(false);
  });

  it("retains the dormant native connection source for a future account lifecycle implementation", () => {
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
