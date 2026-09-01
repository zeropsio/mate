/**
 * The signed-in Zerops account, available to every route.
 *
 * It sits outside the router because Zerops identity is independent of T3's
 * environment auth gate: `/zerops` and `/settings/zerops` are reachable
 * through more than one branch of that gate, and the session has to outlive
 * route transitions.
 *
 * The access token lives here and in `localStorage` — never on a z3 server.
 */

import {
  ZeropsApiClient,
  ZeropsApiError,
  clearZeropsSession,
  loadZeropsSession,
  requiresZeropsTwoFactor,
  saveZeropsSession,
  zeropsClientsFromUser,
  type ZeropsOrganization,
  type ZeropsRegistrationInput,
  type ZeropsRegistrationResponse,
  type ZeropsSession,
  type ZeropsStorageAdapter,
  type ZeropsUser,
} from "@t3tools/client-runtime/zerops";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { browserZeropsStorage } from "./storage";

export type ZeropsSessionStatus = "loading" | "signed-out" | "totp-required" | "signed-in";

export interface ZeropsSessionValue {
  readonly client: ZeropsApiClient;
  readonly status: ZeropsSessionStatus;
  readonly user: ZeropsUser | null;
  readonly organizations: ReadonlyArray<ZeropsOrganization>;
  readonly signIn: (email: string, password: string) => Promise<void>;
  /**
   * Adopts a refresh token handed back by `app.zerops.io` after the user
   * signed in there — the end of the hand-over (`zerops/handover.ts`). Signing
   * up and signing in with GitHub only work on that origin, so this is how a
   * session arrives without a password ever being typed here.
   */
  readonly adoptHandover: (input: {
    /** A personal access token minted for this client by app.zerops.io. */
    readonly token: string;
    /** True when the account just claimed a pool project, so the picker is skipped. */
    readonly zcpClaimed: boolean;
  }) => Promise<void>;
  readonly register: (input: ZeropsRegistrationInput) => Promise<ZeropsRegistrationResponse>;
  readonly verifyTotp: (code: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  /**
   * The response of the most recent in-app registration, until consumed. The
   * project picker reads it once, to enter the provisioning wait for the
   * project the registration's pool claim handed over, without waiting for a
   * candidate list to say so.
   */
  readonly lastRegistration: ZeropsRegistrationResponse | null;
  readonly clearLastRegistration: () => void;
}

const ZeropsSessionContext = createContext<ZeropsSessionValue | null>(null);

export function zeropsErrorMessage(error: unknown): string {
  if (error instanceof ZeropsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong talking to Zerops.";
}

export function ZeropsSessionProvider({
  children,
  storage = browserZeropsStorage,
}: {
  readonly children: ReactNode;
  readonly storage?: ZeropsStorageAdapter;
}) {
  const [status, setStatus] = useState<ZeropsSessionStatus>("loading");
  const [user, setUser] = useState<ZeropsUser | null>(null);
  const [lastRegistration, setLastRegistration] = useState<ZeropsRegistrationResponse | null>(null);

  const client = useMemo(
    () =>
      new ZeropsApiClient({
        onSessionChange: (session: ZeropsSession | null) => {
          if (session === null) {
            // The client clears itself when a refresh fails mid-flight, so a
            // session that dies between renders cannot leave an
            // authorized-looking UI behind.
            setStatus("signed-out");
            setUser(null);
            return clearZeropsSession(storage);
          }
          return saveZeropsSession(storage, session);
        },
      }),
    [storage],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await loadZeropsSession(storage);
      if (cancelled) return;
      if (!session) {
        setStatus("signed-out");
        return;
      }
      client.restoreSession(session);
      try {
        const restored = await client.fetchUser();
        if (cancelled) return;
        setUser(restored);
        setStatus("signed-in");
      } catch {
        // A stored session that no longer works reads as signed out; the
        // client has already cleared it if the API said so.
        if (cancelled) return;
        setStatus("signed-out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, storage]);

  const value = useMemo<ZeropsSessionValue>(
    () => ({
      client,
      status,
      user,
      organizations: user ? zeropsClientsFromUser(user) : [],
      adoptHandover: async ({ token, zcpClaimed }) => {
        const session = await client.adoptPersonalToken(token);
        const adopted = await client.fetchUser();
        setUser(adopted);
        setStatus("signed-in");
        if (zcpClaimed) {
          // The picker reads this to enter the provisioning wait for the
          // project the claim handed over, instead of waiting for a candidate
          // list to say so. It is a registration response in every way that
          // consumer looks at: the org comes from `user`, the claim from the
          // flag.
          setLastRegistration({ auth: session, user: adopted, zcpClaimed: true });
        }
      },
      signIn: async (email, password) => {
        const response = await client.login(email, password);
        if (requiresZeropsTwoFactor(response.auth)) {
          setStatus("totp-required");
          return;
        }
        setUser(response.user ?? (await client.fetchUser()));
        setStatus("signed-in");
      },
      register: async (input) => {
        const response = await client.register(input);
        setUser(response.user ?? (await client.fetchUser()));
        setStatus("signed-in");
        setLastRegistration(response);
        return response;
      },
      verifyTotp: async (code) => {
        await client.verifyTotp(code);
        setUser(await client.fetchUser());
        setStatus("signed-in");
      },
      signOut: async () => {
        await client.logout();
        setLastRegistration(null);
      },
      lastRegistration,
      clearLastRegistration: () => {
        setLastRegistration(null);
      },
    }),
    [client, status, user, lastRegistration],
  );

  return <ZeropsSessionContext value={value}>{children}</ZeropsSessionContext>;
}

export function useZeropsSession(): ZeropsSessionValue {
  const value = useContext(ZeropsSessionContext);
  if (!value) {
    throw new Error("useZeropsSession must be used inside a ZeropsSessionProvider.");
  }
  return value;
}
