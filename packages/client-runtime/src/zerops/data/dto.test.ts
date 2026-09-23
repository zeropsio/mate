import { describe, expect, it } from "vite-plus/test";

import { service, stamp } from "./__fixtures__/index.ts";
import { serviceRecordToZeropsService } from "./dto.ts";
import type { FacetAdmission, ServiceDeployInfo, ServiceRecord } from "./types.ts";

const admission: FacetAdmission = {
  lastNativeReceiptOrdinal: null,
  lastAppliedAuthoritativeDispatchOrdinal: null,
  hasAuthoritativeObservation: true,
};

function serviceDeploying(activeDeploy: ServiceDeployInfo): ServiceRecord {
  return {
    ref: service("app"),
    identity: {
      knowledge: "observed",
      fields: { hostname: "app", isSystem: false, type: null },
      unresolvedRequiredFields: [],
      source: "native-push",
      stamp: stamp(1),
      admission,
    },
    lifecycle: {
      knowledge: "observed",
      fields: { status: "ACTIVE", createdAt: null, updatedAt: null },
      unresolvedRequiredFields: [],
      source: "native-push",
      stamp: stamp(1),
      admission,
    },
    routing: { knowledge: "unresolved", fields: {}, unresolvedRequiredFields: [], admission },
    deployment: {
      knowledge: "observed",
      fields: { versionNumber: null, mode: null, activeDeploy },
      unresolvedRequiredFields: [],
      source: "native-push",
      stamp: stamp(1),
      admission,
    },
    scaling: { knowledge: "unresolved", fields: {}, unresolvedRequiredFields: [], admission },
  };
}

describe("serviceRecordToZeropsService", () => {
  it("bridges a pushed deploy without source to an app version that names its id", () => {
    const dto = serviceRecordToZeropsService(
      serviceDeploying({
        id: "app-version",
        status: "ACTIVE",
        source: null,
        activatedAt: "2026-09-23T14:01:27Z",
        name: null,
        branch: null,
        commit: null,
        tag: null,
        repository: null,
      }),
    );

    expect(dto?.activeAppVersion).toMatchObject({
      id: "app-version",
      status: "ACTIVE",
      lastUpdate: "2026-09-23T14:01:27Z",
    });
    expect(dto?.activeAppVersion).not.toHaveProperty("source");
  });
});
