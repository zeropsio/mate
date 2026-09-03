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
        serviceIds: ["svc-1"],
        startedAtMs: NOW,
        kind: "deploy",
      }),
    ).toEqual({ stepSource: p, chips: [], projectMismatch: false });
  });

  it("does not attribute a process on a different service", () => {
    const p = process({ serviceStackIds: ["svc-2"] });
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        serviceIds: ["svc-1"],
        startedAtMs: NOW,
        kind: "deploy",
      }),
    ).toEqual({ chips: [], projectMismatch: false });
  });

  it("does not attribute a process in a different project — and flags it as a mismatch (§3.2)", () => {
    const p = process({ projectId: "proj-2" });
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        serviceIds: ["svc-1"],
        startedAtMs: NOW,
        kind: "deploy",
      }),
    ).toEqual({ chips: [], projectMismatch: true });
  });

  it("does not attribute a process created more than 5s before the tool started", () => {
    const p = process({ created: new Date(NOW - 6_000).toISOString() });
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        serviceIds: ["svc-1"],
        startedAtMs: NOW,
        kind: "deploy",
      }),
    ).toEqual({ chips: [], projectMismatch: false });
  });

  it("attributes a process created up to 5s before the tool started", () => {
    const p = process({ created: new Date(NOW - 4_000).toISOString() });
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        serviceIds: ["svc-1"],
        startedAtMs: NOW,
        kind: "deploy",
      }),
    ).toEqual({ stepSource: p, chips: [], projectMismatch: false });
  });

  it("ignores a process with an unparseable created timestamp", () => {
    const p = process({ created: "not-a-date" });
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        serviceIds: ["svc-1"],
        startedAtMs: NOW,
        kind: "deploy",
      }),
    ).toEqual({ chips: [], projectMismatch: false });
  });

  it("puts a same-service, same-window action outside the kind's action set in chips, never as the step source", () => {
    const restart = process({ id: "p-restart", actionName: "stack.restart" });
    expect(
      attributeActivity({
        processes: [restart],
        projectId: "proj-1",
        serviceIds: ["svc-1"],
        startedAtMs: NOW,
        kind: "deploy",
      }),
    ).toEqual({ chips: [restart], projectMismatch: false });
  });

  it("drives steps from the newest matching-kind process; older ones become chips", () => {
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
        serviceIds: ["svc-1"],
        startedAtMs: NOW,
        kind: "deploy",
      }),
    ).toEqual({ stepSource: newer, chips: [older], projectMismatch: false });
  });

  it("shows every attributed process — never collapses to just the first (LiveOp rule)", () => {
    const deploy = process({ id: "p-deploy", actionName: "stack.deploy" });
    const subdomain = process({ id: "p-subdomain", actionName: "stack.enableSubdomainAccess" });
    const result = attributeActivity({
      processes: [deploy, subdomain],
      projectId: "proj-1",
      serviceIds: ["svc-1"],
      startedAtMs: NOW,
      kind: "deploy",
    });
    expect(result.stepSource).toBe(deploy);
    expect(result.chips).toEqual([subdomain]);
  });

  it("returns no step source and no chips when nothing matches", () => {
    expect(
      attributeActivity({
        processes: [],
        projectId: "proj-1",
        serviceIds: ["svc-1"],
        startedAtMs: NOW,
        kind: "deploy",
      }),
    ).toEqual({ chips: [], projectMismatch: false });
  });

  /**
   * §3.2: `GET /project/{id}/process` is scoped to one project by URL, so
   * every returned process SHOULD carry that project's id — a read that comes
   * back with data for none of them is the wrong project/host entirely, not
   * "nothing has happened yet". That must switch the overlay off rather than
   * sit in `searching` until the ceiling.
   */
  it("flags a project mismatch when the read returns data for no matching project at all", () => {
    const wrongProject = process({ projectId: "proj-other" });
    expect(
      attributeActivity({
        processes: [wrongProject],
        projectId: "proj-1",
        serviceIds: ["svc-1"],
        startedAtMs: NOW,
        kind: "deploy",
      }),
    ).toEqual({ chips: [], projectMismatch: true });
  });

  it("is not a mismatch when at least one process belongs to the right project", () => {
    const right = process({ projectId: "proj-1" });
    const wrong = process({ id: "p-wrong", projectId: "proj-other" });
    const result = attributeActivity({
      processes: [wrong, right],
      projectId: "proj-1",
      serviceIds: ["svc-1"],
      startedAtMs: NOW,
      kind: "deploy",
    });
    expect(result.projectMismatch).toBe(false);
  });

  it("is not a mismatch when the process list is simply empty", () => {
    expect(
      attributeActivity({
        processes: [],
        projectId: "proj-1",
        serviceIds: ["svc-1"],
        startedAtMs: NOW,
        kind: "deploy",
      }).projectMismatch,
    ).toBe(false);
  });

  it("matches a process against any of several serviceIds — an import creates several services", () => {
    const p = process({ serviceStackIds: ["svc-2"] });
    expect(
      attributeActivity({
        processes: [p],
        projectId: "proj-1",
        serviceIds: ["svc-1", "svc-2", "svc-3"],
        startedAtMs: NOW,
        kind: "import",
      }),
    ).toEqual({ stepSource: p, chips: [], projectMismatch: false });
  });

  describe("action sets by kind", () => {
    it("import — stack.create, stack.deploy, stack.build, stack.enableSubdomainAccess", () => {
      for (const actionName of [
        "stack.create",
        "stack.deploy",
        "stack.build",
        "stack.enableSubdomainAccess",
      ]) {
        const p = process({ id: `p-${actionName}`, actionName });
        const result = attributeActivity({
          processes: [p],
          projectId: "proj-1",
          serviceIds: ["svc-1"],
          startedAtMs: NOW,
          kind: "import",
        });
        expect(result.stepSource).toBe(p);
      }
    });

    it("subdomain — enableSubdomainAccess and disableSubdomainAccess only", () => {
      const enable = process({ id: "p-enable", actionName: "stack.enableSubdomainAccess" });
      expect(
        attributeActivity({
          processes: [enable],
          projectId: "proj-1",
          serviceIds: ["svc-1"],
          startedAtMs: NOW,
          kind: "subdomain",
        }).stepSource,
      ).toBe(enable);

      const deploy = process({ id: "p-deploy", actionName: "stack.deploy" });
      expect(
        attributeActivity({
          processes: [deploy],
          projectId: "proj-1",
          serviceIds: ["svc-1"],
          startedAtMs: NOW,
          kind: "subdomain",
        }),
      ).toEqual({ chips: [deploy], projectMismatch: false });
    });

    it("delete — stack.delete only", () => {
      const del = process({ id: "p-delete", actionName: "stack.delete" });
      expect(
        attributeActivity({
          processes: [del],
          projectId: "proj-1",
          serviceIds: ["svc-1"],
          startedAtMs: NOW,
          kind: "delete",
        }).stepSource,
      ).toBe(del);
    });

    it("scale — stack.scale and stack.updateUserData", () => {
      for (const actionName of ["stack.scale", "stack.updateUserData"]) {
        const p = process({ id: `p-${actionName}`, actionName });
        expect(
          attributeActivity({
            processes: [p],
            projectId: "proj-1",
            serviceIds: ["svc-1"],
            startedAtMs: NOW,
            kind: "scale",
          }).stepSource,
        ).toBe(p);
      }
    });

    it("manage — stack.start, stack.stop, stack.restart, stack.reload", () => {
      for (const actionName of ["stack.start", "stack.stop", "stack.restart", "stack.reload"]) {
        const p = process({ id: `p-${actionName}`, actionName });
        expect(
          attributeActivity({
            processes: [p],
            projectId: "proj-1",
            serviceIds: ["svc-1"],
            startedAtMs: NOW,
            kind: "manage",
          }).stepSource,
        ).toBe(p);
      }
    });
  });
});
