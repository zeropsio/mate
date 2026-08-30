import { describe, expect, it } from "vite-plus/test";
import type { ZeropsLifecycle, ZeropsStateEnvelope } from "@t3tools/contracts";

import { zeropsStripState } from "./strip.ts";

const envelope = (overrides: Record<string, unknown>): ZeropsStateEnvelope =>
  ({
    phase: "idle",
    environment: "container",
    project: { id: "proj-1", name: "z3-eval" },
    services: [],
    generated: "2026-08-28T10:00:00Z",
    ...overrides,
  }) as unknown as ZeropsStateEnvelope;

const lifecycle = (overrides: Record<string, unknown>): ZeropsLifecycle =>
  ({ threadId: "thread-1", recentTools: [], ...overrides }) as unknown as ZeropsLifecycle;

const service = (hostname: string) => ({
  hostname,
  typeVersion: "nodejs@22",
  runtimeClass: "runtime",
  status: "ACTIVE",
  bootstrapped: true,
});

const attempt = (success: boolean) => ({
  at: "2026-08-28T10:00:00Z",
  success,
  iteration: 1,
});

const runningTool = (toolName: string) => ({
  toolName,
  status: "inProgress",
  at: "2026-08-28T10:00:00Z",
  itemId: "item-1",
});

describe("zeropsStripState", () => {
  it("is absent until the thread has an envelope", () => {
    expect(zeropsStripState(undefined, { pendingUserInput: false })).toBeUndefined();
    expect(zeropsStripState(lifecycle({}), { pendingUserInput: false })).toBeUndefined();
  });

  // ---- the §7 journey, line by line ----

  it("reads infrastructure ready with a service count once bootstrap closes", () => {
    const state = zeropsStripState(
      lifecycle({
        envelope: envelope({
          phase: "idle",
          idleScenario: "bootstrapped",
          services: [service("kanbandev"), service("kanbanstage"), service("db")],
        }),
      }),
      { pendingUserInput: false },
    );

    expect(state?.label).toBe("infrastructure ready · 3 services");
    expect(state?.tone).toBe("idle");
  });

  it("counts one service without pluralising", () => {
    const state = zeropsStripState(
      lifecycle({
        envelope: envelope({
          phase: "idle",
          idleScenario: "bootstrapped",
          services: [service("app")],
        }),
      }),
      { pendingUserInput: false },
    );

    expect(state?.label).toBe("infrastructure ready · 1 service");
  });

  it("reads developing <service> while a work session has no attempts yet", () => {
    const state = zeropsStripState(
      lifecycle({
        envelope: envelope({
          phase: "develop-active",
          services: [service("kanbandev")],
          workSession: {
            intent: "build a kanban",
            services: ["kanbandev"],
            createdAt: "2026-08-28T10:00:00Z",
          },
        }),
      }),
      { pendingUserInput: false },
    );

    expect(state?.label).toBe("developing kanbandev");
    expect(state?.tone).toBe("active");
  });

  it("reads deploy and verify per service once attempts are recorded", () => {
    const state = zeropsStripState(
      lifecycle({
        envelope: envelope({
          phase: "develop-active",
          services: [service("kanbandev"), service("kanbanstage")],
          workSession: {
            intent: "build a kanban",
            services: ["kanbandev", "kanbanstage"],
            createdAt: "2026-08-28T10:00:00Z",
            deploys: { kanbandev: [attempt(true)] },
            verifies: { kanbandev: [attempt(true)] },
          },
        }),
      }),
      { pendingUserInput: false },
    );

    expect(state?.label).toBe("kanbandev deployed ✓ verified ✓ · kanbanstage pending");
  });

  it("says a deploy failed rather than calling it done", () => {
    const state = zeropsStripState(
      lifecycle({
        envelope: envelope({
          phase: "develop-active",
          services: [service("kanbandev")],
          workSession: {
            intent: "build a kanban",
            services: ["kanbandev"],
            createdAt: "2026-08-28T10:00:00Z",
            deploys: { kanbandev: [attempt(true), attempt(false)] },
          },
        }),
      }),
      { pendingUserInput: false },
    );

    expect(state?.label).toBe("kanbandev deploy failed");
  });

  it("reads task complete when the session auto-closed", () => {
    const state = zeropsStripState(
      lifecycle({ envelope: envelope({ phase: "develop-closed-auto" }) }),
      { pendingUserInput: false },
    );

    expect(state?.label).toBe("task complete");
    expect(state?.tone).toBe("done");
  });

  // ---- precedence ----

  /** A question outranks everything: the agent is blocked until it is answered. */
  it("says waiting for you when a question is pending, whatever the phase", () => {
    const state = zeropsStripState(
      lifecycle({
        envelope: envelope({ phase: "develop-active" }),
        recentTools: [runningTool("zerops_deploy")],
      }),
      { pendingUserInput: true },
    );

    expect(state?.label).toBe("waiting for you");
    expect(state?.tone).toBe("waiting");
  });

  it("shows the running tool ahead of the phase wording", () => {
    const state = zeropsStripState(
      lifecycle({
        envelope: envelope({ phase: "develop-active" }),
        recentTools: [runningTool("zerops_deploy")],
      }),
      { pendingUserInput: false },
    );

    expect(state?.label).toBe("zerops_deploy running");
    expect(state?.tone).toBe("active");
  });

  it("falls back to the phase once the tool finishes", () => {
    const state = zeropsStripState(
      lifecycle({
        envelope: envelope({ phase: "develop-closed-auto" }),
        recentTools: [{ ...runningTool("zerops_deploy"), status: "completed" }],
      }),
      { pendingUserInput: false },
    );

    expect(state?.label).toBe("task complete");
  });

  // ---- the other phases ----

  it("reads the remaining known phases", () => {
    const read = (overrides: Record<string, unknown>) =>
      zeropsStripState(lifecycle({ envelope: envelope(overrides) }), { pendingUserInput: false })
        ?.label;

    expect(
      read({ phase: "bootstrap-active", bootstrap: { route: "classic", step: "provision" } }),
    ).toBe("setting up infrastructure · provision");
    expect(read({ phase: "bootstrap-active", bootstrap: { route: "classic" } })).toBe(
      "setting up infrastructure",
    );
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
    const state = zeropsStripState(
      lifecycle({ envelope: envelope({ phase: "migration-active" }) }),
      { pendingUserInput: false },
    );

    expect(state?.label).toBe("migration-active");
    expect(state?.tone).toBe("idle");
  });

  /**
   * A thread reopened after compaction has one `status` envelope and nothing
   * else — no work session, no recent tools. It must still read correctly.
   */
  it("reads a compaction-reopened thread from a bare status envelope", () => {
    const state = zeropsStripState(
      lifecycle({
        envelope: envelope({
          phase: "develop-active",
          services: [service("kanbandev")],
          workSession: {
            intent: "build a kanban",
            services: ["kanbandev"],
            createdAt: "2026-08-28T10:00:00Z",
          },
        }),
        recentTools: [],
      }),
      { pendingUserInput: false },
    );

    expect(state?.label).toBe("developing kanbandev");
  });
});
