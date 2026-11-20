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
// 38552956450 and 38554960665 (2026-10-14). The slowest, not a mean: a suite's time varies from run
// to run, and the shard that holds it must still finish beside the others.
const serverSuiteDurations = {
  "src/zerops/ZeropsAgentAuthIo.test.ts": 41_016,
  "src/git/GitManager.test.ts": 29_771,
  "src/vcs/GitVcsDriverCore.test.ts": 12_968,
  "src/zerops/ZeropsStandUpRelay.test.ts": 12_052,
  "src/server.test.ts": 8_819,
  "src/engine/domain/decide.model.test.ts": 7_014,
  "src/attachmentFit.test.ts": 6_413,
  "src/zerops/ZeropsAgentLogin.test.ts": 4_669,
  "src/zerops/ZeropsSetup.test.ts": 2_814,
  "src/serverSettings.test.ts": 2_258,
  "src/terminal/Manager.test.ts": 1_245,
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
