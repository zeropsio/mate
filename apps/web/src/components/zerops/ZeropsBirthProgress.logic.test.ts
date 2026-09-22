import { describe, expect, it } from "vite-plus/test";

import type { BirthStep } from "@t3tools/client-runtime/zerops/birthProgress";

import {
  BIRTH_STEP_TONE,
  birthLineDetailStep,
  birthStepToProcessStep,
  formatBirthElapsed,
} from "./ZeropsBirthProgress.logic";

function step(partial: Partial<BirthStep> & Pick<BirthStep, "id" | "state">): BirthStep {
  return { label: "Container", ...partial };
}

describe("formatBirthElapsed", () => {
  it.each([
    [0, "0:00"],
    [4_000, "0:04"],
    [65_000, "1:05"],
    [600_000, "10:00"],
    [3_661_000, "61:01"],
  ])("formats %i ms as %s", (ms, expected) => {
    expect(formatBirthElapsed(ms)).toBe(expected);
  });

  it("never goes negative — a clock tick that lands before the start reads as 0:00", () => {
    expect(formatBirthElapsed(-500)).toBe("0:00");
  });
});

describe("BIRTH_STEP_TONE", () => {
  it("gives every birth step state a status tone", () => {
    expect(BIRTH_STEP_TONE).toEqual({
      waiting: "off",
      active: "busy",
      done: "ok",
      failed: "failed",
    });
  });
});

describe("birthStepToProcessStep", () => {
  const NOW = Date.parse("2026-09-22T10:05:00Z");

  it("maps waiting to the queued glyph, hidden state word", () => {
    const result = birthStepToProcessStep(step({ id: "hardening", state: "waiting" }), NOW);
    expect(result).toMatchObject({ id: "hardening", state: "queued", stateLabel: "Waiting" });
  });

  it("maps done to the done glyph, hidden state word", () => {
    const result = birthStepToProcessStep(step({ id: "project", state: "done" }), NOW);
    expect(result).toMatchObject({ state: "done", stateLabel: "Done" });
  });

  it("maps active to the running glyph with its own detail as the note", () => {
    const result = birthStepToProcessStep(
      step({ id: "container", state: "active", detail: "Building the container" }),
      NOW,
    );
    expect(result).toMatchObject({
      state: "running",
      stateLabel: "Active",
      note: "Building the container",
    });
  });

  it("maps failed to the failed glyph with its own detail as the note", () => {
    const result = birthStepToProcessStep(
      step({ id: "container", state: "failed", detail: "Could not be created." }),
      NOW,
    );
    expect(result).toMatchObject({
      state: "failed",
      stateLabel: "Failed",
      note: "Could not be created.",
    });
  });

  it("carries no duration when the step has not started", () => {
    const result = birthStepToProcessStep(step({ id: "mate", state: "waiting" }), NOW);
    expect(result.durationMs).toBeUndefined();
  });

  it("takes a finished step's duration from its own started/ended timestamps", () => {
    const result = birthStepToProcessStep(
      step({
        id: "project",
        state: "done",
        startedAt: "2026-09-22T10:00:00Z",
        endedAt: "2026-09-22T10:00:05Z",
      }),
      NOW,
    );
    expect(result.durationMs).toBe(5_000);
  });

  it("takes a running step's duration up to now, when it has not ended yet", () => {
    const result = birthStepToProcessStep(
      step({ id: "container", state: "active", startedAt: "2026-09-22T10:04:30Z" }),
      NOW,
    );
    expect(result.durationMs).toBe(30_000);
  });

  it("carries no duration for a waiting step that merely has an inherited startedAt", () => {
    // Backfill can leave an earlier step's startedAt/endedAt on a step whose
    // own state is still waiting only in pathological input; the duration is
    // never guessed for anything but a running or already-ended step.
    const result = birthStepToProcessStep(
      step({ id: "hardening", state: "waiting", startedAt: "2026-09-22T10:00:00Z" }),
      NOW,
    );
    expect(result.durationMs).toBeUndefined();
  });
});

describe("birthLineDetailStep", () => {
  const container = step({ id: "container", state: "active", detail: "Building the container" });
  const hardening = step({ id: "hardening", state: "failed", detail: "token rotation failed" });

  it("prefers the failed step over the active one", () => {
    expect(birthLineDetailStep({ active: container, failed: hardening })).toBe(hardening);
  });

  it("falls back to the active step when nothing failed", () => {
    expect(birthLineDetailStep({ active: container, failed: null })).toBe(container);
  });

  it("is null once the birth is complete and nothing failed", () => {
    expect(birthLineDetailStep({ active: null, failed: null })).toBeNull();
  });
});
