import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  DesktopEnvironmentBootstrapSchema,
  DesktopZeropsSignInInputSchema,
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
});
