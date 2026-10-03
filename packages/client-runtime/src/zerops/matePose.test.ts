import type { MateMarkState } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import {
  MATE_ARRIVAL_WINDOW_MS,
  mateArriving,
  mateArrivingUntil,
  matePose,
  type MatePoseFacts,
} from "./matePose.ts";

describe("matePose", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly facts: MatePoseFacts | undefined;
    readonly face: MateMarkState;
    readonly pose: MateMarkState;
  }> = [
    {
      name: "coming up, its socket not open",
      facts: { life: "coming" },
      face: "sleep",
      pose: "waking",
    },
    { name: "coming up, its socket open", facts: { life: "coming" }, face: "idle", pose: "waking" },
    {
      name: "coming up, past its window",
      facts: { life: "coming", arriving: false },
      face: "sleep",
      pose: "waking",
    },
    {
      name: "up, arriving, its sign-in to come",
      facts: { arriving: true },
      face: "idle",
      pose: "waking",
    },
    {
      name: "up, arriving, its socket not open yet",
      facts: { arriving: true },
      face: "sleep",
      pose: "waking",
    },
    { name: "up, arriving, at work", facts: { arriving: true }, face: "working", pose: "working" },
    {
      name: "up, no longer arriving, unsigned",
      facts: { arriving: false },
      face: "idle",
      pose: "idle",
    },
    {
      name: "up, no longer arriving, not running",
      facts: { arriving: false },
      face: "sleep",
      pose: "sleep",
    },
    { name: "settled, at rest", facts: undefined, face: "idle", pose: "idle" },
    { name: "settled, at work", facts: {}, face: "working", pose: "working" },
    { name: "settled, needs you", facts: {}, face: "needs", pose: "needs" },
    { name: "settled, done", facts: {}, face: "done", pose: "done" },
    { name: "settled, not running", facts: {}, face: "sleep", pose: "sleep" },
    {
      name: "did not come up",
      facts: { life: "failed", arriving: true },
      face: "idle",
      pose: "sleep",
    },
    {
      name: "deleting, at work a moment ago",
      facts: { life: "deleting" },
      face: "working",
      pose: "sleep",
    },
    {
      name: "deleting, arriving",
      facts: { life: "deleting", arriving: true },
      face: "idle",
      pose: "sleep",
    },
  ];

  for (const entry of cases) {
    it(`${entry.name}: ${entry.pose}`, () => {
      expect(matePose(entry.face, entry.facts)).toBe(entry.pose);
    });
  }
});

describe("mateArriving", () => {
  const created = "2026-10-03T10:00:00Z";
  const born = Date.parse(created);
  const unsigned = { tagList: ["mate", "mate:bot:Kai"], created };
  // A sign-out keeps the tag: a Mate once signed in has arrived for good.
  const signedOnce = { tagList: ["mate", "mate:signer:claude-code:u-eva"], created };

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly candidate: Parameters<typeof mateArrivingUntil>[0];
    readonly atMs: number;
    readonly arriving: boolean;
  }> = [
    {
      name: "unsigned, a minute old",
      candidate: { project: unsigned, group: "provisioning" },
      atMs: born + 60_000,
      arriving: true,
    },
    {
      name: "unsigned and up, waiting for its sign-in",
      candidate: { project: unsigned, group: "connected" },
      atMs: born + 10 * 60_000,
      arriving: true,
    },
    {
      name: "unsigned, 29 minutes old",
      candidate: { project: unsigned, group: "connected" },
      atMs: born + 29 * 60_000,
      arriving: true,
    },
    {
      name: "unsigned, 31 minutes old",
      candidate: { project: unsigned, group: "connected" },
      atMs: born + 31 * 60_000,
      arriving: false,
    },
    {
      name: "unsigned, past its window",
      candidate: { project: unsigned, group: "connected" },
      atMs: born + MATE_ARRIVAL_WINDOW_MS,
      arriving: false,
    },
    {
      name: "unsigned, days old (a colleague's under Everyone)",
      candidate: { project: unsigned, group: "connected" },
      atMs: born + 3 * 86_400_000,
      arriving: false,
    },
    {
      name: "signed in once, signed out since, a minute old",
      candidate: { project: signedOnce, group: "connected" },
      atMs: born + 60_000,
      arriving: false,
    },
    {
      name: "signed in once, old",
      candidate: { project: signedOnce, group: "connected" },
      atMs: born + 86_400_000,
      arriving: false,
    },
    {
      name: "unsigned, its container unavailable",
      candidate: { project: unsigned, group: "unavailable" },
      atMs: born + 60_000,
      arriving: false,
    },
    {
      name: "unsigned, its creation time not known",
      candidate: { project: { tagList: [] }, group: "connected" },
      atMs: born,
      arriving: false,
    },
    {
      name: "unsigned, made ahead of this clock",
      candidate: { project: unsigned, group: "provisioning" },
      atMs: born - 5_000,
      arriving: true,
    },
  ];

  for (const entry of cases) {
    it(`${entry.name}: ${entry.arriving ? "arriving" : "not arriving"}`, () => {
      expect(mateArriving(mateArrivingUntil(entry.candidate), entry.atMs)).toBe(entry.arriving);
    });
  }
});
