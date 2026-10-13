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

// Slowest files in main run 38430261761; the other files retain the one-second default.
const serverSuiteDurations = {
  "src/zerops/crew/CrewEngine.test.ts": 110_379,
  "src/zerops/crew/engine/importV1Crew.test.ts": 77_819,
  "src/engine/engine.pump.test.ts": 73_681,
  "src/zerops/crew/CrewEngine.lead.test.ts": 67_323,
  "src/zerops/crew/CrewEngine.operations.test.ts": 57_158,
  "src/engine/outbox/crash.test.ts": 48_439,
  "src/zerops/crew/CrewEngine.runs.test.ts": 43_016,
  "src/zerops/ZeropsAgentAuthIo.test.ts": 41_008,
  "src/git/GitManager.test.ts": 31_242,
  "src/engine/engine.sim.test.ts": 26_302,
  "integration/scriptedHistory.integration.test.ts": 26_256,
  "src/provider/Layers/CursorAdapter.test.ts": 18_615,
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
