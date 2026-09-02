// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import { describe, expect, it } from "vite-plus/test";

import type { ActivityProcess } from "./dto.ts";
import { attributeActivity } from "./attribution.ts";

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

describe("attributeActivity — §3 attribution rules", () => {
  it("attributes a process matching service, project and time", () => {
    const p = process({});
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        targetServiceId: "svc-1",
        toolStartedAtMs: NOW,
      }),
    ).toEqual({ stepSource: p, chips: [] });
  });

  it("does not attribute a process on a different service", () => {
    const p = process({ serviceStackIds: ["svc-2"] });
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        targetServiceId: "svc-1",
        toolStartedAtMs: NOW,
      }),
    ).toEqual({ chips: [] });
  });

  it("does not attribute a process in a different project", () => {
    const p = process({ projectId: "proj-2" });
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        targetServiceId: "svc-1",
        toolStartedAtMs: NOW,
      }),
    ).toEqual({ chips: [] });
  });

  it("does not attribute a process created more than 5s before the tool started", () => {
    const p = process({ created: new Date(NOW - 6_000).toISOString() });
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        targetServiceId: "svc-1",
        toolStartedAtMs: NOW,
      }),
    ).toEqual({ chips: [] });
  });

  it("attributes a process created up to 5s before the tool started", () => {
    const p = process({ created: new Date(NOW - 4_000).toISOString() });
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        targetServiceId: "svc-1",
        toolStartedAtMs: NOW,
      }),
    ).toEqual({ stepSource: p, chips: [] });
  });

  it("ignores a process with an unparseable created timestamp", () => {
    const p = process({ created: "not-a-date" });
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        targetServiceId: "svc-1",
        toolStartedAtMs: NOW,
      }),
    ).toEqual({ chips: [] });
  });

  it("puts a same-service, same-window action outside the allowlist in chips, never as the step source", () => {
    const restart = process({ id: "p-restart", actionName: "stack.restart" });
    expect(
      attributeActivity({
        processes: [restart],
        projectId: "proj-1",
        targetServiceId: "svc-1",
        toolStartedAtMs: NOW,
      }),
    ).toEqual({ chips: [restart] });
  });

  it("drives steps from the newest deploy/build process; older ones become chips", () => {
    const older = process({
      id: "p-old",
      actionName: "stack.build",
      created: new Date(NOW - 1_000).toISOString(),
    });
    const newer = process({
      id: "p-new",
      actionName: "stack.deploy",
      created: new Date(NOW + 1_000).toISOString(),
    });
    expect(
      attributeActivity({
        processes: [older, newer],
        projectId: "proj-1",
        targetServiceId: "svc-1",
        toolStartedAtMs: NOW,
      }),
    ).toEqual({ stepSource: newer, chips: [older] });
  });

  it("shows every attributed process — never collapses to just the first (LiveOp rule)", () => {
    const deploy = process({ id: "p-deploy", actionName: "stack.deploy" });
    const subdomain = process({ id: "p-subdomain", actionName: "stack.enableSubdomainAccess" });
    const result = attributeActivity({
      processes: [deploy, subdomain],
      projectId: "proj-1",
      targetServiceId: "svc-1",
      toolStartedAtMs: NOW,
    });
    expect(result.stepSource).toBe(deploy);
    expect(result.chips).toEqual([subdomain]);
  });

  it("returns no step source and no chips when nothing matches", () => {
    expect(
      attributeActivity({
        processes: [],
        projectId: "proj-1",
        targetServiceId: "svc-1",
        toolStartedAtMs: NOW,
      }),
    ).toEqual({ chips: [] });
  });
});
