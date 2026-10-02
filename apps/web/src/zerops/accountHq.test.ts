import { describe, expect, it } from "vite-plus/test";

import { nextHqStanding, readBundledCore, type HqStanding } from "./accountHq";

describe("nextHqStanding", () => {
  const healthy = { kind: "healthy", build: "b1" } as const;
  const down = { kind: "unreachable" } as const;
  it.each<[string, HqStanding, Parameters<typeof nextHqStanding>[1], HqStanding]>([
    ["a first answer as the official HQ", { kind: "unknown" }, healthy, { kind: "healthy" }],
    [
      "a first read that fails: unavailable from now",
      { kind: "unknown" },
      down,
      { kind: "unavailable", since: 5_000 },
    ],
    [
      "an outage keeps the time it began",
      { kind: "unavailable", since: 1_000 },
      { kind: "not-ready", state: "standby", official: "unknown" },
      { kind: "unavailable", since: 1_000 },
    ],
    ["HQ back", { kind: "unavailable", since: 1_000 }, healthy, { kind: "healthy" }],
  ])("%s", (_name, previous, health, expected) => {
    expect(nextHqStanding(previous, health, 5_000)).toEqual(expected);
  });
});

describe("readBundledCore — Core as this build carries it", () => {
  const TAR = new TextEncoder().encode("dist/main.mjs and zerops.yml, as a plain tar");
  const gunzip = async (bytes: Uint8Array<ArrayBuffer>) =>
    new Uint8Array(
      await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer(),
    );
  const gzip = async (bytes: Uint8Array<ArrayBuffer>) =>
    new Uint8Array(
      await new Response(
        new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
  /** A server answering the build's two files; `archive` as the browser hands its body over. */
  const served = (archive: Uint8Array<ArrayBuffer>) => {
    const asked: Array<string> = [];
    const fetch = async (input: RequestInfo | URL) => {
      const path = String(input);
      asked.push(path);
      return path.endsWith("/zerops.yml")
        ? new Response("zerops:\n  - setup: hq\n")
        : new Response(archive);
    };
    return { asked, fetch: fetch as typeof globalThis.fetch };
  };

  it("hands over a gzip even where the server sent it gzip-encoded and the browser unpacked it", async () => {
    // Measured on the rig, 2026-10-02: a static server served `core.tar.gz` with
    // `Content-Encoding: gzip`, the browser decoded it, and Core's build failed on a plain tar.
    const { fetch } = served(TAR);
    const core = await readBundledCore(fetch, "/hq-core");
    expect(Array.from(core.archive.subarray(0, 2))).toEqual([0x1f, 0x8b]);
    expect(await gunzip(core.archive)).toEqual(TAR);
    expect(core.zeropsYaml).toBe("zerops:\n  - setup: hq\n");
  });

  it("hands a gzip it was given over byte for byte, from a name no server takes for an encoding", async () => {
    const archive = await gzip(TAR);
    const { asked, fetch } = served(archive);
    const core = await readBundledCore(fetch, "/hq-core");
    expect(core.archive).toEqual(archive);
    expect(asked).toEqual(["/hq-core/core.tgz.bin", "/hq-core/zerops.yml"]);
  });
});
