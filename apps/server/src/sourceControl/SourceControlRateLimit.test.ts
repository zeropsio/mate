import { assert, it } from "@effect/vitest";

import { retryAtFromHeader } from "./SourceControlRateLimit.ts";

it("parses Retry-After seconds and HTTP dates", () => {
  assert.equal(retryAtFromHeader("120", 1_000), 121_000);
  assert.equal(retryAtFromHeader("Thu, 01 Jan 1970 00:02:01 GMT", 1_000), 121_000);
  assert.isUndefined(retryAtFromHeader("later", 1_000));
});
