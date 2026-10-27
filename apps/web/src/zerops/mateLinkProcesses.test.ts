import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { ZeropsService } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import { mateLinkProcesses } from "./mateLinkProcesses";

const service = (
  id: string,
  name: string,
  status = "ACTIVE",
  category = "USER",
  type = name === "zcp" ? "zcp@1" : "nodejs@22",
) =>
  ({
    id,
    name,
    status,
    serviceStackTypeInfo: { serviceStackTypeCategory: category, serviceStackTypeVersionName: type },
  }) as unknown as ZeropsService;
const process = (serviceId: string, status: string, actionName = "stack.restart") =>
  ({
    id: `p-${serviceId}-${status}`,
    projectId: "proj",
    serviceStackIds: [serviceId],
    status,
    actionName,
    created: "2026-09-30T10:00:00Z",
  }) satisfies ActivityProcess;

// What a slow first connect lists under its line (the owner, 2026-09-30: "why isnt this showing
// the processes or something?"): the Mate's own container first while the platform works on it,
// then each service as the platform has it.
describe("mateLinkProcesses", () => {
  it.each([
    {
      // The owner, 2026-09-30: "this shouldnt be showing build containers".
      case: "the platform's own containers — builds, core — are never listed; runtimes and data are",
      services: [
        service("z", "zcp"),
        service("b", "buildappdevv1790258582", "STOPPED", "BUILD", "alpine/build_runtime"),
        service("c", "core", "ACTIVE", "CORE", "core:single@2"),
        service("a", "appdev"),
        service("d", "db", "ACTIVE", "STANDARD", "postgresql:single@17"),
      ],
      processes: [],
      expected: [
        { name: "appdev", state: "ok" },
        { name: "db", state: "ok" },
      ],
    },
    {
      case: "every service up, nothing running: each one ok, the Mate's container not listed",
      services: [service("z", "zcp"), service("a", "appdev"), service("s", "appstage")],
      processes: [],
      expected: [
        { name: "appdev", state: "ok" },
        { name: "appstage", state: "ok" },
      ],
    },
    {
      case: "the platform restarting the Mate's container: it leads, busy",
      services: [service("a", "appdev"), service("z", "zcp")],
      processes: [process("z", "RUNNING")],
      expected: [
        { name: "zcp", state: "busy" },
        { name: "appdev", state: "ok" },
      ],
    },
    {
      case: "a stage waiting for its first deploy, a dev building",
      services: [
        service("z", "zcp"),
        service("a", "appdev"),
        service("s", "appstage", "READY_TO_DEPLOY"),
      ],
      processes: [process("a", "PENDING", "stack.build")],
      expected: [
        { name: "appdev", state: "busy" },
        { name: "appstage", state: "waiting" },
      ],
    },
    {
      case: "a finished process says nothing; a stopped service is empty; a failed one failed",
      services: [
        service("z", "zcp"),
        service("a", "appdev", "STOPPED"),
        service("s", "db", "ACTION_FAILED"),
      ],
      processes: [process("z", "FINISHED")],
      expected: [
        { name: "appdev", state: "empty" },
        { name: "db", state: "failed" },
      ],
    },
    {
      case: "nothing read yet: nothing to list",
      services: undefined,
      processes: [],
      expected: [],
    },
  ])("$case", ({ services, processes, expected }) => {
    expect(mateLinkProcesses({ services, processes, mateServiceId: "z" })).toEqual(expected);
  });
});
