import { expect, it } from "vite-plus/test";

import type { ZeropsCandidate } from "./candidates.ts";
import { selectMateEnvironments } from "./mateEnvironments.ts";

const zcp = { id: "svc", name: "zcp", status: "ACTIVE" } as const;

// witness: packages/client-runtime/src/zerops/mateEnvironments.ts | return readZeropsMembership(candidate.project).mate; → return readZeropsMembership(candidate.project).mate || candidate.service !== undefined;
it("ZV163: A project is a Mate only where HQ records one; breaks: a project with a zcp container HQ never recorded is offered as the person's Mate", () => {
  const unrecorded: ZeropsCandidate = {
    key: "unrecorded:svc",
    project: { id: "unrecorded", name: "imported by hand", status: "ACTIVE" },
    group: "ready",
    service: zcp,
  };
  const recordedWithoutBody: ZeropsCandidate = {
    key: "recorded",
    project: {
      id: "recorded",
      name: "Shop - Ada",
      status: "ACTIVE",
      hq: { appId: "shop", appName: "Shop", kind: "mate", mate: null },
    },
    group: "unavailable",
    missingContainer: true,
  };
  const stageWithContainer: ZeropsCandidate = {
    key: "stage:svc",
    project: {
      id: "stage",
      name: "Shop - stage",
      status: "ACTIVE",
      hq: { appId: "shop", appName: "Shop", kind: "stage", mate: null },
    },
    group: "ready",
    service: zcp,
  };
  expect(
    selectMateEnvironments([unrecorded, recordedWithoutBody, stageWithContainer]).map(
      (candidate) => candidate.project.id,
    ),
  ).toEqual(["recorded"]);
});
