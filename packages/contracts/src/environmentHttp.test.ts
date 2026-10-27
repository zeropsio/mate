import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  EnvironmentAuthInvalidError,
  EnvironmentInternalError,
  EnvironmentOperationForbiddenError,
  EnvironmentRequestInvalidError,
  EnvironmentResourceNotFoundError,
  EnvironmentScopeRequiredError,
} from "./environmentHttp.ts";

const traceId = "trace-1";

describe("environment HTTP errors", () => {
  // A client squashes the cause and shows `message`; an empty one becomes a generic
  // "The environment request failed." that names nothing the reader can act on.
  it("each carries a message that names its reason", () => {
    const errors = [
      new EnvironmentRequestInvalidError({
        code: "invalid_request",
        reason: "invalid_command",
        traceId,
      }),
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "missing_credential",
        traceId,
      }),
      new EnvironmentScopeRequiredError({
        code: "insufficient_scope",
        requiredScope: "orchestration:read",
        traceId,
      }),
      new EnvironmentOperationForbiddenError({
        code: "operation_forbidden",
        reason: "current_session_revoke_not_allowed",
        traceId,
      }),
      new EnvironmentResourceNotFoundError({
        code: "not_found",
        reason: "thread_not_found",
        traceId,
      }),
      new EnvironmentInternalError({
        code: "internal_error",
        reason: "orchestration_snapshot_failed",
        traceId,
      }),
    ] as const;
    const details = [
      "invalid_command",
      "missing_credential",
      "orchestration:read",
      "current_session_revoke_not_allowed",
      "thread_not_found",
      "orchestration_snapshot_failed",
    ];
    errors.forEach((error, index) => {
      expect(error.message).toContain(details[index]);
    });
  });
});

describe("a refused credential's 401", () => {
  const body = { _tag: "EnvironmentAuthInvalidError", code: "auth_invalid", traceId } as const;
  const decode = Schema.decodeUnknownSync(EnvironmentAuthInvalidError);

  // The client tells a session that reached the end of its life (the door mints the next, nothing
  // is wrong) from every other refusal by this one optional field.
  it.each([
    {
      case: "an expired session",
      sent: { reason: "invalid_credential", expired: true },
      expired: true,
    },
    { case: "any other refusal", sent: { reason: "invalid_credential" }, expired: undefined },
    { case: "no credential at all", sent: { reason: "missing_credential" }, expired: undefined },
  ])("names $case", ({ sent, expired }) => {
    expect(decode({ ...body, ...sent }).expired).toBe(expired);
  });

  // A client older than the field reads the same body: it ignores what it does not know.
  it("reads the same for a client that predates the field", () => {
    const olderClient = Schema.Struct({
      _tag: Schema.Literal("EnvironmentAuthInvalidError"),
      code: Schema.Literal("auth_invalid"),
      reason: Schema.Literals(["missing_credential", "invalid_credential"]),
      traceId: Schema.String,
    });
    expect(
      Schema.decodeUnknownSync(olderClient)({
        ...body,
        reason: "invalid_credential",
        expired: true,
      }),
    ).toEqual({ ...body, reason: "invalid_credential" });
  });
});
