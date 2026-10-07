import { describe, expect, it } from "vite-plus/test";

import { ZeropsApiError } from "./api.ts";
import { isUncertainZeropsFailure, zeropsErrorMessage } from "./errors.ts";

describe("zeropsErrorMessage", () => {
  it("error message shim matches the previous web and mobile outputs", () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [
        new ZeropsApiError("Session expired.", "expired-session", 401, "expired"),
        "Session expired.",
      ],
      [new Error("Network request failed"), "Network request failed"],
      [
        {
          _tag: "UnknownFailure",
          kind: "uncertain",
          message: "The platform accepted the request but its response was lost.",
        },
        "The platform accepted the request but its response was lost.",
      ],
      ["boom", "Something went wrong talking to Zerops."],
      [undefined, "Something went wrong talking to Zerops."],
    ];

    for (const [cause, expected] of cases) {
      expect(zeropsErrorMessage(cause)).toBe(expected);
    }
  });
});

describe("isUncertainZeropsFailure — a write the platform may have done anyway", () => {
  it.each<{ readonly case: string; readonly cause: unknown; readonly uncertain: boolean }>([
    { case: "the client's own", cause: new ZeropsApiError("Lost.", "uncertain"), uncertain: true },
    {
      case: "the data layer's",
      cause: { _tag: "UnknownFailure", kind: "uncertain", message: "Lost." },
      uncertain: false,
    },
    { case: "a refusal", cause: new ZeropsApiError("No.", "forbidden", 403), uncertain: false },
    {
      case: "the data layer's refusal",
      cause: { _tag: "UnknownFailure", kind: "forbidden", message: "No." },
      uncertain: false,
    },
    { case: "anything else", cause: new Error("Lost."), uncertain: false },
  ])("$case: $uncertain", ({ cause, uncertain }) => {
    expect(isUncertainZeropsFailure(cause)).toBe(uncertain);
  });
});
