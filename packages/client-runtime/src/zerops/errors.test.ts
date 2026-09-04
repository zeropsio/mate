import { describe, expect, it } from "vite-plus/test";

import { ZeropsApiError } from "./api.ts";
import { zeropsErrorMessage } from "./errors.ts";

describe("zeropsErrorMessage", () => {
  it("error message shim matches the previous web and mobile outputs", () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [
        new ZeropsApiError("Session expired.", "expired-session", 401, "expired"),
        "Session expired.",
      ],
      [new Error("Network request failed"), "Network request failed"],
      ["boom", "Something went wrong talking to Zerops."],
      [undefined, "Something went wrong talking to Zerops."],
    ];

    for (const [cause, expected] of cases) {
      expect(zeropsErrorMessage(cause)).toBe(expected);
    }
  });
});
