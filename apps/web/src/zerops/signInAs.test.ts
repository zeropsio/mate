import { makeFakeZeropsRest } from "@t3tools/client-runtime/zerops/testing";
import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { signInAs, type SignInPage } from "../../test/signInAs";

const API = "https://api.example.test";

const owner: ZeropsUser = { id: "user-1", email: "owner@example.test", clientUserList: [] };

/** A platform with the accounts the env names, and the env naming them. */
function platform() {
  const rest = makeFakeZeropsRest();
  rest.addUser({ user: owner, password: "owner-secret" });
  const env = {
    MATE_TEST_ACCOUNTS: JSON.stringify([
      { name: "owner", email: owner.email, password: "owner-secret", writes: true },
    ]),
  };
  return { rest, env, options: { env, fetch: rest.fetch, apiBaseUrl: API } };
}

/** A browser page that runs `evaluate` against a window carrying the dev hook. */
function devPage(): SignInPage & { readonly adopted: () => ReadonlyArray<unknown> } {
  const adopted: unknown[] = [];
  vi.stubGlobal("window", {
    __mateDev: {
      adoptSession: async (session: unknown) => {
        adopted.push(session);
      },
    },
  });
  return {
    evaluate: async (fn, arg) => fn(arg),
    adopted: () => adopted,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signInAs", () => {
  it("logs the named account in and hands its session to the page's dev hook", async () => {
    const { rest, options } = platform();
    const page = devPage();

    const account = await signInAs(page, "owner", options);

    expect(account).toMatchObject({ name: "owner", email: owner.email, writes: true });
    expect(page.adopted()).toEqual([
      { accessToken: expect.any(String), refreshToken: expect.any(String) },
    ]);
    expect(rest.requests().map(({ route }) => route)).toEqual(["POST /auth/login"]);
  });

  it("ends its own session at the platform on logout", async () => {
    const { rest, options } = platform();
    const page = devPage();
    const account = await signInAs(page, "owner", options);
    const { accessToken } = page.adopted()[0] as { accessToken: string };

    await account.logout();

    expect(rest.requests().filter(({ route }) => route === "POST /auth/logout")).toMatchObject([
      { token: accessToken },
    ]);
    const after = await rest.fetch(`${API}/api/rest/public/user/info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(after.status).toBe(401);
  });

  // A password alone does not finish a second-factor login: the half session
  // it answers is useless to the page, so nothing is handed over.
  it("refuses an account that needs a second factor, and hands the page nothing", async () => {
    const rest = makeFakeZeropsRest();
    rest.addUser({ user: owner, password: "owner-secret", totp: "123456" });
    const env = {
      MATE_TEST_ACCOUNTS: JSON.stringify([
        { name: "owner", email: owner.email, password: "owner-secret", writes: false },
      ]),
    };
    const page = devPage();

    await expect(
      signInAs(page, "owner", { env, fetch: rest.fetch, apiBaseUrl: API }),
    ).rejects.toThrow(/second factor/);
    expect(page.adopted()).toEqual([]);
  });

  // A production build carries no hook. The session the helper minted for it
  // is then nobody's, so it is ended before the error reaches the test.
  it("says the page is not a dev build, and ends the session it minted for it", async () => {
    const { rest, options } = platform();
    vi.stubGlobal("window", {});
    const page: SignInPage = { evaluate: async (fn, arg) => fn(arg) };

    await expect(signInAs(page, "owner", options)).rejects.toThrow(/dev build/);
    expect(rest.requests().map(({ route }) => route)).toEqual([
      "POST /auth/login",
      "POST /auth/logout",
    ]);
  });

  describe("names the account it cannot find, and never a password", () => {
    const rows = [
      { name: "an unknown name", env: { MATE_TEST_ACCOUNTS: "[]" } },
      { name: "no MATE_TEST_ACCOUNTS", env: {} },
      { name: "MATE_TEST_ACCOUNTS that is not JSON", env: { MATE_TEST_ACCOUNTS: "owner-secret" } },
    ];
    for (const row of rows) {
      it(row.name, async () => {
        const { rest } = platform();
        const failure = signInAs(devPage(), "owner", {
          env: row.env,
          fetch: rest.fetch,
          apiBaseUrl: API,
        });
        await expect(failure).rejects.toThrow(/MATE_TEST_ACCOUNTS/);
        await expect(failure).rejects.not.toThrow(/owner-secret/);
        expect(rest.requests()).toEqual([]);
      });
    }
  });
});
