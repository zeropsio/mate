import { describe, expect, it } from "vite-plus/test";

import type { ZeropsOperation, ZeropsSessionView } from "./model/types.ts";
import { zeropsStripState } from "./strip.ts";

const session = (overrides: Partial<ZeropsSessionView>): ZeropsSessionView => ({ ...overrides });

const attempt = (success: boolean) => ({ success });

const runningOperation = (kicker: string): ZeropsOperation =>
  ({
    key: "op:1",
    kind: "deploy",
    phase: "running",
    anchorAt: "2026-08-28T10:00:00Z",
    anchorActivityId: "a1",
    turnId: "t1",
    subject: "kanbandev",
    kicker,
    voice: "Deploying kanbandev.",
    voiceSource: "mate",
    statusWord: "Deploying",
    steps: [],
    links: [],
    callIds: ["1"],
    attempts: 1,
    hasResult: false,
  }) as unknown as ZeropsOperation;

describe("zeropsStripState", () => {
  it("is absent until the thread has a session phase", () => {
    expect(zeropsStripState(undefined, undefined, false)).toBeUndefined();
    expect(zeropsStripState(session({}), undefined, false)).toBeUndefined();
  });

  // ---- the §7 journey, line by line ----

  it("reads infrastructure ready with a service count once bootstrap closes", () => {
    const state = zeropsStripState(
      session({ phase: "idle", idleScenario: "bootstrapped", serviceCount: 3 }),
      undefined,
      false,
    );

    expect(state?.label).toBe("infrastructure ready · 3 services");
    expect(state?.tone).toBe("idle");
  });

  it("counts one service without pluralising", () => {
    const state = zeropsStripState(
      session({ phase: "idle", idleScenario: "bootstrapped", serviceCount: 1 }),
      undefined,
      false,
    );

    expect(state?.label).toBe("infrastructure ready · 1 service");
  });

  it("reads developing <service> while a work session has no attempts yet", () => {
    const state = zeropsStripState(
      session({
        phase: "develop-active",
        work: {
          key: "work:2026-08-28T10:00:00Z",
          intent: "build a kanban",
          services: ["kanbandev"],
        },
      }),
      undefined,
      false,
    );

    expect(state?.label).toBe("developing kanbandev");
    expect(state?.tone).toBe("active");
  });

  it("reads deploy and verify per service once attempts are recorded", () => {
    const state = zeropsStripState(
      session({
        phase: "develop-active",
        work: {
          key: "work:2026-08-28T10:00:00Z",
          intent: "build a kanban",
          services: ["kanbandev", "kanbanstage"],
          deploys: { kanbandev: [attempt(true)] },
          verifies: { kanbandev: [attempt(true)] },
        },
      }),
      undefined,
      false,
    );

    expect(state?.label).toBe("kanbandev deployed ✓ verified ✓ · kanbanstage pending");
  });

  it("says a deploy failed rather than calling it done", () => {
    const state = zeropsStripState(
      session({
        phase: "develop-active",
        work: {
          key: "work:2026-08-28T10:00:00Z",
          intent: "build a kanban",
          services: ["kanbandev"],
          deploys: { kanbandev: [attempt(true), attempt(false)] },
        },
      }),
      undefined,
      false,
    );

    expect(state?.label).toBe("kanbandev deploy failed");
  });

  it("reads task complete when the session auto-closed", () => {
    const state = zeropsStripState(session({ phase: "develop-closed-auto" }), undefined, false);

    expect(state?.label).toBe("task complete");
    expect(state?.tone).toBe("done");
  });

  // ---- precedence ----

  /** A question outranks everything: the agent is blocked until it is answered. */
  it("says waiting for you when a question is pending, whatever the phase", () => {
    const state = zeropsStripState(
      session({ phase: "develop-active" }),
      runningOperation("Deploy · kanbandev"),
      true,
    );

    expect(state?.label).toBe("waiting for you");
    expect(state?.tone).toBe("waiting");
  });

  it("shows the running operation ahead of the phase wording", () => {
    const state = zeropsStripState(
      session({ phase: "develop-active" }),
      runningOperation("Deploy · kanbandev"),
      false,
    );

    expect(state?.label).toBe("Deploy · kanbandev running");
    expect(state?.tone).toBe("active");
  });

  it("falls back to the phase once no operation is running", () => {
    const state = zeropsStripState(session({ phase: "develop-closed-auto" }), undefined, false);

    expect(state?.label).toBe("task complete");
  });

  // ---- the other phases ----

  it("reads the remaining known phases", () => {
    const read = (overrides: Partial<ZeropsSessionView>) =>
      zeropsStripState(session(overrides), undefined, false)?.label;

    expect(
      read({
        phase: "bootstrap-active",
        bootstrap: {
          key: "bootstrap:1",
          sessionIds: [],
          step: "provision",
          completed: 1,
          total: 3,
          phase: "running",
        },
      }),
    ).toBe("setting up infrastructure · provision");
    expect(
      read({
        phase: "bootstrap-active",
        bootstrap: { key: "bootstrap:1", sessionIds: [], completed: 0, total: 3, phase: "running" },
      }),
    ).toBe("setting up infrastructure");
    expect(read({ phase: "idle", idleScenario: "empty" })).toBe("no services yet");
    expect(read({ phase: "strategy-setup" })).toBe("choosing how to deploy");
    expect(read({ phase: "export-active" })).toBe("exporting the project");
    expect(read({ phase: "launch-production-active" })).toBe("launching production");
  });

  /**
   * zcp adds phases independently of this build — `launch-production-active`
   * arrived that way. An unknown phase renders as itself rather than blanking
   * the strip or, worse, being mistaken for one of the known ones.
   */
  it("renders a phase this build has never seen, rather than nothing", () => {
    const state = zeropsStripState(session({ phase: "migration-active" }), undefined, false);

    expect(state?.label).toBe("migration-active");
    expect(state?.tone).toBe("idle");
  });

  /**
   * A thread reopened after compaction has one `status` envelope and nothing
   * else — no work session, no running operation. It must still read correctly.
   */
  it("reads a compaction-reopened thread from a bare session", () => {
    const state = zeropsStripState(
      session({
        phase: "develop-active",
        work: {
          key: "work:2026-08-28T10:00:00Z",
          intent: "build a kanban",
          services: ["kanbandev"],
        },
      }),
      undefined,
      false,
    );

    expect(state?.label).toBe("developing kanbandev");
  });
});
