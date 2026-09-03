// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { describe, expect, it } from "vite-plus/test";

import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { Observation } from "@t3tools/client-runtime/zerops/activity/observe";

import type { ProjectActivitySnapshot } from "./projectActivityPoller.ts";
import {
  OPERATION_OBSERVATION_CEILING_MS,
  deriveOperationObservation,
  type DeriveOperationObservationInput,
  type ObservationTarget,
} from "./useOperationObservation.ts";

const NOW = Date.parse("2026-09-02T10:00:00.000Z");

function process(overrides: Partial<ActivityProcess>): ActivityProcess {
  return {
    id: "p1",
    projectId: "proj-1",
    serviceStackIds: ["svc-1"],
    status: "RUNNING",
    actionName: "stack.deploy",
    created: "2026-09-02T10:00:00.000Z",
    ...overrides,
  };
}

function target(overrides: Partial<ObservationTarget> = {}): ObservationTarget {
  return {
    key: "deploy:weatherdash:1",
    kind: "deploy",
    hostnames: ["weatherdash"],
    startedAtMs: NOW,
    running: true,
    ...overrides,
  };
}

const EMPTY_SNAPSHOT: ProjectActivitySnapshot = { processes: undefined, atMs: undefined };

function baseInput(
  overrides: Partial<DeriveOperationObservationInput> = {},
): DeriveOperationObservationInput {
  return {
    target: target(),
    attributable: true,
    notAttributableReason: "no-target",
    serviceIds: ["svc-1"],
    projectId: "proj-1",
    snapshot: EMPTY_SNAPSHOT,
    previousLastRead: undefined,
    previousHistory: undefined,
    ...overrides,
  };
}

