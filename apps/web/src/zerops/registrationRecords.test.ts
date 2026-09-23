import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import type { RegistrationRecord } from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { bindAccountEnvironments } from "./accountEnvironments";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { readRegistrationRecords } from "./registrationRecords";

const record: RegistrationRecord = {
  targetKey: "project-a:service-a",
  environmentId: EnvironmentId.make("environment-a"),
  origin: "https://zcp-1-8080.prg1.zerops.app",
  projectRef: { projectId: "project-a", orgId: "org-1" },
  name: "shop",
};

/** A post-grant stage whose records are `records`; nothing else of it is read here. */
const stageWith = (records: ReadonlyArray<RegistrationRecord>) =>
  ({ records: () => records }) as unknown as AccountEnvironments;

afterEach(() => {
  closeAccountLifetime();
});

describe("the web's registration records", () => {
  it("are the account runtime's, and none are read before its first grant or after sign-out", () => {
    openAccountLifetime("user-a");
    expect(readRegistrationRecords()).toEqual([]);

    bindAccountEnvironments(stageWith([record]));
    expect(readRegistrationRecords()).toEqual([record]);

    closeAccountLifetime();
    expect(readRegistrationRecords()).toEqual([]);
  });
});
