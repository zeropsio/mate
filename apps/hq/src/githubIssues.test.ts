import { assert, describe, it } from "@effect/vitest";

import { refusalOf } from "./githubIssues.ts";

describe("GitHub's refusals", () => {
  it.each([
    {
      body: '{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"No commits between main and mate/7-footer"}]}',
      said: "Validation Failed: No commits between main and mate/7-footer",
    },
    {
      body: '{"message":"Validation Failed","errors":[{"resource":"PullRequest","field":"head","code":"invalid"}]}',
      said: "Validation Failed: head invalid",
    },
    {
      body: '{"message":"Resource not accessible by integration","status":"403"}',
      said: "Resource not accessible by integration",
    },
    { body: "<html>Bad gateway</html>", said: undefined },
  ])("a refused write's reason reads as GitHub said it: $said", ({ body, said }) => {
    assert.strictEqual(refusalOf(body), said);
  });
});
