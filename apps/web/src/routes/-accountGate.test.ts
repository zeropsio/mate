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
    ["loading", "/zerops/authorized", "pre-account"],
    ["signed-out", "/zerops/authorized/", "pre-account"],
    ["signed-in", "/ZEROPS/AUTHORIZED", "pre-account"],
    // The Gitea consent page has to keep the request the broker put in its
    // URL before sending the person off to sign in; signed in it is an
    // ordinary product route, because it reads the account to decide whether
    // that URL's `broker` is really theirs.
    ["signed-out", "/gitea-signin", "pre-account"],
    ["loading", "/gitea-signin/", "pre-account"],
    ["signed-in", "/gitea-signin", "app"],
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
      "pre-account",
    );
  });

  // The path has to match whole, not by prefix: a route merely starting with
  // it is a product route like any other.
  it("lets nothing but the consent page itself through signed out", () => {
    expect(
      resolveZeropsAccountGate({ pathname: "/gitea-signin/anything", status: "signed-out" }),
    ).toBe("auth-only");
  });
});
