import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  DesktopEnvironmentBootstrapSchema,
  DesktopZeropsSignInInputSchema,
  DesktopZeropsSignInProgressSchema,
  DesktopZeropsSignInResultSchema,
} from "./ipc.ts";

describe("DesktopEnvironmentBootstrapSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopEnvironmentBootstrapSchema);

  it("preserves the concrete running distro separately from the backend id", () => {
    expect(
      decode({
        id: "wsl:default",
        label: "WSL (Ubuntu)",
        runningDistro: "Ubuntu",
        httpBaseUrl: "http://127.0.0.1:3774/",
        wsBaseUrl: "ws://127.0.0.1:3774/",
      }),
    ).toEqual({
      id: "wsl:default",
      label: "WSL (Ubuntu)",
      runningDistro: "Ubuntu",
      httpBaseUrl: "http://127.0.0.1:3774/",
      wsBaseUrl: "ws://127.0.0.1:3774/",
    });
  });

  it("allows non-running and non-WSL bootstraps to report no running distro", () => {
    expect(
      decode({
        id: "primary",
        label: "Windows",
        runningDistro: null,
        httpBaseUrl: null,
        wsBaseUrl: null,
      }).runningDistro,
    ).toBeNull();
  });
});

describe("DesktopZeropsSignInInputSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopZeropsSignInInputSchema);

  it("requires a non-empty state nonce", () => {
    expect(decode({ state: "nonce-1" })).toEqual({ state: "nonce-1" });
    expect(() => decode({ state: "" })).toThrow();
    expect(() => decode({})).toThrow();
  });

  it("carries an optional register intent", () => {
    expect(decode({ state: "nonce-1", intent: "register" })).toEqual({
      state: "nonce-1",
      intent: "register",
    });
    expect(() => decode({ state: "nonce-1", intent: "sign-in" })).toThrow();
  });
});

describe("DesktopZeropsSignInResultSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopZeropsSignInResultSchema);

  it("decodes a delivered callback fragment", () => {
    expect(decode({ kind: "callback", fragment: "#token=rt-1&state=nonce-1" })).toEqual({
      kind: "callback",
      fragment: "#token=rt-1&state=nonce-1",
    });
  });

  it("decodes a cancelled outcome", () => {
    expect(decode({ kind: "cancelled" })).toEqual({ kind: "cancelled" });
  });

  it.each([
    { title: "decodes a denied device login", result: { kind: "denied" } },
    { title: "decodes an expired device login", result: { kind: "expired" } },
    {
      title: "decodes a device login the platform refused, with its words",
      result: { kind: "failed", message: "Zerops would not start the sign-in." },
    },
    {
      title: "decodes an approved device login's full session",
      result: {
        kind: "session",
        session: {
          accessToken: "at-1",
          refreshToken: "rt-1",
          expiresAt: "2026-10-14T12:00:00Z",
          expiresIn: 3600,
          userId: "user-1",
          tokenType: "Bearer",
          twoFAMethods: ["TOTP"],
          twoFAVerified: true,
        },
      },
    },
    {
      title: "decodes an approved device login carrying an access token alone",
      result: { kind: "session", session: { accessToken: "at-1" } },
    },
  ])("$title", ({ result }) => {
    expect(decode(result)).toEqual(result);
  });

  it("rejects a session without an access token", () => {
    expect(() => decode({ kind: "session", session: { accessToken: "" } })).toThrow();
    expect(() => decode({ kind: "session", session: {} })).toThrow();
  });
});

describe("DesktopZeropsSignInProgressSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopZeropsSignInProgressSchema);

  it("carries the attempt's nonce and the code the consent page shows", () => {
    expect(decode({ state: "nonce-1", userCode: "ABCD-EFGH" })).toEqual({
      state: "nonce-1",
      userCode: "ABCD-EFGH",
    });
    expect(() => decode({ state: "nonce-1", userCode: "" })).toThrow();
    expect(() => decode({ userCode: "ABCD-EFGH" })).toThrow();
  });
});
