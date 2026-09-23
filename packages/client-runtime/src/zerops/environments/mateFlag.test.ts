import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeZeropsResourceBroker, type ZeropsResourceAdapter } from "../data/resources.ts";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  type AccessState,
  type AccountScope,
  type ServiceRef,
} from "../data/types.ts";
import { readServiceMateFlag } from "./mateFlag.ts";

const scope: AccountScope = {
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account-a"),
  },
  epoch: AccountEpoch.make(1),
};

const organization = {
  kind: "organization",
  account: scope.account,
  organizationId: ZeropsOrganizationId.make("org-a"),
} as const;

const project = {
  kind: "project",
  organization,
  projectId: ZeropsProjectId.make("project-a"),
} as const;

const service: ServiceRef = {
  kind: "service",
  project,
  serviceId: ZeropsServiceId.make("service-a"),
};

const verified: AccessState = {
  status: "verified",
  account: scope.account,
  accountEpoch: scope.epoch,
  verifiedAtMs: 0,
  deadlineMs: Number.MAX_SAFE_INTEGER,
  mutationsAllowed: true,
  organizations: [{ organization, mutationsAllowed: true }],
  projects: [{ project, role: "OWNER", mutationsAllowed: true }],
};

/** The flag as the helper reads it through a broker whose adapter answers `read`. */
const flagReadThrough = (
  read: ZeropsResourceAdapter["readServiceMateFlag"],
  access: AccessState = verified,
) =>
  Effect.gen(function* () {
    const broker = yield* makeZeropsResourceBroker({
      scope,
      access: () => access,
      adapter: {
        readOrganizationLocations: () => Effect.succeed([]),
        readServiceAuthorizedAgents: () => Effect.succeed([]),
        readServiceDeployedVersion: () => Effect.succeed(undefined),
        readServiceMateFlag: read,
        readOrganizationIntegrationTokenGrants: () => Effect.succeed([]),
      },
    });
    const flag = yield* Effect.promise(() => readServiceMateFlag(broker, service));
    yield* broker.shutdown;
    return flag;
  });

describe("readServiceMateFlag", () => {
  for (const { name, enabled } of [
    { name: "on", enabled: true },
    { name: "off", enabled: false },
    { name: "an answer that could not say", enabled: "unknown" as const },
  ]) {
    it.live(`reads the service's ZCP_MATE_ENABLED as it answered: ${name}`, () =>
      Effect.gen(function* () {
        const requested: Array<ServiceRef> = [];
        const flag = yield* flagReadThrough((request) =>
          Effect.sync(() => {
            requested.push(request.service);
            return { enabled };
          }),
        );

        expect(flag).toBe(enabled);
        expect(requested).toEqual([service]);
      }),
    );
  }

  it.live("is unknown, never off, when the read failed", () =>
    Effect.gen(function* () {
      const flag = yield* flagReadThrough(() =>
        Effect.fail({ _tag: "ZeropsResourceSourceError", kind: "transport", retryable: false }),
      );

      expect(flag).toBe("unknown");
    }),
  );

  it.live("is unknown when the account's access withholds the read", () =>
    Effect.gen(function* () {
      const flag = yield* flagReadThrough(() => Effect.succeed({ enabled: false }), {
        status: "expired",
        accountEpoch: scope.epoch,
        expiredAtMs: 0,
        previous: verified as Extract<AccessState, { readonly status: "verified" }>,
      });

      expect(flag).toBe("unknown");
    }),
  );
});
