import { BaseSequencer, type TestSpecification } from "vite-plus/test/node";

/**
 * Shard `index` of `count` (1-based). Assign the longest measured suites first to the least
 * loaded runner. Unmeasured files cost one second; without measurements this is the existing
 * round-robin distribution of sorted paths, spreading a directory's neighbours across runners.
 */
export function spreadShard(
  files: ReadonlyArray<string>,
  index: number,
  count: number,
  durations: Readonly<Record<string, number>> = {},
): Array<string> {
  const shards = Array.from({ length: count }, () => ({ files: [] as string[], duration: 0 }));
  const duration = (file: string) => durations[file] ?? 1_000;
  for (const file of files.toSorted().sort((left, right) => duration(right) - duration(left))) {
    const shard = shards.reduce((least, next) => (next.duration < least.duration ? next : least));
    shard.files.push(file);
    shard.duration += duration(file);
  }
  return shards[index - 1]!.files;
}

// Files above the one-second default: each file's slowest time in full CI runs 38548162361,
// 38552956450 and 38554960665 (2026-10-14). The slowest, not a mean: engine.pump took 55, 85 and
// 161 seconds there, and the shard that holds it must still finish beside the others.
const serverSuiteDurations = {
  "src/engine/engine.pump.test.ts": 161_194,
  "src/zerops/crew/CrewEngine.test.ts": 86_846,
  "src/zerops/crew/engine/importV1Crew.test.ts": 46_005,
  "src/zerops/ZeropsAgentAuthIo.test.ts": 41_016,
  "src/zerops/crew/CrewEngine.lead.test.ts": 31_033,
  "src/git/GitManager.test.ts": 29_771,
  "src/zerops/crew/CrewEngine.runs.test.ts": 28_757,
  "src/engine/engine.sim.test.ts": 28_049,
  "src/engine/outbox/crash.test.ts": 26_992,
  "src/provider/Layers/CursorAdapter.test.ts": 26_558,
  "src/zerops/crew/CrewEngine.operations.test.ts": 26_171,
  "src/provider/Layers/GrokAdapter.test.ts": 22_811,
  "src/orchestration/Normalizer.attachments.test.ts": 19_641,
  "src/zerops/crew/CrewEngine.midway.test.ts": 16_783,
  "src/zerops/crew/engine/CrewEffectBridge.test.ts": 16_129,
  "src/engine/wire/EngineWire.test.ts": 15_169,
  "src/provider/acp/AcpJsonRpcConnection.test.ts": 15_031,
  "integration/scriptedHistory.integration.test.ts": 13_711,
  "src/vcs/GitVcsDriverCore.test.ts": 12_968,
  "src/zerops/ZeropsStandUpRelay.test.ts": 12_052,
  "src/engine/history/historyImport.test.ts": 10_488,
  "scripts/bundleNodePty.test.ts": 9_200,
  "src/engine/updateDrain.test.ts": 9_168,
  "src/server.test.ts": 8_819,
  "src/provider/Drivers/ClaudeDriverRefresh.test.ts": 8_278,
  "src/zerops/crew/CrewWorkspace.test.ts": 8_235,
  "src/vcs/GitVcsDriver.test.ts": 7_849,
  "src/zerops/crew/CrewEngine.endings.test.ts": 7_807,
  "src/engine/domain/decide.model.test.ts": 7_014,
  "src/zerops/crew/CrewShell.test.ts": 6_520,
  "src/attachmentFit.test.ts": 6_413,
  "src/orchestration/Layers/OrchestrationEngine.test.ts": 6_404,
  "src/spi/acpThreadProfile.contract.test.ts": 6_209,
  "src/spi/replay/openCodeReplay.test.ts": 6_078,
  "src/zerops/crew/CrewEngine.memory.test.ts": 5_803,
  "src/attachmentFitThread.test.ts": 5_226,
  "src/zerops/crew/CrewIntegration.test.ts": 5_114,
  "integration/scriptedSensors.integration.test.ts": 4_737,
  "src/zerops/ZeropsAgentLogin.test.ts": 4_669,
  "src/provider/Drivers/AntigravityDriver.test.ts": 4_668,
  "src/checkpointing/CheckpointStore.test.ts": 4_283,
  "src/persistence/Layers/OrchestrationEventStore.test.ts": 4_121,
  "integration/scriptedVocabulary.integration.test.ts": 3_793,
  "src/provider/Layers/CodexCollabRuntime.integration.test.ts": 3_767,
  "src/provider/Layers/CursorProvider.test.ts": 3_650,
  "src/workspace/WorkspaceEntries.test.ts": 3_218,
  "src/engine/bridge/translate.test.ts": 3_123,
  "src/engine/bridge/calls.test.ts": 3_065,
  "src/zerops/crew/engine/effects/land.test.ts": 3_046,
  "src/orchestration/Layers/ProjectionSnapshotQuery.test.ts": 3_006,
  "src/textGeneration/GrokTextGeneration.test.ts": 2_981,
  "src/zerops/crew/engine/effects/laneReset.test.ts": 2_961,
  "src/zerops/ZeropsSetup.test.ts": 2_814,
  "src/process/externalLauncher.test.ts": 2_716,
  "src/zerops/crew/engine/effects/checkpoint.test.ts": 2_463,
  "src/serverSettings.test.ts": 2_258,
  "src/zerops/crew/engine/effects/inspect.test.ts": 2_234,
  "src/zerops/crew/engine/updateIdle.test.ts": 2_188,
  "src/zerops/crew/engine/effects/mergeIn.test.ts": 2_100,
  "src/spi/replay/goldens.test.ts": 2_073,
  "src/zerops/ZeropsAgentAuthWatcher.test.ts": 2_047,
  "src/textGeneration/CursorTextGeneration.test.ts": 1_917,
  "src/orchestration/Layers/ProjectionPipeline.test.ts": 1_726,
  "src/engine/history/importedCalls.test.ts": 1_673,
  "src/provider/Layers/ProviderService.test.ts": 1_670,
  "src/engine/read/conversationView.test.ts": 1_502,
  "src/provider/Layers/GrokProvider.test.ts": 1_499,
  "src/provider/acp/XAiAcpExtension.test.ts": 1_486,
  "src/zerops/crew/CrewChecks.test.ts": 1_462,
  "scripts/migrate-dev-db.test.ts": 1_449,
  "src/zerops/crew/CrewEngine.attachments.test.ts": 1_427,
  "src/zerops/crew/engine/effects/laneCreate.test.ts": 1_406,
  "src/zerops/crew/engine/effects/recover.test.ts": 1_395,
  "src/zerops/crew/CrewReads.test.ts": 1_353,
  "src/zerops/mac/macViewScript.test.ts": 1_265,
  "src/terminal/Manager.test.ts": 1_245,
  "src/zerops/crew/registerCrewRpc.test.ts": 1_245,
  "src/provider/opencodeRuntime.environment.test.ts": 1_242,
  "src/zerops/crew/engine/effects/appRun.test.ts": 1_236,
  "src/provider/Layers/ClaudeAdapter.test.ts": 1_208,
  "src/checkpointing/WorkspaceHistory.test.ts": 1_176,
  "src/zerops/crew/engine/effects/sweep.test.ts": 1_151,
  "src/provider/Layers/AntigravityAdapter.test.ts": 1_132,
  "src/sourceControl/PrTemplateDetection.test.ts": 1_132,
  "src/zerops/crew/CrewRuntime.test.ts": 1_108,
  "src/persistence/Layers/Sqlite.test.ts": 1_075,
  "src/zerops/crew/engine/effects/check.test.ts": 1_001,
};

/** Vitest's sequencer with the measured server distribution in place of contiguous hash slices. */
export class SpreadShardSequencer extends BaseSequencer {
  override async shard(files: Array<TestSpecification>): Promise<Array<TestSpecification>> {
    const { index, count } = this.ctx.config.shard!;
    const root = this.ctx.config.root;
    // Every shard sees the same list, so the path below the root orders it the same on each.
    const byPath = new Map(files.map((spec) => [spec.moduleId.slice(root.length + 1), spec]));
    return spreadShard([...byPath.keys()], index, count, serverSuiteDurations).map((path) =>
      byPath.get(path)!,
    );
  }
}
