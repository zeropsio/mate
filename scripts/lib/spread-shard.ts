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

// Files above the one-second default in full CI run 38456967103 (2026-10-13).
const serverSuiteDurations = {
  "src/zerops/crew/engine/importV1Crew.test.ts": 168_735,
  "src/engine/engine.pump.test.ts": 89_851,
  "src/zerops/crew/CrewEngine.test.ts": 72_667,
  "src/zerops/crew/CrewEngine.operations.test.ts": 56_590,
  "src/zerops/crew/CrewEngine.lead.test.ts": 42_927,
  "src/zerops/ZeropsAgentAuthIo.test.ts": 40_969,
  "src/engine/history/historyImport.test.ts": 40_242,
  "src/zerops/crew/CrewEngine.runs.test.ts": 35_650,
  "src/git/GitManager.test.ts": 32_738,
  "src/engine/engine.sim.test.ts": 27_621,
  "src/provider/Layers/CursorAdapter.test.ts": 18_613,
  "src/engine/outbox/crash.test.ts": 16_374,
  "src/provider/Layers/GrokAdapter.test.ts": 16_188,
  "src/orchestration/Normalizer.attachments.test.ts": 15_677,
  "src/zerops/crew/CrewEngine.midway.test.ts": 13_118,
  "src/orchestration/Layers/OrchestrationEngine.test.ts": 12_700,
  "integration/scriptedHistory.integration.test.ts": 12_471,
  "src/server.test.ts": 12_207,
  "src/zerops/ZeropsStandUpRelay.test.ts": 12_050,
  "src/zerops/crew/engine/CrewEffectBridge.test.ts": 11_890,
  "src/provider/acp/AcpJsonRpcConnection.test.ts": 11_101,
  "src/vcs/GitVcsDriverCore.test.ts": 11_091,
  "src/zerops/crew/CrewEngine.endings.test.ts": 10_813,
  "src/provider/Drivers/ClaudeDriverRefresh.test.ts": 8_269,
  "src/zerops/crew/CrewWorkspace.test.ts": 7_622,
  "src/vcs/GitVcsDriver.test.ts": 7_271,
  "src/engine/domain/decide.model.test.ts": 6_982,
  "src/zerops/crew/CrewShell.test.ts": 6_479,
  "src/zerops/crew/CrewIntegration.test.ts": 6_350,
  "src/engine/updateDrain.test.ts": 6_200,
  "src/spi/replay/openCodeReplay.test.ts": 6_039,
  "src/engine/wire/EngineWire.test.ts": 5_929,
  "scripts/bundleNodePty.test.ts": 5_890,
  "src/attachmentFit.test.ts": 5_150,
  "src/zerops/crew/CrewEngine.memory.test.ts": 4_914,
  "src/zerops/ZeropsAgentLogin.test.ts": 4_571,
  "integration/scriptedSensors.integration.test.ts": 4_558,
  "src/provider/Layers/CodexCollabRuntime.integration.test.ts": 3_740,
  "src/provider/Drivers/AntigravityDriver.test.ts": 3_444,
  "src/persistence/Layers/OrchestrationEventStore.test.ts": 3_324,
  "src/provider/Layers/CursorProvider.test.ts": 3_098,
  "src/engine/bridge/calls.test.ts": 2_990,
  "src/checkpointing/CheckpointStore.test.ts": 2_978,
  "src/zerops/crew/engine/effects/land.test.ts": 2_925,
  "src/spi/acpThreadProfile.contract.test.ts": 2_862,
  "src/zerops/crew/engine/effects/laneReset.test.ts": 2_832,
  "src/textGeneration/GrokTextGeneration.test.ts": 2_798,
  "integration/scriptedVocabulary.integration.test.ts": 2_786,
  "src/workspace/WorkspaceEntries.test.ts": 2_686,
  "src/process/externalLauncher.test.ts": 2_593,
  "src/attachmentFitThread.test.ts": 2_446,
  "src/engine/bridge/translate.test.ts": 2_331,
  "src/zerops/crew/engine/effects/checkpoint.test.ts": 2_285,
  "src/engine/read/conversationView.test.ts": 2_279,
  "src/zerops/crew/engine/effects/mergeIn.test.ts": 2_153,
  "src/serverSettings.test.ts": 2_071,
  "src/zerops/ZeropsAgentAuthWatcher.test.ts": 2_049,
  "src/spi/replay/goldens.test.ts": 2_042,
  "src/zerops/crew/engine/updateIdle.test.ts": 1_995,
  "src/zerops/ZeropsSetup.test.ts": 1_973,
  "src/zerops/crew/engine/effects/inspect.test.ts": 1_844,
  "src/textGeneration/CursorTextGeneration.test.ts": 1_721,
  "src/orchestration/Layers/ProjectionSnapshotQuery.test.ts": 1_657,
  "src/zerops/crew/CrewChecks.test.ts": 1_406,
  "src/zerops/crew/CrewEngine.attachments.test.ts": 1_377,
  "src/zerops/crew/engine/effects/laneCreate.test.ts": 1_303,
  "src/zerops/crew/registerCrewRpc.test.ts": 1_202,
  "src/terminal/Manager.test.ts": 1_199,
  "src/zerops/crew/CrewReads.test.ts": 1_197,
  "src/provider/Layers/ClaudeAdapter.test.ts": 1_180,
  "src/engine/history/importedCalls.test.ts": 1_151,
  "src/provider/opencodeRuntime.environment.test.ts": 1_143,
  "src/assets/EngineImages.test.ts": 1_131,
  "src/provider/Layers/GrokProvider.test.ts": 1_118,
  "src/orchestration/Layers/ProjectionPipeline.test.ts": 1_109,
  "src/zerops/crew/engine/effects/check.test.ts": 1_082,
  "src/zerops/crew/engine/effects/sweep.test.ts": 1_080,
  "src/provider/acp/XAiAcpExtension.test.ts": 1_031,
  "src/checkpointing/WorkspaceHistory.test.ts": 1_004,
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
