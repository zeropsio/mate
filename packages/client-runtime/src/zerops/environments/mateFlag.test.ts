import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";

import { makeZeropsCells, type ZeropsCellAdapter } from "../data/cells.ts";
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

/**
 * The flag as the helper answers it: the store states `stated`, and the service's own read, when
 * it is asked, answers `read`.
 */
const flagThrough = (
  stated: boolean | "unknown",
  read: ZeropsCellAdapter["readServiceMateFlag"],
  access: AccessState = verified,
) =>
  Effect.gen(function* () {
    const broker = yield* makeZeropsCells({
      scope,
      access: () => access,
      adapter: {
        readServiceMateFlag: read,
      },
    });
    const flagAtom = Atom.make<boolean | "unknown" | "unread">(stated);
    const acquired: Array<string> = [];
    const data = {
      cells: broker,
      reads: { mateFlag: () => flagAtom },
      acquire: (descriptor: { readonly kind: string }) => {
        acquired.push(descriptor.kind);
        return Effect.never;
      },
    } as unknown as ManagedZeropsDataRuntime;
    const flag = yield* Effect.promise(() =>
      readServiceMateFlag(data, AtomRegistry.make(), service),
    );
    yield* broker.shutdown;
    return { flag, acquired };
  });

describe("readServiceMateFlag", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly stated: boolean | "unknown";
    readonly read: boolean | "unknown" | "fails";
    readonly expected: boolean | "unknown";
    readonly reads: number;
  }> = [
    {
      name: "on, as the store states it, reads nothing",
      stated: true,
      read: false,
      expected: true,
      reads: 0,
    },
    {
      name: "unknown, as the store states it, is settled by the service's own read",
      stated: "unknown",
      read: true,
      expected: true,
      reads: 1,
    },
    {
      name: "off is confirmed by the service's own read",
      stated: false,
      read: false,
      expected: false,
      reads: 1,
    },
    {
      name: "off the stream has not caught up with is on by the service's own read",
      stated: false,
      read: true,
      expected: true,
      reads: 1,
    },
    {
      name: "off whose confirming read failed is unknown, never off",
      stated: false,
      read: "fails",
      expected: "unknown",
      reads: 1,
    },
  ];
  for (const testCase of cases) {
    it.live(testCase.name, () =>
      Effect.gen(function* () {
        const requested: Array<ServiceRef> = [];
        const { flag, acquired } = yield* flagThrough(testCase.stated, (request) =>
          Effect.suspend(() => {
            requested.push(request.service);
            return testCase.read === "fails"
              ? Effect.fail({
                  _tag: "ZeropsCellSourceError" as const,
                  kind: "transport" as const,
                  retryable: false,
                })
              : Effect.succeed({ enabled: testCase.read });
          }),
        );

        expect(flag).toBe(testCase.expected);
        expect(requested).toHaveLength(testCase.reads);
        // The account holds the variables' stream: a flag read registers nothing.
        expect(acquired).toEqual([]);
      }),
    );
  }

  it.live("is unknown when the account's access withholds the confirming read", () =>
    Effect.gen(function* () {
      const { flag } = yield* flagThrough(false, () => Effect.succeed({ enabled: false }), {
        status: "expired",
        accountEpoch: scope.epoch,
        expiredAtMs: 0,
        previous: verified as Extract<AccessState, { readonly status: "verified" }>,
      });

      expect(flag).toBe("unknown");
    }),
  );
});
