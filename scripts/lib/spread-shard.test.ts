import { describe, expect, it } from "vite-plus/test";
import { spreadShard } from "./spread-shard.ts";

const files = [
  "src/zerops/crew/CrewEngine.test.ts",
  "src/zerops/crew/CrewEngine.lead.test.ts",
  "src/zerops/crew/CrewEngine.operations.test.ts",
  "src/zerops/crew/CrewEngine.runs.test.ts",
  "src/engine/engine.pump.test.ts",
  "src/engine/engine.sim.test.ts",
  "src/git/GitManager.test.ts",
];

describe("spreadShard", () => {
  it("puts every file in exactly one shard, whatever the order it is given in", () => {
    const shards = [1, 2, 3].map((index) => spreadShard(files, index, 3));
    const reversed = [1, 2, 3].map((index) => spreadShard(files.toReversed(), index, 3));
    expect(shards.flat().toSorted()).toEqual(files.toSorted());
    expect(reversed).toEqual(shards);
  });

  // Heavy suites cluster by directory; a contiguous slice gave one shard all of crew's engine files.
  it("spreads a directory's neighbouring files over different shards", () => {
    const crew = files.filter((file) => file.startsWith("src/zerops/crew/"));
    const shardOf = (file: string) =>
      [1, 2, 3, 4].find((index) => spreadShard(files, index, 4).includes(file));
    expect(new Set(crew.map(shardOf)).size).toBe(crew.length);
  });
});
