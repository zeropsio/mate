import { makeFakeZeropsRest } from "@t3tools/client-runtime/zerops/testing";
import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { signInAs, type SignInPage } from "../../test/signInAs";

const API = "https://api.example.test";

const person: ZeropsUser = { id: "user-1", email: "person@example.test", clientUserList: [] };

/** A platform with the account the env lists, and the env listing it. */
function platform() {
  const rest = makeFakeZeropsRest();
  rest.addUser({ user: person, password: "person-secret" });
  const env = {
    MATE_TEST_ACCOUNTS: JSON.stringify([{ email: person.email, password: "person-secret" }]),
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
  it("logs the listed account in and hands its session to the page's dev hook", async () => {
    const { rest, options } = platform();
    const page = devPage();

    const account = await signInAs(page, person.email, options);

    // What the account may do is the platform's to say; the helper says only who.
    expect(Object.keys(account).toSorted()).toEqual(["email", "logout"]);
    expect(account.email).toBe(person.email);
    expect(page.adopted()).toEqual([
      { accessToken: expect.any(String), refreshToken: expect.any(String) },
    ]);
    expect(rest.requests().map(({ route }) => route)).toEqual(["POST /auth/login"]);
  });

  it("ends its own session at the platform on logout", async () => {
    const { rest, options } = platform();
    const page = devPage();
    const account = await signInAs(page, person.email, options);
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
    rest.addUser({ user: person, password: "person-secret", totp: "123456" });
    const env = {
      MATE_TEST_ACCOUNTS: JSON.stringify([{ email: person.email, password: "person-secret" }]),
    };
    const page = devPage();

    await expect(
      signInAs(page, person.email, { env, fetch: rest.fetch, apiBaseUrl: API }),
    ).rejects.toThrow(/second factor/);
    expect(page.adopted()).toEqual([]);
  });

  // A production build carries no hook. The session the helper minted for it
  // is then nobody's, so it is ended before the error reaches the test.
  it("says the page is not a dev build, and ends the session it minted for it", async () => {
    const { rest, options } = platform();
    vi.stubGlobal("window", {});
    const page: SignInPage = { evaluate: async (fn, arg) => fn(arg) };

    await expect(signInAs(page, person.email, options)).rejects.toThrow(/dev build/);
    expect(rest.requests().map(({ route }) => route)).toEqual([
      "POST /auth/login",
      "POST /auth/logout",
    ]);
  });

  describe("names the email it cannot find, and never a password", () => {
    const rows = [
      {
        name: "an email the list does not hold",
        env: {
          MATE_TEST_ACCOUNTS: JSON.stringify([
            { email: "someone@example.test", password: "person-secret" },
          ]),
        },
      },
      { name: "no MATE_TEST_ACCOUNTS", env: {} },
      { name: "MATE_TEST_ACCOUNTS that is not JSON", env: { MATE_TEST_ACCOUNTS: "person-secret" } },
    ];
    it.each(Array.from(rows, (row) => ({ title: row.name, row })))("$title", async ({ row }) => {
      const { rest } = platform();
      const failure = signInAs(devPage(), person.email, {
        env: row.env,
        fetch: rest.fetch,
        apiBaseUrl: API,
      });
      await expect(failure).rejects.toThrow(/MATE_TEST_ACCOUNTS/);
      await expect(failure).rejects.toThrow(person.email);
      await expect(failure).rejects.not.toThrow(/person-secret/);
      expect(rest.requests()).toEqual([]);
    });
  });
});
