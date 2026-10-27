// @effect-diagnostics nodeBuiltinImport:off -- the server's real test inventory is the sharding input.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
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

  it("measured server suites share four runners without concentrating their slow files", () => {
    const root = NodePath.resolve(import.meta.dirname, "../../apps/server");
    const inventory = ["src", "integration", "scripts"].flatMap((directory) =>
      NodeFS.readdirSync(NodePath.join(root, directory), { recursive: true })
        .filter((path) => /\.test\.tsx?$/u.test(String(path)))
        .map((path) => `${directory}/${String(path)}`),
    );
    const measured = {
      "src/zerops/crew/CrewEngine.test.ts": 110_379,
      "src/engine/engine.pump.test.ts": 73_681,
    };
    const shards = [1, 2, 3, 4].map((index) => spreadShard(inventory, index, 4, measured));
    expect(shards.flat().toSorted()).toEqual(inventory.toSorted());
    expect(
      shards.some((shard) => Object.keys(measured).every((file) => shard.includes(file))),
      "ASSERTION: the 110-second crew and 74-second engine suites must not share a runner",
    ).toBe(false);
    const totals = shards.map((shard) =>
      shard.reduce((sum, file) => sum + (measured[file as keyof typeof measured] ?? 1_000), 0),
    );
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThan(2_000);
    expect(
      [1, 2, 3, 4].map((index) => spreadShard(inventory.toReversed(), index, 4, measured)),
    ).toEqual(shards);
  });
});
