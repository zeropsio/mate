import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentOperationForbiddenError,
  EnvironmentScopeRequiredError,
} from "@t3tools/contracts";

import { mapRemoteEnvironmentError } from "./errors.ts";

const forbidden = (reason: EnvironmentOperationForbiddenError["reason"]) =>
  new EnvironmentOperationForbiddenError({
    code: "operation_forbidden",
    reason,
    traceId: "trace-1",
  });

describe("mapRemoteEnvironmentError", () => {
  // A Mate the person may see and not open is not a fault to recover from, so
  // it never reads as the generic permission error — there is nothing to
  // retry and nothing to fix (D5).
  it("keeps the read-only refusal apart from every other permission failure", () => {
    expect(mapRemoteEnvironmentError(forbidden("zerops_read_only"))).toMatchObject({
      _tag: "ConnectionBlockedError",
      reason: "read-only",
      detail: "Only its owner opens this Mate.",
    });
  });

  for (const reason of [
    "zerops_project_membership_required",
    "zerops_throwaway_required",
    "origin_not_allowed",
  ] as const) {
    it(`maps ${reason} to the generic permission failure`, () => {
      expect(mapRemoteEnvironmentError(forbidden(reason))).toMatchObject({
        _tag: "ConnectionBlockedError",
        reason: "permission",
      });
    });
  }

  it("maps a missing scope to the generic permission failure", () => {
    expect(
      mapRemoteEnvironmentError(
        new EnvironmentScopeRequiredError({
          code: "insufficient_scope",
          requiredScope: "orchestration:read",
          traceId: "trace-1",
        }),
      ),
    ).toMatchObject({ _tag: "ConnectionBlockedError", reason: "permission" });
  });
});
