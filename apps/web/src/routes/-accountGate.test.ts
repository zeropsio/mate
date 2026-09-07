import { describe, expect, it } from "vite-plus/test";

import { resolveZeropsAccountGate } from "./-accountGate";

describe("resolveZeropsAccountGate", () => {
  it.each([
    ["loading", "/settings/general", "auth-only"],
    ["signed-out", "/projects/example/threads/example", "auth-only"],
    ["totp-required", "/usage", "auth-only"],
    ["signed-out", "/pair", "pairing"],
    ["loading", "/pair/", "pairing"],
    ["signed-in", "/settings/general", "app"],
    ["loading", "/zerops/authorized", "handover"],
    ["signed-out", "/zerops/authorized/", "handover"],
    ["signed-in", "/ZEROPS/AUTHORIZED", "handover"],
  ] as const)("maps %s at %s to %s", (status, pathname, expected) => {
    expect(resolveZeropsAccountGate({ pathname, status })).toBe(expected);
  });

  it("requires the account on every route, whatever the server is", () => {
    // There is no second product behind the login: without this, a signed-out
    // client fell through to the upstream shell — project tree, branch
    // toolbar, and somebody's threads still readable.
    ["/", "/projects/example/threads/example", "/settings/general", "/usage"].forEach(
      (pathname) => {
        expect(resolveZeropsAccountGate({ pathname, status: "signed-out" })).toBe("auth-only");
      },
    );
  });

  it("keeps pairing reachable — it is how a client is pointed at a container", () => {
    expect(resolveZeropsAccountGate({ pathname: "/pair", status: "signed-out" })).toBe("pairing");
  });

  it("keeps the identity callback ahead of the gate that its credential creates", () => {
    expect(resolveZeropsAccountGate({ pathname: "/zerops/authorized", status: "signed-out" })).toBe(
      "handover",
    );
  });
});
