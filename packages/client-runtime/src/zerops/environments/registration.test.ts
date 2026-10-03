import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { registrationOnItsWay } from "./registration.ts";

const at = 1_000 as never;

describe("registrationOnItsWay: a wanted Mate not registered yet is on its way", () => {
  it.each([
    ["wanted, nothing started", true, { kind: "none", reconnect: false }, true],
    [
      "wanted, waiting on the grant",
      true,
      { kind: "waiting", on: "grant", reconnect: false },
      true,
    ],
    [
      "wanted, exchanging",
      true,
      { kind: "exchanging", attempt: 1, deadline: at, reconnect: false },
      true,
    ],
    [
      "held, the registry not taken it yet",
      true,
      {
        kind: "held",
        environmentId: EnvironmentId.make("env-wren"),
        installed: false,
        staleBlock: false,
        rereading: null,
      },
      true,
    ],
    [
      "registered",
      true,
      {
        kind: "held",
        environmentId: EnvironmentId.make("env-wren"),
        installed: true,
        staleBlock: false,
        rereading: null,
      },
      false,
    ],
    [
      "its exchange failed and waits to retry",
      true,
      { kind: "backoff", retryAt: at, last: { kind: "network" }, reconnect: false },
      false,
    ],
    ["refused", true, { kind: "refused", reason: { kind: "configuration" } }, false],
    ["not wanted: past auto-connect's ceiling", false, { kind: "none", reconnect: false }, false],
  ] as const)("%s", (_case, want, credential, onItsWay) => {
    expect(registrationOnItsWay({ guards: { want }, credential } as never)).toBe(onItsWay);
  });
});
