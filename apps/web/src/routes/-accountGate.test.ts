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

  it("AL-01 requires the account on every product route, whatever the server is", () => {
    [
      "/",
      "/projects/example/threads/example",
      "/settings/general",
      "/usage",
      "/zerops",
      "/zerops/new",
      "/pair",
    ].forEach((pathname) => {
      expect(resolveZeropsAccountGate({ pathname, status: "signed-out" })).toBe("auth-only");
    });
  });

  it("keeps the identity callback ahead of the gate that its credential creates", () => {
    expect(resolveZeropsAccountGate({ pathname: "/zerops/authorized", status: "signed-out" })).toBe(
      "handover",
    );
  });
});