describe("deriveOperationObservation — the hook's pure decision logic", () => {
  it("off: no-target when there is no target at all", () => {
    const result = deriveOperationObservation(baseInput({ target: null }), NOW);
    expect(result.state).toEqual({ kind: "off", reason: "no-target" });
    expect(result.wantsPoll).toBe(false);
  });

  it("observing (empty steps) before the first read, and wants to poll while running", () => {
    const result = deriveOperationObservation(baseInput(), NOW + 2_000);
    expect(result.state.kind).toBe("observing");
    expect(result.wantsPoll).toBe(true);
  });

  it("observing after the first read lands, folding the snapshot into an attribution", () => {
    const p = process({ appVersion: { status: "BUILDING", build: { pipelineStart: "t1" } } });
    const snapshot: ProjectActivitySnapshot = { processes: [p], atMs: NOW };
    const result = deriveOperationObservation(baseInput({ snapshot }), NOW);
    expect(result.state.kind).toBe("observing");
    expect(
      result.state.kind === "observing" && result.state.observation.steps.length,
    ).toBeGreaterThan(0);
    expect(result.lastRead?.atMs).toBe(NOW);
  });

  it("remembers the last read across calls when the snapshot goes stale (no fresh processes)", () => {
    const p = process({ appVersion: { status: "BUILDING" } });
    const first = deriveOperationObservation(
      baseInput({ snapshot: { processes: [p], atMs: NOW } }),
      NOW,
    );
    const second = deriveOperationObservation(
      baseInput({ snapshot: EMPTY_SNAPSHOT, previousLastRead: first.lastRead }),
      NOW + 11_000,
    );
    expect(second.state.kind).toBe("stale");
  });

  /**
   * The poller's `processes` is `[]`, not `undefined`, once it has read
   * successfully at least once and found nothing relevant (dto.ts's own
   * "a valid observation that just found nothing" distinction) — the
   * everyday shape of "still polling, target not attributed (yet)", not the
   * rarer "poller has never read anything at all" case the previous test
   * covers. A read that succeeds but attributes nothing new must NOT reset
   * the staleness clock, or an operation that stops appearing in the poll
   * (e.g. between the tool call starting and the platform process existing)
   * would never go stale — it would sit "observing" forever off an
   * increasingly out-of-date `atMs`.
   */
  it("does not refresh lastRead on a successful poll that attributes nothing for this target", () => {
    const p = process({ appVersion: { status: "BUILDING" } });
    const first = deriveOperationObservation(
      baseInput({ snapshot: { processes: [p], atMs: NOW } }),
      NOW,
    );
    const second = deriveOperationObservation(
      baseInput({
        snapshot: { processes: [], atMs: NOW + 5_000 },
        previousLastRead: first.lastRead,
      }),
      NOW + 11_000,
    );
    expect(second.state.kind).toBe("stale");
    expect(second.lastRead?.atMs).toBe(NOW);
  });

  it("history is kept once running flips false — the last non-empty-steps observation persists", () => {
    const p = process({ appVersion: { status: "BUILDING", build: { pipelineStart: "t1" } } });
    const running = deriveOperationObservation(
      baseInput({ snapshot: { processes: [p], atMs: NOW } }),
      NOW,
    );
    expect(running.history?.steps.length).toBeGreaterThan(0);

    const stopped = deriveOperationObservation(
      baseInput({
        target: target({ running: false }),
        snapshot: EMPTY_SNAPSHOT,
        previousHistory: running.history,
      }),
      NOW + 60_000,
    );
    expect(stopped.history).toEqual(running.history);
    expect(stopped.wantsPoll).toBe(false);
  });

  it("does not overwrite history with an empty-steps observation", () => {
    const p = process({ appVersion: { status: "BUILDING", build: { pipelineStart: "t1" } } });
    const withSteps = deriveOperationObservation(
      baseInput({ snapshot: { processes: [p], atMs: NOW } }),
      NOW,
    );

    const noStepsYet = deriveOperationObservation(
      baseInput({ snapshot: EMPTY_SNAPSHOT, previousHistory: withSteps.history }),
      NOW + 1_000,
    );
    expect(noStepsYet.history).toEqual(withSteps.history);
  });

  it("stops polling once the pipeline outcome settles, even while the operation is still running", () => {
    const settled = process({ appVersion: { status: "ACTIVE" } });
    const result = deriveOperationObservation(
      baseInput({ snapshot: { processes: [settled], atMs: NOW } }),
      NOW,
    );
    expect(result.state.kind === "observing" && result.state.observation.outcome).toBe("finished");
    expect(result.wantsPoll).toBe(false);
  });

  it("stops polling once the operation is no longer running", () => {
    const result = deriveOperationObservation(
      baseInput({ target: target({ running: false }) }),
      NOW,
    );
    expect(result.wantsPoll).toBe(false);
  });

  it("stops polling past the ceiling", () => {
    const result = deriveOperationObservation(
      baseInput(),
      NOW + OPERATION_OBSERVATION_CEILING_MS + 1,
    );
    expect(result.wantsPoll).toBe(false);
    expect(result.state).toEqual({ kind: "off", reason: "ceiling" });
  });

  it("off with the caller's not-attributable reason when attributable is false", () => {
    const result = deriveOperationObservation(
      baseInput({ attributable: false, notAttributableReason: "no-session" }),
      NOW,
    );
    expect(result.state).toEqual({ kind: "off", reason: "no-session" });
    expect(result.wantsPoll).toBe(false);
  });

  /**
   * A project mismatch means the poll is reading the wrong project entirely
   * — no process for the right project is ever going to arrive from it.
   * Polling must stop here rather than run to the 30-minute ceiling, the
   * same as every other `off` reason.
   */
  it("off: project-mismatch when the snapshot's processes belong to a different project, and stops polling", () => {
    const wrong = process({ projectId: "proj-other" });
    const result = deriveOperationObservation(
      baseInput({ snapshot: { processes: [wrong], atMs: NOW } }),
      NOW,
    );
    expect(result.state).toEqual({ kind: "off", reason: "project-mismatch" });
    expect(result.wantsPoll).toBe(false);
  });

  it("stops polling for every off reason, not just project-mismatch and ceiling", () => {
    const noSession = deriveOperationObservation(
      baseInput({ attributable: false, notAttributableReason: "no-session" }),
      NOW,
    );
    expect(noSession.wantsPoll).toBe(false);

    const feedError = deriveOperationObservation(
      baseInput({
        snapshot: { processes: undefined, atMs: undefined, unavailableReason: "server" },
      }),
      NOW,
    );
    expect(feedError.state).toEqual({ kind: "off", reason: "feed-error" });
    expect(feedError.wantsPoll).toBe(false);
  });

  /**
   * The poller reports `ZeropsApiErrorKind` values (`expired-session`,
   * `forbidden`, `not-found` — the only three it ever sets, per
   * `isPermanentlyUnavailable`), never the observation contract's own
   * reason vocabulary — those must be mapped, not passed through as-is.
   */
  it("maps the poller's expired-session/forbidden to unauthorized", () => {
    for (const pollerReason of ["expired-session", "forbidden"]) {
      const result = deriveOperationObservation(
        baseInput({
          snapshot: { processes: undefined, atMs: undefined, unavailableReason: pollerReason },
        }),
        NOW,
      );
      expect(result.state).toEqual({ kind: "off", reason: "unauthorized" });
    }
  });

  it("maps the poller's not-found straight through", () => {
    const result = deriveOperationObservation(
      baseInput({
        snapshot: { processes: undefined, atMs: undefined, unavailableReason: "not-found" },
      }),
      NOW,
    );
    expect(result.state).toEqual({ kind: "off", reason: "not-found" });
  });

  it("maps any other poller reason to feed-error", () => {
    const result = deriveOperationObservation(
      baseInput({
        snapshot: { processes: undefined, atMs: undefined, unavailableReason: "server" },
      }),
      NOW,
    );
    expect(result.state).toEqual({ kind: "off", reason: "feed-error" });
  });

  it("carries an explicit previousHistory forward with no observation at all yet", () => {
    const history: Observation = {
      steps: [{ id: "DEPLOY", label: "Deploy", state: "running", stateLabel: "Running" }],
      processes: [],
      readAtMs: NOW,
    };
    const result = deriveOperationObservation(baseInput({ previousHistory: history }), NOW);
    expect(result.history).toEqual(history);
  });
});
