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

  it.each(Array.from(cases, (entry) => ({ title: `${entry.name}: ${entry.pose}`, entry })))(
    "$title",
    ({ entry }) => {
      expect(matePose(entry.face, entry.facts)).toBe(entry.pose);
    },
  );
});

describe("mateArriving", () => {
  const created = "2026-10-03T10:00:00Z";
  const born = Date.parse(created);
  const unsigned = { created };
  // HQ, rather than project labels, owns the observed signer.
  const signedOnce = {
    hq: {
      appId: "a",
      appName: "App",
      kind: "mate" as const,
      mate: {
        name: "Kai",
        face: "rose:seal",
        logins: { "claude-code": { signedInBy: "u-eva", present: true, token: false } },
      },
    },
    created,
  };
  const withLogins = (
    logins: Record<
      string,
      {
        signedInBy: string | null;
        lastSignedInBy?: string | null;
        present: boolean;
        token: boolean;
      }
    >,
  ) => ({ hq: { ...signedOnce.hq, mate: { ...signedOnce.hq.mate, logins } }, created });
  // A sign-out keeps the last signer; HQ's saved signers arrive the same way before its live logins.
  const signedOutSince = withLogins({
    "claude-code": { signedInBy: null, lastSignedInBy: "u-eva", present: false, token: false },
  });
  const signedInOnOpenCode = withLogins({
    opencode: { signedInBy: "u-eva", present: true, token: false },
  });
  const signedOutOfOpenCode = withLogins({
    opencode: { signedInBy: null, lastSignedInBy: "u-eva", present: false, token: false },
  });
  // Its agent runs without a sign-in, as the overview it sent HQ once up says (`runsWithoutSignIn`).
  const readyAgent = (runsWithoutSignIn: boolean) => ({
    hq: { ...signedOnce.hq, mate: { name: "Kai", face: "rose:seal", runsWithoutSignIn } },
    created,
  });
  const nobodyYet = withLogins({
    "claude-code": { signedInBy: null, lastSignedInBy: null, present: false, token: false },
  });

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
      name: "HQ records its signer, a minute old",
      candidate: { project: signedOnce, group: "connected" },
      atMs: born + 60_000,
      arriving: false,
    },
    {
      name: "signed in once, signed out since, a minute old",
      candidate: { project: signedOutSince, group: "connected" },
      atMs: born + 60_000,
      arriving: false,
    },
    {
      name: "signed in on another agent, a minute old",
      candidate: { project: signedInOnOpenCode, group: "connected" },
      atMs: born + 60_000,
      arriving: false,
    },
    {
      name: "signed out of another agent since, a minute old",
      candidate: { project: signedOutOfOpenCode, group: "connected" },
      atMs: born + 60_000,
      arriving: false,
    },
    {
      name: "its logins told, nobody signed in yet, a minute old",
      candidate: { project: nobodyYet, group: "connected" },
      atMs: born + 60_000,
      arriving: true,
    },
    {
      name: "its agent runs without a sign-in, its container up, a minute old",
      candidate: { project: readyAgent(true), group: "ready" },
      atMs: born + 60_000,
      arriving: false,
    },
    {
      name: "its agent runs without a sign-in, told by HQ before the listing has it up",
      candidate: { project: readyAgent(true), group: "provisioning" },
      atMs: born + 60_000,
      arriving: false,
    },
    {
      name: "its agent waits on a sign-in, its container up, a minute old",
      candidate: { project: readyAgent(false), group: "connected" },
      atMs: born + 60_000,
      arriving: true,
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
      candidate: { project: {}, group: "connected" },
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

  it.each(
    Array.from(cases, (entry) => ({
      title: `${entry.name}: ${entry.arriving ? "arriving" : "not arriving"}`,
      entry,
    })),
  )("$title", ({ entry }) => {
    expect(mateArriving(mateArrivingUntil(entry.candidate), entry.atMs)).toBe(entry.arriving);
  });
});
