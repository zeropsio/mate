import { BaseSequencer, type TestSpecification } from "vite-plus/test/node";

/**
 * Shard `index` of `count` (1-based): every `count`-th file of the sorted paths. Slow suites
 * cluster by directory (a module's engine, its runs, its lead…), so a contiguous slice of files —
 * Vitest's default — can hand one shard several of them; dealing the sorted list round-robin
 * spreads a directory's neighbours over every shard.
 */
export function spreadShard(
  files: ReadonlyArray<string>,
  index: number,
  count: number,
): Array<string> {
  return files.toSorted().filter((_, position) => position % count === index - 1);
}

/** Vitest's sequencer with {@link spreadShard} in place of its contiguous hash slices. */
export class SpreadShardSequencer extends BaseSequencer {
  override async shard(files: Array<TestSpecification>): Promise<Array<TestSpecification>> {
    const { index, count } = this.ctx.config.shard!;
    const root = this.ctx.config.root;
    // Every shard sees the same list, so the path below the root orders it the same on each.
    const byPath = new Map(files.map((spec) => [spec.moduleId.slice(root.length + 1), spec]));
    return spreadShard([...byPath.keys()], index, count).map((path) => byPath.get(path)!);
  }
}
