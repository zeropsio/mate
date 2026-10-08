/**
 * Signs a browser-test page into a real Zerops account, for agents testing a
 * dev build as several people.
 *
 * It reads the accounts from `MATE_TEST_ACCOUNTS` — a JSON array of
 * `{ email, password }` — logs the one with `email` in with
 * `POST /auth/login`, and hands the session to the page through the dev-only
 * `window.__mateDev.adoptSession`. The session is the helper's own, so
 * `logout()` ends it at the platform: call it on teardown.
 *
 * `page` is anything with `evaluate(fn, arg)` — a Playwright or Puppeteer
 * page both fit. The function crosses into the browser as source, so it closes
 * over nothing.
 */
import { DEFAULT_ZEROPS_API_BASE } from "@t3tools/client-runtime/zerops";

import type { MateDevSession } from "../src/zerops/devSession";

const PUBLIC_API_PREFIX = "/api/rest/public";

export interface SignInPage {
  readonly evaluate: <A>(fn: (arg: A) => Promise<void>, arg: A) => Promise<unknown>;
}

/**
 * One entry of `MATE_TEST_ACCOUNTS`. It says who, never what they may do:
 * that is the Zerops platform's permissions alone.
 */
export interface TestAccount {
  readonly email: string;
  readonly password: string;
}

export interface SignedInAccount {
  readonly email: string;
  /** Ends the session at the platform. */
  readonly logout: () => Promise<void>;
}

export interface SignInAsOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly apiBaseUrl?: string;
}

export async function signInAs(
  page: SignInPage,
  email: string,
  options: SignInAsOptions = {},
): Promise<SignedInAccount> {
  const account = testAccount(options.env ?? process.env, email);
  const send = options.fetch ?? fetch;
  const api = `${(options.apiBaseUrl ?? DEFAULT_ZEROPS_API_BASE).replace(/\/+$/u, "")}${PUBLIC_API_PREFIX}`;

  const response = await send(`${api}/auth/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!response.ok) {
    throw new Error(
      `Zerops refused the login of test account ${account.email} (${response.status}).`,
    );
  }
  const login = (await response.json()) as {
    readonly auth?: { readonly accessToken?: string; readonly refreshToken?: string };
    readonly user?: unknown;
  };
  // `user` is null until a second factor is passed; the half session is
  // useless to the page, so the account is not one this helper can sign in.
  if (login.user === null || !login.auth?.accessToken || !login.auth.refreshToken) {
    throw new Error(
      `Test account ${account.email} needs a second factor; use an account without 2FA.`,
    );
  }
  const session: MateDevSession = {
    accessToken: login.auth.accessToken,
    refreshToken: login.auth.refreshToken,
  };

  const logout = async () => {
    await send(`${api}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
  };

  try {
    await page.evaluate(async (handed) => {
      const hooks = window.__mateDev;
      if (hooks === undefined) {
        throw new Error("This page is not a mate dev build: window.__mateDev is missing.");
      }
      await hooks.adoptSession(handed);
    }, session);
  } catch (cause) {
    // Nobody else will ever end the session minted for this page.
    await logout();
    throw cause;
  }

  return { email: account.email, logout };
}

function testAccount(
  env: Readonly<Record<string, string | undefined>>,
  email: string,
): TestAccount {
  let accounts: unknown;
  try {
    accounts = JSON.parse(env.MATE_TEST_ACCOUNTS ?? "[]");
  } catch {
    // The value holds passwords: never echo it.
    throw new Error(
      `Cannot sign in as ${email}: MATE_TEST_ACCOUNTS is not a JSON array of {email, password}.`,
    );
  }
  const account = Array.isArray(accounts)
    ? (accounts as ReadonlyArray<TestAccount>).find((candidate) => candidate.email === email)
    : undefined;
  if (account === undefined) {
    throw new Error(
      `Cannot sign in as ${email}: MATE_TEST_ACCOUNTS lists no account with that email.`,
    );
  }
  return account;
}
