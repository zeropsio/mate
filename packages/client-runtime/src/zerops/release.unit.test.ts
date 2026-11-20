import { expect, it } from "vite-plus/test";

import type { ReleaseDeployFailure } from "./groupDeploys.ts";
import { type FlowRelease, type ReleaseEntry, releaseRow, releaseRunBy } from "./release.ts";

const API = "1a2b3c4d".repeat(5);
const WEB = "5e6f7a8b".repeat(5);
const OLD = "9c9c9c9c".repeat(5);

const release = (tag: string, entries: ReadonlyArray<ReleaseEntry>): FlowRelease => ({
  tag,
  verdict: "approved",
  detail: undefined,
  line: "",
  entries,
  taggedAt: "2026-11-01T08:00:00Z",
});

// witness: packages/client-runtime/src/zerops/release.ts | release.entries.length > 0 && → release.entries.length >= 0 &&
it("ZV145: A release row compares full commits, never short ones, names every failed service, and never calls an empty release Live", () => {
  const full = release("v0.1.1", [
    { service: "api", commit: API },
    { service: "web", commit: WEB },
  ]);
  const empty = release("v0.1.2", []);
  const running = new Map([
    ["api", API],
    ["web", WEB],
  ]);
  expect(releaseRunBy([empty, full], running)).toBe("v0.1.1");
  expect(releaseRunBy([empty], running)).toBeUndefined();

  const short = release("v0.1.3", [
    { service: "api", commit: API.slice(0, 7) },
    { service: "web", commit: WEB.slice(0, 7) },
  ]);
  expect(releaseRunBy([short], running)).toBeUndefined();

  const failed: ReadonlyArray<ReleaseDeployFailure> = [
    { tag: "v0.1.1", service: "web", sha: WEB },
    { tag: "v0.1.1", service: "api", sha: API },
  ];
  const row = releaseRow(full, 0, {
    production: new Map([
      ["api", OLD],
      ["web", OLD],
    ]),
    failed,
    live: false,
  });
  expect(row.standing).toBe("deploy-failed");
  expect(row.failedEntries).toEqual(full.entries);
});
