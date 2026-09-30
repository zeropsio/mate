import { describe, expect, it } from "vite-plus/test";

import { standupReadingOf as reading } from "@t3tools/client-runtime/zerops/activity/standupReading";

import { standupBar, standupRow } from "./standupBar.logic";

const T = "2026-09-02T10:01:00.000Z";

describe("standupBar — the docked bar of a stand-up call, from its reading", () => {
  it.each([
    {
      name: "just started: the data and the utility up, the runtimes queued",
      rows: [
        { hostname: "db", state: "up" },
        { hostname: "cache", state: "up" },
        { hostname: "mailer", state: "up" },
        { hostname: "apidev", state: "waits" },
        { hostname: "webdev", state: "waits" },
      ] as const,
      words: "Getting ready",
      figure: "3 of 5 up",
      tones: ["done", "done", "done", "waiting", "waiting"],
    },
    {
      name: "one building: its step, by its name",
      rows: [
        { hostname: "db", state: "up" },
        {
          hostname: "apidev",
          state: "building",
          startedAt: T,
          sentence: "Running build commands from zerops.yml",
        },
        { hostname: "webdev", state: "waits" },
      ] as const,
      words: "apidev: Running build commands from zerops.yml",
      figure: "1 of 3 up",
      tones: ["done", "running", "waiting"],
    },
    {
      name: "one building whose step is not known yet",
      rows: [{ hostname: "apidev", state: "building", startedAt: T }] as const,
      words: "apidev: Building",
      figure: "0 of 1 up",
      tones: ["running"],
    },
    {
      name: "several building: how many",
      rows: [
        { hostname: "db", state: "up" },
        { hostname: "apidev", state: "building", startedAt: T, sentence: "Deploying" },
        { hostname: "webdev", state: "building", startedAt: T },
      ] as const,
      words: "2 building",
      figure: "1 of 3 up",
      tones: ["done", "running", "running"],
    },
    {
      name: "one runtime up, one building",
      rows: [
        { hostname: "db", state: "up" },
        { hostname: "apidev", state: "up", startedAt: T, endedAt: T },
        { hostname: "webdev", state: "building", startedAt: T, sentence: "Deploying" },
      ] as const,
      words: "webdev: Deploying",
      figure: "2 of 3 up",
      tones: ["done", "done", "running"],
    },
    {
      name: "one failed and the rest go on: the build that runs is the words",
      rows: [
        { hostname: "db", state: "up" },
        { hostname: "apistage", state: "failed", startedAt: T, endedAt: T },
        { hostname: "webstage", state: "building", startedAt: T },
      ] as const,
      words: "webstage: Building",
      figure: "1 of 3 up",
      tones: ["done", "failed", "running"],
    },
    {
      name: "one failed and nothing runs any more: the failure",
      rows: [
        { hostname: "db", state: "up" },
        { hostname: "apistage", state: "failed", startedAt: T, endedAt: T },
        { hostname: "webstage", state: "up", startedAt: T, endedAt: T },
      ] as const,
      words: "apistage failed",
      figure: "2 of 3 up",
      tones: ["done", "failed", "done"],
    },
    {
      name: "all up",
      rows: [
        { hostname: "db", state: "up" },
        { hostname: "apidev", state: "up", startedAt: T, endedAt: T },
        { hostname: "webdev", state: "up", startedAt: T, endedAt: T },
      ] as const,
      words: "All up",
      figure: "3 of 3 up",
      tones: ["done", "done", "done"],
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
    { row: { hostname: "webdev", state: "waits" } as const, tone: "off", word: "Queued" },
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
      row: { hostname: "files", state: "building", sentence: "Starting" } as const,
      tone: "busy",
      word: "Starting",
    },
    {
      row: { hostname: "webdev", state: "up", startedAt: T, endedAt: T } as const,
      tone: "ok",
      word: "Up",
    },
    { row: { hostname: "db", state: "up" } as const, tone: "ok", word: "Up" },
    {
      row: { hostname: "webdev", state: "failed", startedAt: T, endedAt: T } as const,
      tone: "failed",
      word: "Build failed",
    },
    { row: { hostname: "cache", state: "failed" } as const, tone: "failed", word: "Failed" },
  ])("$row.hostname $row.state", ({ row, tone, word }) => {
    expect(standupRow(row)).toEqual({ tone, word });
  });
});
