import { describe, expect, it } from "vite-plus/test";

import type {
  StandupReading,
  StandupServiceRow,
} from "@t3tools/client-runtime/zerops/activity/standupReading";

import { standupBar, standupRow } from "./standupBar.logic";

function reading(rows: ReadonlyArray<StandupServiceRow>): StandupReading {
  return {
    rows,
    building: rows.filter((row) => row.state === "building").length,
    built: rows.filter((row) => row.state === "built").length,
    failed: rows.filter((row) => row.state === "failed").length,
  };
}

const T = "2026-09-02T10:01:00.000Z";

describe("standupBar — the docked bar of a stand-up call, from its reading", () => {
  it.each([
    {
      name: "no build yet: getting ready, none of them built",
      rows: [
        { hostname: "apidev", state: "waits" },
        { hostname: "webdev", state: "waits" },
      ] as const,
      words: "Getting ready",
      figure: "0 of 2",
      tones: ["waiting", "waiting"],
    },
    {
      name: "one building: its step, by its name",
      rows: [
        {
          hostname: "apidev",
          state: "building",
          startedAt: T,
          sentence: "Running build commands from zerops.yml",
        },
        { hostname: "webdev", state: "waits" },
      ] as const,
      words: "apidev: Running build commands from zerops.yml",
      figure: "0 of 2",
      tones: ["running", "waiting"],
    },
    {
      name: "one building whose step is not known yet",
      rows: [{ hostname: "apidev", state: "building", startedAt: T }] as const,
      words: "apidev: Building",
      figure: "0 of 1",
      tones: ["running"],
    },
    {
      name: "several building: how many",
      rows: [
        { hostname: "apidev", state: "building", startedAt: T, sentence: "Deploying" },
        { hostname: "apistage", state: "building", startedAt: T },
        { hostname: "webdev", state: "building", startedAt: T },
        { hostname: "webstage", state: "waits" },
      ] as const,
      words: "3 building",
      figure: "0 of 4",
      tones: ["running", "running", "running", "waiting"],
    },
    {
      name: "one built, one building",
      rows: [
        { hostname: "apidev", state: "built", startedAt: T, endedAt: T },
        { hostname: "webdev", state: "building", startedAt: T, sentence: "Deploying" },
      ] as const,
      words: "webdev: Deploying",
      figure: "1 of 2",
      tones: ["done", "running"],
    },
    {
      name: "one failed and the rest go on: the build that runs is the words",
      rows: [
        { hostname: "apistage", state: "failed", startedAt: T, endedAt: T },
        { hostname: "webstage", state: "building", startedAt: T },
      ] as const,
      words: "webstage: Building",
      figure: "0 of 2",
      tones: ["failed", "running"],
    },
    {
      name: "one failed and nothing runs any more: the failure",
      rows: [
        { hostname: "apistage", state: "failed", startedAt: T, endedAt: T },
        { hostname: "webstage", state: "built", startedAt: T, endedAt: T },
      ] as const,
      words: "apistage failed",
      figure: "1 of 2",
      tones: ["failed", "done"],
    },
    {
      name: "all built",
      rows: [
        { hostname: "apidev", state: "built", startedAt: T, endedAt: T },
        { hostname: "webdev", state: "built", startedAt: T, endedAt: T },
      ] as const,
      words: "All built",
      figure: "2 of 2",
      tones: ["done", "done"],
    },
  ])("$name", ({ rows, words, figure, tones }) => {
    const bar = standupBar(reading(rows));
    expect(bar.words).toBe(words);
    expect(bar.figure).toBe(figure);
    expect(bar.segments.map((segment) => segment.tone)).toEqual(tones);
    expect(bar.failed).toBe(rows.some((row) => row.state === "failed"));
  });

  it("nothing read yet: getting ready, one running segment, no count", () => {
    expect(standupBar(null)).toEqual({
      words: "Getting ready",
      figure: null,
      segments: [{ key: "whole", tone: "running" }],
      failed: false,
    });
  });
});

describe("standupRow — a service under the opened bar", () => {
  it.each([
    { row: { hostname: "webdev", state: "waits" } as const, tone: "off", word: "Waits" },
    {
      row: { hostname: "webstage", state: "waits", note: "apistage did not stand up" } as const,
      tone: "off",
      word: "Waits: apistage did not stand up",
    },
    {
      row: { hostname: "webdev", state: "building", startedAt: T, sentence: "Deploying" } as const,
      tone: "busy",
      word: "Deploying",
    },
    {
      row: { hostname: "webdev", state: "building", startedAt: T } as const,
      tone: "busy",
      word: "Building",
    },
    {
      row: { hostname: "webdev", state: "built", startedAt: T, endedAt: T } as const,
      tone: "ok",
      word: "Built",
    },
    {
      row: { hostname: "webdev", state: "failed", startedAt: T, endedAt: T } as const,
      tone: "failed",
      word: "Build failed",
    },
  ])("$row.state", ({ row, tone, word }) => {
    expect(standupRow(row)).toEqual({ tone, word });
  });
});
