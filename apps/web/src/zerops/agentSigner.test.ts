import { describe, expect, it } from "vite-plus/test";

import { resolveAgentAuthorizer } from "@t3tools/client-runtime/zerops/agentOwnership";

describe("resolveAgentAuthorizer", () => {
  const login = (phase: "verifying-code" | "succeeded" | "failed" | "cancelled", by?: string) => ({
    phase,
    ...(by === undefined ? {} : { startedBy: by }),
  });

  it.each([
    {
      name: "the server's record names whose the agent is",
      agent: { authorizedBy: { subject: "user-b" }, login: login("verifying-code", "user-a") },
      expected: { subject: "user-b" },
    },
    {
      name: "the viewer's own login being checked is theirs before any record",
      agent: { login: login("verifying-code", "user-a") },
      expected: { subject: "user-a" },
    },
    {
      // A succeeded login is the server's to record; without its record it vouches for nobody.
      name: "the viewer's own finished login vouches for nobody by itself",
      agent: { login: login("succeeded", "user-a") },
      expected: undefined,
    },
    {
      name: "a colleague's login in flight is not the viewer's",
      agent: { login: login("verifying-code", "user-b") },
      expected: undefined,
    },
    {
      name: "a login that failed vouches for nobody",
      agent: { login: login("failed", "user-a") },
      expected: undefined,
    },
    {
      name: "a login that names no starter vouches for nobody",
      agent: { login: login("verifying-code") },
      expected: undefined,
    },
    { name: "neither means nobody", agent: {}, expected: undefined },
  ])("$name", ({ agent, expected }) => {
    expect(resolveAgentAuthorizer(agent, "user-a")).toEqual(expected);
  });
});
