import { describe, expect, it } from "vite-plus/test";

import { resolveZeropsAccountGate } from "./-accountGate";

describe("resolveZeropsAccountGate", () => {
  it.each([
    ["loading", "/settings/general", "auth-only"],
    ["signed-out", "/projects/example/threads/example", "auth-only"],
    ["totp-required", "/usage", "auth-only"],
    ["signed-out", "/pair", "auth-only"],
    ["loading", "/pair/", "auth-only"],
    ["signed-in", "/settings/general", "app"],
    ["loading", "/zerops/authorized", "handover"],
    ["signed-out", "/zerops/authorized/", "handover"],
    ["signed-in", "/ZEROPS/AUTHORIZED", "handover"],
  ] as const)("maps %s at %s to %s", (status, pathname, expected) => {
    expect(resolveZeropsAccountGate({ pathname, status })).toBe(expected);
  });

  it("AL-01 requires Zerops identity even beside an authenticated local server", () => {
    expect(
      resolveZeropsAccountGate({
        accountRequired: false,
        pathname: "/projects/example/threads/example",
        status: "signed-out",
      }),
    ).toBe("auth-only");
  });

  it("keeps a Zerops entry's sub-route a bare login too, so the project wizard is not reachable signed out", () => {
    expect(
      resolveZeropsAccountGate({
        accountRequired: false,
        pathname: "/zerops/new",
        status: "signed-out",
      }),
    ).toBe("auth-only");
  });

  it("still hands the identity callback over rather than gating it as a Zerops sub-route", () => {
    expect(
      resolveZeropsAccountGate({
        accountRequired: false,
        pathname: "/zerops/authorized",
        status: "signed-out",
      }),
    ).toBe("handover");
  });

  it("keeps the explicit Zerops entry as a bare login even beside a local server", () => {
    expect(
      resolveZeropsAccountGate({
        accountRequired: false,
        pathname: "/zerops",
        status: "signed-out",
      }),
    ).toBe("auth-only");
  });
});
