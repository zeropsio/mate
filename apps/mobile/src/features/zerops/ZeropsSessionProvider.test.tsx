import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../../../web/src/test/reactHookHarness";

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
const runtime = vi.hoisted(() => ({
  loadSession: vi.fn(),
  saveSession: vi.fn(() => Promise.resolve()),
  clearSession: vi.fn(() => Promise.resolve()),
  client: {
    session: null as null | { readonly accessToken: string; readonly refreshToken?: string },
    restoreSession: vi.fn(),
    fetchUser: vi.fn(),
    signOutLocally: vi.fn(() => Promise.resolve()),
    login: vi.fn(),
    verifyTotp: vi.fn(),
    logout: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../../../web/src/test/reactHookHarness");
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      effects.push(effect);
    },
    useMemo: reactHookHarness.useMemo,
    useState: reactHookHarness.useState,
  };
});

vi.mock("@t3tools/client-runtime/zerops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@t3tools/client-runtime/zerops")>();
  return {
    ...actual,
    ZeropsApiClient: function ZeropsApiClient() {
      return runtime.client;
    },
    clearZeropsSession: runtime.clearSession,
    loadZeropsSession: runtime.loadSession,
    saveZeropsSession: runtime.saveSession,
  };
});

vi.mock("./storage", () => ({ mobileZeropsStorage: {} }));

import { ZeropsApiError } from "@t3tools/client-runtime/zerops";

import { ZeropsSessionProvider, type ZeropsSessionValue } from "./ZeropsSessionProvider";

const SESSION = { accessToken: "access-1", refreshToken: "refresh-1" };
const USER = { id: "user-1", email: "person@example.com", clientUserList: [] };

function renderProvider(): ZeropsSessionValue {
  hooks.beginRender();
  effects.length = 0;
  const element = ZeropsSessionProvider({ children: null }) as ReactElement<{
    readonly value: ZeropsSessionValue;
  }>;
  return element.props.value;
}

async function runRestoreEffect(): Promise<void> {
  const effect = effects[0];
  expect(effect).toBeDefined();
  effect?.();
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

describe("ZeropsSessionProvider restore lifecycle", () => {
  beforeEach(() => {
    hooks.reset();
    effects.length = 0;
    runtime.client.session = null;
    runtime.loadSession.mockReset();
    runtime.saveSession.mockClear();
    runtime.clearSession.mockClear();
    runtime.client.restoreSession.mockReset().mockImplementation((session) => {
      runtime.client.session = session;
    });
    runtime.client.fetchUser.mockReset();
    runtime.client.signOutLocally.mockReset().mockImplementation(() => {
      runtime.client.session = null;
      return Promise.resolve();
    });
    runtime.client.login.mockReset();
    runtime.client.verifyTotp.mockReset();
    runtime.client.logout.mockReset().mockResolvedValue(undefined);
  });

  it("leaves loading with a retryable error when SecureStore restore fails", async () => {
    const storageError = new Error("Keychain unavailable");
    runtime.loadSession.mockRejectedValue(storageError);

    renderProvider();
    await runRestoreEffect();
    const value = renderProvider();

    expect(value.status).toBe("signed-out");
    expect(value.restoreError).toBe(storageError);
    expect(value.retryRestore).toEqual(expect.any(Function));
  });

  it("retains a valid local session after transient fetchUser failure and can retry", async () => {
    const networkError = new ZeropsApiError("offline", "network");
    runtime.loadSession.mockResolvedValue(SESSION);
    runtime.client.fetchUser.mockRejectedValueOnce(networkError);

    renderProvider();
    await runRestoreEffect();
    let value = renderProvider();

    expect(value.status).toBe("signed-out");
    expect(value.restoreError).toBe(networkError);
    expect(runtime.client.session).toEqual(SESSION);
    expect(runtime.client.signOutLocally).not.toHaveBeenCalled();
    expect(runtime.clearSession).not.toHaveBeenCalled();

    runtime.client.fetchUser.mockResolvedValueOnce(USER);
    value.retryRestore();
    expect(renderProvider().status).toBe("loading");
    await runRestoreEffect();
    value = renderProvider();

    expect(value.status).toBe("signed-in");
    expect(value.restoreError).toBeNull();
    expect(value.user).toEqual(USER);
  });

  it("clears a restored session only for an explicit expired-session failure", async () => {
    runtime.loadSession.mockResolvedValue(SESSION);
    runtime.client.fetchUser.mockRejectedValue(
      new ZeropsApiError("expired", "expired-session", 401),
    );

    renderProvider();
    await runRestoreEffect();
    const value = renderProvider();

    expect(value.status).toBe("signed-out");
    expect(value.restoreError).toBeNull();
    expect(runtime.client.signOutLocally).toHaveBeenCalledOnce();
  });
});

describe("ZeropsSessionProvider recovery token", () => {
  beforeEach(() => {
    hooks.reset();
    effects.length = 0;
    runtime.client.session = null;
    runtime.loadSession.mockReset().mockResolvedValue(null);
    runtime.client.fetchUser.mockReset().mockResolvedValue(USER);
    runtime.client.restoreSession.mockReset();
    runtime.client.signOutLocally.mockReset().mockResolvedValue(undefined);
    runtime.client.login.mockReset().mockResolvedValue({
      auth: { accessToken: "half-1", twoFAMethods: ["TOTP"] },
      user: null,
    });
    runtime.client.verifyTotp.mockReset().mockResolvedValue({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      twoFAMethods: ["TOTP"],
      twoFAVerified: true,
      newRecoveryToken: "recovery-once",
    });
  });

  it("exposes the rotated recovery token until the consumer clears it", async () => {
    renderProvider();
    await runRestoreEffect();
    let value = renderProvider();
    await value.signIn("person@example.com", "secret");
    value = renderProvider();

    await value.verifyTotp("123456");
    value = renderProvider();
    expect(value.status).toBe("signed-in");
    expect(value.newRecoveryToken).toBe("recovery-once");

    value.clearNewRecoveryToken();
    expect(renderProvider().newRecoveryToken).toBeNull();
  });
});
