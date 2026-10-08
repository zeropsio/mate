import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentAuthInvalidError,
  EnvironmentOperationForbiddenError,
  EnvironmentScopeRequiredError,
} from "@t3tools/contracts";

import { RemoteEnvironmentAuthUndeclaredStatusError } from "../rpc/http.ts";
import { mapRemoteEnvironmentError } from "./errors.ts";

const forbidden = (reason: EnvironmentOperationForbiddenError["reason"]) =>
  new EnvironmentOperationForbiddenError({
    code: "operation_forbidden",
    reason,
    traceId: "trace-1",
  });

describe("mapRemoteEnvironmentError", () => {
  // A session at the end of its life is renewed by its door, so it reads apart from every other
  // refusal; an older server never says `expired` and keeps today's reading.
  it.each([
    {
      case: "an expired session",
      refusal: { reason: "invalid_credential", expired: true },
      blocked: { detail: "The environment session expired.", expired: true },
    },
    {
      case: "any other refused credential",
      refusal: { reason: "invalid_credential" },
      blocked: { detail: "The environment credential is invalid.", expired: undefined },
    },
    {
      case: "a missing credential",
      refusal: { reason: "missing_credential" },
      blocked: { detail: "The environment credential is invalid.", expired: undefined },
    },
  ] as const)("reads $case as an authentication block", ({ refusal, blocked }) => {
    const mapped = mapRemoteEnvironmentError(
      new EnvironmentAuthInvalidError({ code: "auth_invalid", traceId: "trace-1", ...refusal }),
    );
    expect(mapped).toMatchObject({
      _tag: "ConnectionBlockedError",
      reason: "authentication",
      traceId: "trace-1",
      detail: blocked.detail,
    });
    expect(mapped._tag === "ConnectionBlockedError" ? mapped.expired : null).toBe(blocked.expired);
  });

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

  it.each(
    Array.from(
      ["zerops_project_membership_required", "zerops_throwaway_required"] as const,
      (reason) => ({ title: `maps ${reason} to the generic permission failure`, reason }),
    ),
  )("$title", ({ reason }) => {
    expect(mapRemoteEnvironmentError(forbidden(reason))).toMatchObject({
      _tag: "ConnectionBlockedError",
      reason: "permission",
    });
  });

  // A refusal whose body this client cannot decode — an older or newer server's
  // reason — still carries its status, and the status says whose move it is.
  it.each([
    { status: 401, mapped: { _tag: "ConnectionBlockedError", reason: "authentication" } },
    { status: 403, mapped: { _tag: "ConnectionBlockedError", reason: "permission" } },
    { status: 404, mapped: { _tag: "ConnectionTransientError", reason: "remote-unavailable" } },
    { status: 502, mapped: { _tag: "ConnectionTransientError", reason: "remote-unavailable" } },
  ] as const)("reads an undecodable $status by its status", ({ status, mapped }) => {
    expect(
      mapRemoteEnvironmentError(
        new RemoteEnvironmentAuthUndeclaredStatusError("https://mate.example/api", status),
      ),
    ).toMatchObject(mapped);
  });

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
