import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "../api.ts";
import type { ZeropsCandidate } from "../candidates.ts";
import type { ZeropsContainerHealth } from "../provisioning.ts";
import type { ContainerVerdict } from "./environmentMachine.ts";
import { interimContainerVerdict, type InterimMateFlag } from "./interimContainer.ts";

const candidate = (projectStatus: string, serviceStatus: string | null): ZeropsCandidate => ({
  key: "project-1:service-1",
  project: { id: "project-1", name: "shop", status: projectStatus } as ZeropsProject,
  group: "ready",
  ...(serviceStatus === null
    ? {}
    : { service: { id: "service-1", name: "zcp", status: serviceStatus } }),
});

const ROWS: ReadonlyArray<{
  readonly project: string;
  readonly service: string | null;
  readonly health?: ZeropsContainerHealth;
  readonly mateFlag?: InterimMateFlag;
  readonly verdict: ContainerVerdict;
}> = [
  { project: "NEW", service: null, verdict: { level: "creating", overdue: false } },
  { project: "CREATING", service: null, verdict: { level: "creating", overdue: false } },
  { project: "STARTING", service: null, verdict: { level: "provisioning", overdue: false } },
  { project: "STOPPED", service: null, verdict: { level: "inactive", status: "STOPPED" } },
  { project: "STOPPING", service: "ACTIVE", verdict: { level: "inactive", status: "STOPPING" } },
  { project: "ACTIVE", service: "NEW", verdict: { level: "provisioning", overdue: false } },
  { project: "ACTIVE", service: "CREATING", verdict: { level: "provisioning", overdue: false } },
  { project: "ACTIVE", service: "STARTING", verdict: { level: "provisioning", overdue: false } },
  {
    project: "ACTIVE",
    service: "RESTARTING",
    health: "ready",
    verdict: { level: "restarting", by: "platform", overdue: false },
  },
  {
    project: "ACTIVE",
    service: "UPGRADING",
    verdict: { level: "restarting", by: "platform", overdue: false },
  },
  {
    project: "ACTIVE",
    service: "RELOADING",
    verdict: { level: "restarting", by: "platform", overdue: false },
  },
  { project: "ACTIVE", service: "STOPPED", verdict: { level: "inactive", status: "STOPPED" } },
  // Not probed yet: nothing is known about the Mate behind an ACTIVE service.
  { project: "ACTIVE", service: "ACTIVE", verdict: { level: "unknown" } },
  { project: "ACTIVE", service: "ACTIVE", health: "ready", verdict: { level: "ready" } },
  {
    project: "ACTIVE",
    service: "ACTIVE",
    health: "initializing",
    verdict: { level: "booting", overdue: false },
  },
  // Mid-restart the balancer answers 502: the probe keeps asking, so it reads as booting.
  {
    project: "ACTIVE",
    service: "ACTIVE",
    health: "unreachable",
    verdict: { level: "booting", overdue: false },
  },
  // "Up, but Mate never answered" is booting past its cap, not a level of its own (§4.5).
  {
    project: "ACTIVE",
    service: "ACTIVE",
    health: "stalled",
    verdict: { level: "booting", overdue: true },
  },
  // The Mate flag is not read yet, or could not be read: booting, never needs-enable (§4.5).
  {
    project: "ACTIVE",
    service: "ACTIVE",
    health: "predates-mate",
    verdict: { level: "booting", overdue: false },
  },
  {
    project: "ACTIVE",
    service: "ACTIVE",
    health: "predates-mate",
    mateFlag: "unknown",
    verdict: { level: "booting", overdue: false },
  },
  {
    project: "ACTIVE",
    service: "ACTIVE",
    health: "predates-mate",
    mateFlag: false,
    verdict: { level: "needs-enable" },
  },
  // The flag reads on: zcp keys every Mate-shaped effect off it, so this is an install still
  // finishing (H9), not one waiting on an action.
  {
    project: "ACTIVE",
    service: "ACTIVE",
    health: "predates-mate",
    mateFlag: true,
    verdict: { level: "booting", overdue: false },
  },
];

describe("interim container region (0.9a, replaced by the container machine in 3.2)", () => {
  for (const row of ROWS) {
    const name = `project ${row.project}, service ${row.service ?? "none"}, health ${row.health ?? "unread"}, flag ${String(row.mateFlag ?? "unread")} → ${row.verdict.level}`;
    it(name, () => {
      expect(
        interimContainerVerdict({
          candidate: candidate(row.project, row.service),
          health: row.health,
          mateFlag: row.mateFlag,
        }),
      ).toEqual(row.verdict);
    });
  }
});
