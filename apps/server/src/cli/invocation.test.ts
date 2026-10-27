import { assert, it } from "@effect/vitest";

import { formatCliCommand } from "./invocation.ts";

it("formats suggestions for the installed release executable", () => {
  assert.equal(formatCliCommand("serve"), "mate serve");
  assert.equal(formatCliCommand("triage"), "mate triage");
});
