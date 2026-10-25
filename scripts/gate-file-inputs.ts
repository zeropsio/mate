import { Visitor } from "oxc-parser";

// Repository-relative filesystem inputs join the import graph without traversing their imports.
// An empty declaration means the test reads only disposable files, not checkout inputs.
export const fileReadInputs: Readonly<Record<string, ReadonlyArray<string>>> = {
  "apps/desktop/scripts/main-process-bundle.test.mjs": [],
  "apps/desktop/src/app/DesktopConnectionCatalogStore.test.ts": [],
  "apps/desktop/src/app/DesktopObservability.test.ts": [],
  "apps/desktop/src/app/smokeCapture.test.ts": [],
  "apps/desktop/src/settings/DesktopAppSettings.test.ts": [],
  "apps/desktop/src/settings/DesktopClientSettings.test.ts": [],
  "apps/hq/src/gitBrowse/archive.test.ts": [],
  "apps/mobile/app-config-personal-team.test.ts": [
    "apps/mobile/app.config.ts",
    "apps/mobile/plugins/withoutIosPersonalTeamCapabilities.cjs",
  ],
  "apps/mobile/scripts/generate-uniwind-themes.test.ts": [
    "apps/mobile/global.css",
    "apps/mobile/generated-uniwind-themes.css",
  ],
  "apps/mobile/scripts/notification-center-manager.test.ts": [
    "apps/mobile/scripts/fixtures/**",
    "patches/**",
  ],
  "apps/mobile/scripts/permissions-service.test.ts": [
    "apps/mobile/scripts/fixtures/**",
    "patches/**",
  ],
  "apps/mobile/src/components/zerops/MicroLabel.test.ts": [
    "apps/mobile/generated-uniwind-themes.css",
    "apps/mobile/global.css",
  ],
  "apps/mobile/src/components/zerops/zeropsThemeTokens.test.ts": [
    "apps/mobile/generated-uniwind-themes.css",
  ],
  "apps/mobile/src/dependency-graph.test.ts": ["apps/mobile/**"],
  "apps/mobile/src/features/threads/checkout-new-task-branch.test.ts": [],
  "apps/mobile/src/features/threads/threadListV2.test.ts": [
    "apps/mobile/generated-uniwind-themes.css",
  ],
  "apps/mobile/src/features/zerops/mobile-zerops-integration-source.test.ts": [
    "apps/mobile/**",
    "packages/client-runtime/**",
    "packages/contracts/**",
  ],
  "apps/mobile/src/lib/useDutyCycle.test.ts": ["apps/mobile/src/lib/useDutyCycle.ts"],
  "apps/mobile/src/lib/useFontFamily.test.ts": ["apps/mobile/**"],
  "apps/hq/src/api.test.ts": [],
  "apps/hq/src/backup.test.ts": [],
  "apps/hq/src/bucketStore.test.ts": [],
  "apps/hq/src/deploys.test.ts": [],
  "apps/hq/src/gitHost.test.ts": [],
  "apps/hq/src/gitPush.integration.test.ts": [],
  "apps/hq/src/personGit.test.ts": [],
  "apps/hq/src/restore.test.ts": [],
  "apps/hq/src/zerops/contract.test.ts": [],
  "apps/hq/test/harness/preExpandCore.test.ts": [
    "apps/hq/package.json",
    "packages/*/package.json",
    "pnpm-workspace.yaml",
  ],
  "apps/server/integration/providerService.integration.test.ts": [],
  "apps/server/integration/scenarioMate.integration.test.ts": [],
  "apps/server/integration/scriptedVocabulary.integration.test.ts": [],
  "apps/server/scripts/bundleNodePty.test.ts": [],
  "apps/server/scripts/cli.test.ts": [
    "apps/server/scripts/**",
    "scripts/lib/**",
    "package.json",
    "pnpm-workspace.yaml",
    "apps/server/package.json",
  ],
  "apps/server/src/assets/AssetAccess.test.ts": [],
  "apps/server/src/assets/AttachmentUpload.test.ts": [],
  "apps/server/src/assets/ContentAssetHttp.test.ts": [],
  "apps/server/src/assets/ContentAssets.test.ts": [],
  "apps/server/src/assets/ConversationMedia.test.ts": [],
  "apps/server/src/assets/PersistentAssets.test.ts": [],
  "apps/server/src/atomicWrite.test.ts": [],
  "apps/server/src/auth/RpcAuthorization.clientScopes.test.ts": [
    "apps/web/src/**",
    "apps/mobile/src/**",
    "packages/client-runtime/src/**",
  ],
  "apps/server/src/auth/ServerSecretStore.test.ts": [],
  "apps/server/src/auth/replayMarkers.test.ts": [],
  "apps/server/src/bin.test.ts": [],
  "apps/server/src/cli/triagePrompt.test.ts": [".github/triage/PLAYBOOK.md"],
  "apps/server/src/engine/bridge/translate.test.ts": ["apps/server/src/spi/fixtures/**"],
  "apps/server/src/engine/history/historyImport.test.ts": ["apps/server/src/spi/fixtures/**"],
  "apps/server/src/git/GitManager.test.ts": [],
  "apps/server/src/keybindings.test.ts": [],
  "apps/server/src/observability/HeapSnapshot.test.ts": [],
  "apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts": [],
  "apps/server/src/orchestration/Normalizer.attachments.test.ts": [],
  "apps/server/src/process/externalLauncher.test.ts": [],
  "apps/server/src/project/ProjectFaviconResolver.test.ts": [],
  "apps/server/src/provider/AntigravityInstallation.test.ts": [],
  "apps/server/src/provider/Drivers/AntigravityDriver.test.ts": [],
  "apps/server/src/provider/Drivers/ClaudeDriverRefresh.test.ts": [],
  "apps/server/src/provider/Drivers/CodexHomeLayout.test.ts": [],
  "apps/server/src/provider/Layers/AntigravityAdapter.test.ts": [],
  "apps/server/src/provider/Layers/ClaudeCapabilitiesProbe.test.ts": [],
  "apps/server/src/provider/Layers/CodexAdapter.test.ts": [],
  "apps/server/src/provider/Layers/CodexCollabRuntime.integration.test.ts": [],
  "apps/server/src/provider/Layers/CursorAdapter.test.ts": [],
  "apps/server/src/provider/Layers/CursorProvider.test.ts": [],
  "apps/server/src/provider/Layers/EventNdjsonLogger.test.ts": [],
  "apps/server/src/provider/Layers/GrokAdapter.test.ts": [],
  "apps/server/src/provider/acp/AcpJsonRpcConnection.test.ts": [],
  "apps/server/src/provider/acp/AntigravityAcpSupport.test.ts": [],
  "apps/server/src/provider/antigravityAuthSupport.test.ts": [],
  "apps/server/src/provider/userInputAttachments.test.ts": [],
  "apps/server/src/resourceTelemetry/DesktopTelemetryReceiver.test.ts": [],
  "apps/server/src/server.test.ts": [],
  "apps/server/src/serverSettings.test.ts": [],
  "apps/server/src/sourceControl/SourceControlDiscovery.test.ts": [],
  "apps/server/src/sourceControl/SourceControlRepositoryService.test.ts": [],
  "apps/server/src/spi/acpThreadProfile.contract.test.ts": [],
  "apps/server/src/spi/replay/goldenCheck.test.ts": [],
  "apps/server/src/spi/replay/goldens.test.ts": ["apps/server/src/spi/fixtures/**"],
  "apps/server/src/terminal/Manager.test.ts": [],
  "apps/server/src/testUtils/gitConfig.setup.test.ts": [],
  "apps/server/src/textGeneration/AntigravityTextGeneration.test.ts": [],
  "apps/server/src/textGeneration/CursorTextGeneration.test.ts": [],
  "apps/server/src/textGeneration/GrokTextGeneration.test.ts": [],
  "apps/server/src/uploadsFolder.test.ts": [],
  "apps/server/src/vcs/GitVcsDriver.test.ts": [],
  "apps/server/src/vcs/GitVcsDriverCore.test.ts": [],
  "apps/server/src/workspace/WorkspaceFileSystem.test.ts": [],
  "apps/server/src/zerops/ZeropsAgentAuthIo.test.ts": [],
  "apps/server/src/zerops/ZeropsAgentLogin.test.ts": [],
  "apps/server/src/zerops/ZeropsCrewProposals.test.ts": [],
  "apps/server/src/zerops/ZeropsGitCredentialFile.test.ts": [],
  "apps/server/src/zerops/ZeropsLoginsIo.test.ts": [],
  "apps/server/src/zerops/ZeropsMateAttention.test.ts": [],
  "apps/server/src/zerops/ZeropsSetup.test.ts": [],
  "apps/server/src/zerops/ZeropsWorkspaceObserver.test.ts": [],
  "apps/server/src/zerops/crew/CrewEngine.attachments.test.ts": [],
  "apps/server/src/zerops/crew/CrewEngine.operations.test.ts": [],
  "apps/server/src/zerops/mac/MacHost.test.ts": [],
  "apps/server/src/zerops/mac/macHostScript.test.ts": [],
  "apps/server/src/zerops/mac/macViewScript.test.ts": [],
  "apps/server/src/zerops/mateResourceHealth.test.ts": [],
  "apps/server/src/zerops/mcp/McpServers.test.ts": [],
  "apps/server/src/zerops/mcp/mcpAgents.load.test.ts": ["apps/server/src/zerops/mcp/**"],
  "apps/web/test/scenarios/fakes/buildCache.test.ts": [],
  "oxlint-plugin-t3code/rules/no-environment-as-project.test.ts": [
    "apps/hq/src/deploys.ts",
    "apps/hq/src/environmentNavigation.ts",
    "apps/hq/src/rollouts.ts",
    "apps/hq/src/structure.ts",
    "apps/web/src/routes/_chat.group.$groupId.$projectId.tsx",
    "apps/web/src/routes/_chat.mate.$projectId.tsx",
    "apps/web/src/components/zerops/ZeropsGroupDetail.tsx",
  ],
  "oxlint-plugin-t3code/rules/no-failure-to-empty.test.ts": [
    "packages/client-runtime/src/data/projections/hqAutoUpdatePolicy.ts",
  ],
  "oxlint-plugin-t3code/rules/no-remote-io-outside-data-layer.test.ts": [
    "packages/client-runtime/src/zerops/api.ts",
    "packages/client-runtime/src/zerops/hq/client.ts",
  ],
  "packages/client-runtime/src/data/operations/deleteService.test.ts": [
    "apps/hq/src/**",
    "apps/mobile/src/**",
    "apps/web/src/**",
    "packages/client-runtime/src/**",
  ],
  "packages/client-runtime/src/zerops/zcpFixtures.test.ts": [
    "packages/client-runtime/src/zerops/fixtures/zcp/**",
  ],
  "packages/hq-git/src/browse/archive.test.ts": [],
  "packages/hq-git/src/integration.test.ts": [],
  "packages/hq-git/src/operations.test.ts": [],
  "packages/shared/src/logging.test.ts": [],
  "packages/shared/src/observability.test.ts": [],
  "packages/shared/src/relayClient.test.ts": [],
  "packages/shared/src/showcaseScenes/index.test.ts": [
    "packages/shared/src/showcaseScenes/v1/scenes.lock",
  ],
  "scripts/build-desktop-artifact.test.ts": ["apps/desktop/resources/dmg/*.svg"],
  "scripts/chat-gate.test.ts": [
    ".github/workflows/ci.yml",
    ".github/workflows/signal.yml",
    "apps/web/test/scenarios/areas/**",
  ],
  "scripts/check-guard-exceptions.test.ts": [],
  "scripts/ci-local.test.ts": [".github/workflows/ci.yml"],
  "scripts/ci-blame.test.ts": [".github/workflows/ci.yml", "scripts/ci-blame.ts"],
  "scripts/ci-workflow.test.ts": [
    ".github/workflows/*.yml",
    "pnpm-workspace.yaml",
    "apps/mobile/package.json",
    "apps/desktop/package.json",
    "packages/*/package.json",
  ],
  "scripts/ensure-electron-runtime.test.ts": [],
  "scripts/gate-changed.test.ts": [],
  "scripts/gate-rerun.test.ts": [],
  "scripts/gate-file-inputs.test.ts": [
    "scripts/**/*.test.ts",
    "oxlint-plugin-t3code/**/*.test.ts",
    "apps/**/*.test.ts",
    "packages/**/*.test.ts",
    "infra/**/*.test.ts",
  ],
  "scripts/gate-log.test.ts": [],
  "scripts/gate-slots.test.ts": [],
  "scripts/gate-timing-reporter.test.ts": [],
  "scripts/generate-theme-tokens.test.ts": [
    "apps/web/index.html",
    "apps/web/public/favicon.svg",
    "apps/mobile/global.css",
  ],
  "scripts/legend-list-initial-reveal.test.ts": [
    "patches/@legendapp__list*.patch",
    "apps/mobile/node_modules/@legendapp/list/**",
    "apps/web/node_modules/@legendapp/list/**",
  ],
  "scripts/hq-git-push.test.ts": ["apps/hq/src/**", "packages/hq-git/src/**"],
  "scripts/lib/brand-assets.test.ts": ["assets/**", "apps/mobile/assets/**"],
  "scripts/lib/cli-external-packages.test.ts": [],
  "scripts/lib/spread-shard.test.ts": ["apps/**", "packages/**"],
  "scripts/mate-boundaries.test.ts": ["apps/server/src/zerops/**"],
  "scripts/mate-readiness.test.ts": ["apps/web/src/**"],
  "scripts/mate-zone-architecture.test.ts": ["apps/**", "packages/**"],
  "scripts/merge-update-manifests.test.ts": [],
  "scripts/prepare-worktree.test.ts": [],
  "scripts/product-name.test.ts": ["apps/**", "packages/**", "scripts/**"],
  "scripts/registry-release-policy.test.ts": [
    ".github/workflows/release.yml",
    ".github/ISSUE_TEMPLATE/via-triage.yml",
    "CONTRIBUTING.md",
    "docs/README.md",
    "apps/**",
    "packages/**",
    "scripts/**",
  ],
  "scripts/release-mate.test.ts": [".github/workflows/release.yml"],
  "scripts/release-publication.test.ts": [".github/workflows/release.yml"],
  "scripts/route-nesting.test.ts": ["apps/web/src/routes/**"],
  "scripts/showcase-scenes.test.ts": ["packages/shared/src/showcaseScenes/**"],
  "scripts/surface-manifest.test.ts": ["apps/**", "packages/**", "surfaces.json"],
  "scripts/test-ports.test.ts": [],
  "scripts/test-postgres.test.ts": ["scripts/fixtures/fake-postgres.ts"],
  "scripts/test-process-lock.test.ts": [],
  "scripts/tsconfig-basename-collisions.test.ts": [
    "apps/**",
    "packages/**",
    "infra/**",
    "pnpm-workspace.yaml",
  ],
  "scripts/turn-start-sites.test.ts": ["apps/**", "packages/**"],
  "scripts/update-release-package-versions.test.ts": [],
};

// Inspect calls, not source text: comments and scripts held in strings are not filesystem reads.
export function hasFileReads(program: Parameters<Visitor["visit"]>[0]): boolean {
  let reads = false;
  const methods = new Set([
    "readFile",
    "readFileSync",
    "readFileString",
    "readDirectory",
    "readdir",
    "readdirSync",
    "createReadStream",
  ]);
  const aliases = new Set<string>();
  new Visitor({
    ImportDeclaration(node) {
      if (!["node:fs", "node:fs/promises", "fs", "fs/promises"].includes(node.source.value)) return;
      for (const specifier of node.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          methods.has(
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : specifier.imported.value,
          )
        )
          aliases.add(specifier.local.name);
      }
    },
    CallExpression(node) {
      const callee = node.callee;
      if (callee.type === "Identifier" && (methods.has(callee.name) || aliases.has(callee.name)))
        reads = true;
      if (callee.type === "MemberExpression") {
        const property = callee.property;
        const name =
          property.type === "Identifier"
            ? property.name
            : property.type === "Literal"
              ? property.value
              : undefined;
        if (typeof name === "string" && methods.has(name)) reads = true;
      }
    },
  }).visit(program);
  return reads;
}
