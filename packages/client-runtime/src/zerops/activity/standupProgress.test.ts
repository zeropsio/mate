import { describe, expect, it } from "vite-plus/test";

import { readStandUpProgress, standupReadingFromProgress } from "./standupProgress.ts";

const NOW = Date.parse("2026-10-01T10:05:00Z");

const payload = (services: ReadonlyArray<Record<string, unknown>>) => ({
  toolCallId: "call-1",
  zeropsStandUp: { phase: "development", state: "running", services },
});

describe("readStandUpProgress", () => {
  it("reads the relayed services and drops what it cannot", () => {
    expect(
      readStandUpProgress(
        payload([
          { hostname: "api", step: "deploy", state: "running", processId: "p-1", at: "t" },
          { hostname: "web", step: "later", state: "running" },
          { step: "build", state: "running" },
        ]),
      ),
    ).toEqual({
      phase: "development",
      state: "running",
      services: [{ hostname: "api", step: "deploy", state: "running", processId: "p-1", at: "t" }],
    });
  });

  it("is undefined for a row that carries none", () => {
    expect(readStandUpProgress({ toolCallId: "call-1", taskId: "t" })).toBeUndefined();
    expect(readStandUpProgress(undefined)).toBeUndefined();
  });
});

describe("standupReadingFromProgress", () => {
  const cases: ReadonlyArray<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["a step not started waits", { step: "build", state: "pending" }, { state: "waits" }],
    [
      "a running build builds",
      { step: "build", state: "running", at: "2026-10-01T10:01:00Z" },
      { state: "building", sentence: "Building", startedAt: "2026-10-01T10:01:00Z" },
    ],
    [
      "a running deploy deploys",
      { step: "deploy", state: "running" },
      { state: "building", sentence: "Deploying" },
    ],
    [
      "a build done goes on to its deploy",
      { step: "build", state: "done" },
      { state: "building", sentence: "Deploying" },
    ],
    ["a verify done is up", { step: "verify", state: "done" }, { state: "up" }],
    [
      "a failed step says why",
      { step: "deploy", state: "failed", error: "port 3000 never opened" },
      { state: "failed", reason: "port 3000 never opened" },
    ],
  ];
  it.each(Array.from(cases, ([name, service, expected]) => ({ title: name, service, expected })))(
    "$title",
    ({ service, expected }) => {
      const progress = readStandUpProgress(payload([{ hostname: "api", ...service }]))!;
      expect(standupReadingFromProgress(progress, { nowMs: NOW }).rows).toEqual([
        { hostname: "api", ...expected },
      ]);
    },
  );

  it("counts what builds, is up and failed", () => {
    const progress = readStandUpProgress(
      payload([
        { hostname: "db", step: "verify", state: "done" },
        { hostname: "api", step: "build", state: "running" },
        { hostname: "web", step: "deploy", state: "failed" },
      ]),
    )!;
    const reading = standupReadingFromProgress(progress, { nowMs: NOW });
    expect([reading.up, reading.building, reading.failed]).toEqual([1, 1, 1]);
  });
});
