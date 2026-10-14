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

// Files above the one-second default in full CI run 38548162361 (2026-10-14).
const serverSuiteDurations = {
  "src/zerops/crew/CrewEngine.test.ts": 86_846,
  "src/engine/engine.pump.test.ts": 55_294,
  "src/zerops/crew/engine/importV1Crew.test.ts": 42_222,
  "src/zerops/ZeropsAgentAuthIo.test.ts": 40_975,
  "src/zerops/crew/CrewEngine.lead.test.ts": 29_752,
  "src/zerops/crew/CrewEngine.runs.test.ts": 28_757,
  "src/engine/outbox/crash.test.ts": 26_992,
  "src/zerops/crew/CrewEngine.operations.test.ts": 25_164,
  "src/git/GitManager.test.ts": 23_637,
  "src/engine/engine.sim.test.ts": 21_262,
  "src/provider/Layers/GrokAdapter.test.ts": 21_046,
  "src/provider/Layers/CursorAdapter.test.ts": 18_405,
  "src/zerops/crew/CrewEngine.midway.test.ts": 16_783,
  "src/orchestration/Normalizer.attachments.test.ts": 15_221,
  "src/provider/acp/AcpJsonRpcConnection.test.ts": 14_584,
  "integration/scriptedHistory.integration.test.ts": 13_616,
  "src/zerops/crew/engine/CrewEffectBridge.test.ts": 12_934,
  "src/zerops/ZeropsStandUpRelay.test.ts": 12_039,
  "src/vcs/GitVcsDriverCore.test.ts": 10_833,
  "scripts/bundleNodePty.test.ts": 8_510,
  "src/engine/history/historyImport.test.ts": 8_433,
  "src/engine/wire/EngineWire.test.ts": 8_312,
  "src/provider/Drivers/ClaudeDriverRefresh.test.ts": 8_278,
  "src/zerops/crew/CrewWorkspace.test.ts": 7_985,
  "src/zerops/crew/CrewEngine.endings.test.ts": 7_141,
  "src/zerops/crew/CrewShell.test.ts": 6_507,
  "src/engine/updateDrain.test.ts": 6_154,
  "src/spi/replay/openCodeReplay.test.ts": 6_034,
  "src/zerops/crew/CrewEngine.memory.test.ts": 5_803,
  "src/server.test.ts": 5_738,
  "src/vcs/GitVcsDriver.test.ts": 5_677,
  "src/attachmentFit.test.ts": 5_124,
  "src/engine/domain/decide.model.test.ts": 5_094,
  "src/zerops/crew/CrewIntegration.test.ts": 4_908,
  "src/zerops/ZeropsAgentLogin.test.ts": 4_654,
  "integration/scriptedSensors.integration.test.ts": 4_506,
  "src/orchestration/Layers/OrchestrationEngine.test.ts": 4_387,
  "src/checkpointing/CheckpointStore.test.ts": 4_283,
  "src/spi/acpThreadProfile.contract.test.ts": 3_670,
  "src/provider/Layers/CodexCollabRuntime.integration.test.ts": 3_608,
  "integration/scriptedVocabulary.integration.test.ts": 3_464,
  "src/provider/Drivers/AntigravityDriver.test.ts": 3_425,
  "src/provider/Layers/CursorProvider.test.ts": 3_242,
  "src/workspace/WorkspaceEntries.test.ts": 3_218,
  "src/persistence/Layers/OrchestrationEventStore.test.ts": 3_057,
  "src/engine/bridge/translate.test.ts": 3_002,
  "src/zerops/crew/engine/effects/laneReset.test.ts": 2_715,
  "src/zerops/ZeropsSetup.test.ts": 2_650,
  "src/attachmentFitThread.test.ts": 2_463,
  "src/process/externalLauncher.test.ts": 2_450,
  "src/zerops/crew/engine/effects/checkpoint.test.ts": 2_435,
  "src/zerops/crew/engine/effects/land.test.ts": 2_295,
  "src/engine/bridge/calls.test.ts": 2_163,
  "src/serverSettings.test.ts": 2_145,
  "src/zerops/crew/engine/updateIdle.test.ts": 2_111,
  "src/textGeneration/GrokTextGeneration.test.ts": 2_072,
  "src/zerops/ZeropsAgentAuthWatcher.test.ts": 2_046,
  "src/zerops/crew/engine/effects/mergeIn.test.ts": 1_955,
  "src/zerops/crew/engine/effects/inspect.test.ts": 1_809,
  "src/spi/replay/goldens.test.ts": 1_497,
  "scripts/migrate-dev-db.test.ts": 1_449,
  "src/zerops/crew/CrewChecks.test.ts": 1_439,
  "src/textGeneration/CursorTextGeneration.test.ts": 1_372,
  "src/provider/acp/XAiAcpExtension.test.ts": 1_355,
  "src/zerops/crew/CrewEngine.attachments.test.ts": 1_322,
  "src/orchestration/Layers/ProjectionSnapshotQuery.test.ts": 1_315,
  "src/terminal/Manager.test.ts": 1_224,
  "src/zerops/crew/engine/effects/laneCreate.test.ts": 1_222,
  "src/zerops/crew/CrewReads.test.ts": 1_170,
  "src/zerops/crew/registerCrewRpc.test.ts": 1_168,
  "src/engine/history/importedCalls.test.ts": 1_148,
  "src/provider/opencodeRuntime.environment.test.ts": 1_142,
  "src/provider/Layers/GrokProvider.test.ts": 1_115,
  "src/provider/Layers/ClaudeAdapter.test.ts": 1_109,
  "src/engine/read/conversationView.test.ts": 1_101,
  "src/orchestration/Layers/ProjectionPipeline.test.ts": 1_089,
  "src/persistence/Layers/Sqlite.test.ts": 1_075,
  "src/zerops/crew/engine/effects/recover.test.ts": 1_041,
  "src/zerops/crew/engine/effects/sweep.test.ts": 1_027,
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
