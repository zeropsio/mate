/**
 * The account session's own calls to the platform, behind the data layer: the tab's Zerops client,
 * and what a sign-in, a restore, a principal probe and a sign-out ask of the platform. The session
 * machines (web and mobile) hold these as ports and never reach the platform themselves.
 *
 * @module zerops/data/zeropsSession
 */
import {
  ZeropsApiClient,
  ZeropsApiError,
  type FetchImplementation,
  type ZeropsApiClientOptions,
  type ZeropsRegistrationResponse,
  type ZeropsUser,
} from "../api.ts";
import type { ZeropsRegistrationInput } from "../registration.ts";
import { requiresZeropsTwoFactor, type ZeropsSession } from "../session.ts";

/** What `user/info` said about a session. */
export type ZeropsPrincipalVerdict =
  | { readonly kind: "user"; readonly user: ZeropsUser }
  | { readonly kind: "unauthorized" }
  /** Zerops did not answer; a 429 says how long to wait (`Retry-After`). */
  | { readonly kind: "unavailable"; readonly retryAfterMs?: number };

/** Zerops did not answer `cause`: a 429 carries the Retry-After the next check waits out. */
export function unavailableVerdict(cause: unknown): ZeropsPrincipalVerdict {
  return cause instanceof ZeropsApiError && cause.status === 429 && cause.retryAfterMs !== null
    ? { kind: "unavailable", retryAfterMs: cause.retryAfterMs }
    : { kind: "unavailable" };
}

export interface ZeropsSessionCalls {
  /** The client the session holds its token in; the app's other readers share it. */
  readonly client: ZeropsApiClient;
  /** `user/info` with the held session. */
  readonly readUser: () => Promise<ZeropsUser>;
  /**
   * A token minted elsewhere — the hand-over's, or one a dev build injects — held and stored only
   * once a read proved it, with the person it names.
   */
  readonly adoptToken: (input: {
    readonly accessToken: string;
    readonly refreshToken?: string;
  }) => Promise<{ readonly session: ZeropsSession; readonly user: ZeropsUser }>;
  /** A password sign-in: its person, or `null` while its second factor is outstanding. */
  readonly signIn: (email: string, password: string) => Promise<ZeropsUser | null>;
  /** A registration, which signs in at once: the platform's answer and its person. */
  readonly signUp: (input: ZeropsRegistrationInput) => Promise<{
    readonly response: ZeropsRegistrationResponse;
    readonly user: ZeropsUser;
  }>;
  /** The second factor completing a sign-in: the session it issued and its person. */
  readonly confirmSecondFactor: (
    code: string,
  ) => Promise<{ readonly session: ZeropsSession; readonly user: ZeropsUser }>;
  /** Ends the session at the platform, and here whatever the platform answers. */
  readonly signOutAtPlatform: () => Promise<void>;
}

export function makeZeropsSessionCalls(options: ZeropsApiClientOptions): ZeropsSessionCalls {
  const client = new ZeropsApiClient(options);
  return {
    client,
    readUser: () => client.fetchUser(),
    adoptToken: async (input) => {
      const session = await client.adoptSession(input);
      return { session, user: await client.fetchUser() };
    },
    signIn: async (email, password) => {
      const response = await client.login(email, password);
      if (requiresZeropsTwoFactor(response.auth)) return null;
      return response.user ?? (await client.fetchUser());
    },
    signUp: async (input) => {
      const response = await client.register(input);
      return { response, user: response.user ?? (await client.fetchUser()) };
    },
    confirmSecondFactor: async (code) => {
      const session = await client.verifyTotp(code);
      return { session, user: await client.fetchUser() };
    },
    signOutAtPlatform: async () => {
      try {
        await client.logout();
      } catch {
        // The logout clears the held session before it asks the platform; a platform that does
        // not answer must not keep the person on the account screen after that local exit.
        await client.signOutLocally();
      }
    },
  };
}

/**
 * The session machine's `probe` port over the platform: one `user/info` with the session's access
 * token alone, so a 401 never spends the refresh token another tab shares, and never touches the
 * tab's own client.
 */
export async function probeZeropsPrincipal(
  options: { readonly fetch: FetchImplementation; readonly baseUrl: string },
  session: ZeropsSession,
): Promise<ZeropsPrincipalVerdict> {
  const probe = new ZeropsApiClient({ fetch: options.fetch, baseUrl: options.baseUrl });
  probe.restoreSession({ accessToken: session.accessToken });
  try {
    return { kind: "user", user: await probe.fetchUser() };
  } catch (cause) {
    return cause instanceof ZeropsApiError && cause.status === 401
      ? { kind: "unauthorized" }
      : unavailableVerdict(cause);
  }
}
