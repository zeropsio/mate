import type { MateMarkState } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import { matePose, type MateLife } from "./matePose.ts";

describe("matePose", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly life: MateLife;
    readonly answered: boolean;
    readonly face: MateMarkState;
    readonly pose: MateMarkState;
  }> = [
    {
      name: "coming up, its socket not open",
      life: "coming",
      answered: false,
      face: "sleep",
      pose: "waking",
    },
    {
      name: "coming up, its socket open",
      life: "coming",
      answered: false,
      face: "idle",
      pose: "waking",
    },
    {
      name: "coming up, an old sign-in tag",
      life: "coming",
      answered: true,
      face: "idle",
      pose: "waking",
    },
    {
      name: "up, waiting for its sign-in",
      life: "up",
      answered: false,
      face: "idle",
      pose: "waking",
    },
    { name: "up, signed in, at rest", life: "up", answered: true, face: "idle", pose: "idle" },
    {
      name: "up, signed in, at work",
      life: "up",
      answered: true,
      face: "working",
      pose: "working",
    },
    { name: "up, signed in, needs you", life: "up", answered: true, face: "needs", pose: "needs" },
    { name: "up, done", life: "up", answered: true, face: "done", pose: "done" },
    {
      name: "not running, never signed in",
      life: "up",
      answered: false,
      face: "sleep",
      pose: "sleep",
    },
    { name: "not running, signed in", life: "up", answered: true, face: "sleep", pose: "sleep" },
    { name: "did not come up", life: "failed", answered: false, face: "idle", pose: "sleep" },
    {
      name: "deleting, at work a moment ago",
      life: "deleting",
      answered: true,
      face: "working",
      pose: "sleep",
    },
    {
      name: "deleting, never signed in",
      life: "deleting",
      answered: false,
      face: "idle",
      pose: "sleep",
    },
  ];

  for (const entry of cases) {
    it(`${entry.name}: ${entry.pose}`, () => {
      expect(matePose({ life: entry.life, answered: entry.answered, face: entry.face })).toBe(
        entry.pose,
      );
    });
  }
});
