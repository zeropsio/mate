import { describe, expect, it } from "vite-plus/test";

import {
  planProjectIsolation,
  projectIsolationStepLabel,
  PROJECT_ENV_ISOLATION_KEY,
  PROJECT_ENV_ISOLATION_SERVICE,
  ZCP_API_KEY_ENV_KEY,
  type ProjectEnvEntry,
  type ProjectIsolationService,
  type ProjectIsolationStep,
} from "./projectIsolation.ts";

const ZCP: ProjectIsolationService = { name: "zcp", isControlPlane: true };
const APP: ProjectIsolationService = { name: "app", isControlPlane: false };
const DB: ProjectIsolationService = { name: "db", isControlPlane: false };

const OPEN: ProjectEnvEntry = { id: "env-iso", key: PROJECT_ENV_ISOLATION_KEY, content: "none" };
const CLOSED: ProjectEnvEntry = {
  id: "env-iso",
  key: PROJECT_ENV_ISOLATION_KEY,
  content: PROJECT_ENV_ISOLATION_SERVICE,
};
const KEY: ProjectEnvEntry = {
  id: "env-key",
  key: ZCP_API_KEY_ENV_KEY,
  content: "the-value",
  sensitive: false,
};
const SSH: ProjectEnvEntry = { id: "env-ssh", key: "sshIsolation", content: "vpn service@zcp" };

function kinds(steps: ReadonlyArray<ProjectIsolationStep>): ReadonlyArray<string> {
  return steps.map((step) => step.kind);
}

describe("planProjectIsolation", () => {
  it("closes a Mate's project and moves its key onto the container", () => {
    // The shape every live Mate is in (measured 2026-09-16): envIsolation
    // `none`, ZCP_API_KEY a project variable in clear.
    const plan = planProjectIsolation({
      envList: [OPEN, KEY, SSH],
      services: [APP, DB, ZCP],
    });
    expect(plan).toEqual([
      {
        kind: "update-project-env",
        entryId: "env-iso",
        key: PROJECT_ENV_ISOLATION_KEY,
        content: "service",
      },
      {
        kind: "move-key-to-service",
        serviceName: "zcp",
        key: ZCP_API_KEY_ENV_KEY,
        fromEntryId: "env-key",
      },
      { kind: "reread-project-env" },
      { kind: "delete-project-env", key: ZCP_API_KEY_ENV_KEY },
      { kind: "restart-service", serviceName: "app" },
      { kind: "restart-service", serviceName: "db" },
      { kind: "restart-service", serviceName: "zcp" },
    ]);
  });

  it("plans nothing for a project already isolated and holding no key", () => {
    // The whole reason this is safe on every projects-screen read.
    expect(planProjectIsolation({ envList: [CLOSED, SSH], services: [APP, ZCP] })).toEqual([]);
  });

  it("creates the setting when the project has no entry for it", () => {
    // A POST answers with a process id, never the entry's, which is why the
    // delete below can only run after a re-read.
    const plan = planProjectIsolation({ envList: [KEY], services: [ZCP] });
    expect(plan[0]).toEqual({
      kind: "create-project-env",
      key: PROJECT_ENV_ISOLATION_KEY,
      content: PROJECT_ENV_ISOLATION_SERVICE,
      sensitive: false,
    });
  });

  it("drops the key outright where there is no container to move it to", () => {
    // A stage or production project made the old way carries a key with ADMIN
    // on itself in every one of its containers, and nothing there needs it.
    const plan = planProjectIsolation({ envList: [OPEN, KEY], services: [APP, DB] });
    expect(kinds(plan)).toEqual([
      "update-project-env",
      "reread-project-env",
      "delete-project-env",
      "restart-service",
      "restart-service",
    ]);
    expect(plan).not.toContainEqual(expect.objectContaining({ kind: "move-key-to-service" }));
  });

  it("closes a stage project that is open but carries no key", () => {
    expect(kinds(planProjectIsolation({ envList: [OPEN], services: [APP] }))).toEqual([
      "update-project-env",
      "restart-service",
    ]);
  });

  it("never deletes without re-reading the entry's id first", () => {
    // `POST /project/search` trails the write path, and a POST hands back a
    // process id, so the id a plan was built from is not the one to delete by.
    for (const services of [[ZCP], [APP], [APP, ZCP]]) {
      const plan = planProjectIsolation({ envList: [OPEN, KEY], services });
      const reread = kinds(plan).indexOf("reread-project-env");
      const remove = kinds(plan).indexOf("delete-project-env");
      expect(reread).toBeGreaterThanOrEqual(0);
      expect(reread).toBeLessThan(remove);
    }
  });

  it("names the key to delete, never an id read before the writes", () => {
    const plan = planProjectIsolation({ envList: [OPEN, KEY], services: [ZCP] });
    const remove = plan.find((step) => step.kind === "delete-project-env");
    expect(remove).toEqual({ kind: "delete-project-env", key: ZCP_API_KEY_ENV_KEY });
  });

  it("writes the update with its key beside its content", () => {
    // `PUT /project-env/{id}` with content alone is 400 invalidUserInput
    // ("key: field is required"), for the owner too (measured 2026-09-16).
    const [step] = planProjectIsolation({ envList: [OPEN], services: [APP] });
    expect(step).toMatchObject({ key: PROJECT_ENV_ISOLATION_KEY, content: "service" });
  });

  it("restarts every service, the container last", () => {
    // The store is rewritten in seconds, but a running process keeps the
    // sibling variables it captured at start until it restarts.
    const plan = planProjectIsolation({ envList: [OPEN], services: [ZCP, APP, DB] });
    expect(
      plan
        .filter((step) => step.kind === "restart-service")
        .map((step) => (step.kind === "restart-service" ? step.serviceName : "")),
    ).toEqual(["app", "db", "zcp"]);
  });

  it("restarts nothing when there is nothing to write", () => {
    expect(planProjectIsolation({ envList: [CLOSED], services: [ZCP, APP] })).toEqual([]);
  });

  it("leaves sshIsolation alone", () => {
    // zcp's SSH into the app containers is the one cross-service path it
    // needs, and it is not what leaks a sibling's variables.
    const plan = planProjectIsolation({ envList: [OPEN, KEY, SSH], services: [APP, ZCP] });
    expect(JSON.stringify(plan)).not.toContain("sshIsolation");
    expect(JSON.stringify(plan)).not.toContain("env-ssh");
  });

  it("never carries the key's value", () => {
    // A plan is progress the UI renders; the value stays in the entry the
    // caller read and goes straight onto the service.
    const plan = planProjectIsolation({ envList: [OPEN, KEY], services: [ZCP] });
    expect(JSON.stringify(plan)).not.toContain("the-value");
  });
});

describe("projectIsolationStepLabel", () => {
  it("labels every step a plan can contain, and prints no value", () => {
    const plan = planProjectIsolation({ envList: [OPEN, KEY], services: [APP, ZCP] });
    expect(plan.map(projectIsolationStepLabel)).toEqual([
      "Closing the project's shared variables",
      "Moving the container's key onto the container",
      "Re-reading the project's variables",
      "Removing the project-wide key",
      "Restarting app",
      "Restarting zcp",
    ]);
  });
});
