import {
  ZeropsApiClient,
  ZeropsApiError,
  clearZeropsSession,
  loadZeropsSession,
  requiresZeropsTwoFactor,
  saveZeropsSession,
  zeropsClientsFromUser,
  type ZeropsOrganization,
  type ZeropsSession,
  type ZeropsUser,
} from "@t3tools/client-runtime/zerops";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { mobileZeropsStorage } from "./storage";
export { zeropsErrorMessage } from "./errors";

export type ZeropsSessionStatus = "loading" | "signed-out" | "totp-required" | "signed-in";

export interface ZeropsSessionValue {
  readonly client: ZeropsApiClient;
  readonly status: ZeropsSessionStatus;
  readonly user: ZeropsUser | null;
  readonly organizations: ReadonlyArray<ZeropsOrganization>;
  readonly restoreError: Error | null;
  readonly retryRestore: () => void;
  readonly newRecoveryToken: string | null;
  readonly clearNewRecoveryToken: () => void;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly verifyTotp: (code: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const ZeropsSessionContext = createContext<ZeropsSessionValue | null>(null);

export function ZeropsSessionProvider({ children }: { readonly children: ReactNode }) {
  const [status, setStatus] = useState<ZeropsSessionStatus>("loading");
  const [user, setUser] = useState<ZeropsUser | null>(null);
  const [restoreError, setRestoreError] = useState<Error | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [newRecoveryToken, setNewRecoveryToken] = useState<string | null>(null);

  const client = useMemo(
    () =>
      new ZeropsApiClient({
        onSessionChange: (session: ZeropsSession | null) => {
          if (session === null) {
            setStatus("signed-out");
            setUser(null);
            setNewRecoveryToken(null);
            return clearZeropsSession(mobileZeropsStorage);
          }
          return saveZeropsSession(mobileZeropsStorage, session);
        },
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await loadZeropsSession(mobileZeropsStorage);
        if (cancelled) return;
        if (!session) {
          setStatus("signed-out");
          return;
        }
        client.restoreSession(session);
        const restored = await client.fetchUser();
        if (cancelled) return;
        setUser(restored);
        setStatus("signed-in");
      } catch (cause) {
        if (cancelled) return;
        if (
          cause instanceof ZeropsApiError &&
          (cause.kind === "expired-session" || cause.status === 401)
        ) {
          // The API client normally clears an explicitly expired session
          // itself. Keep this fallback for injected/alternate clients while
          // avoiding a duplicate SecureStore write in the common path.
          if (client.session) await client.signOutLocally();
          if (cancelled) return;
          setRestoreError(null);
          setStatus("signed-out");
          return;
        }

        // Keychain and network failures say nothing about credential
        // validity. Leave the stored/client session intact so a retry can
        // recover instead of turning a temporary outage into a local logout.
        setRestoreError(cause instanceof Error ? cause : new Error("Could not restore session."));
        setStatus("signed-out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, restoreAttempt]);

  const value = useMemo<ZeropsSessionValue>(
    () => ({
      client,
      status,
      user,
      organizations: user ? zeropsClientsFromUser(user) : [],
      restoreError,
      retryRestore: () => {
        setRestoreError(null);
        setStatus("loading");
        setRestoreAttempt((attempt) => attempt + 1);
      },
      newRecoveryToken,
      clearNewRecoveryToken: () => {
        setNewRecoveryToken(null);
      },
      signIn: async (email, password) => {
        setNewRecoveryToken(null);
        const response = await client.login(email, password);
        if (requiresZeropsTwoFactor(response.auth)) {
          setStatus("totp-required");
          return;
        }
        setUser(response.user ?? (await client.fetchUser()));
        setStatus("signed-in");
      },
      verifyTotp: async (code) => {
        const session = await client.verifyTotp(code);
        setNewRecoveryToken(session.newRecoveryToken?.trim() || null);
        setUser(await client.fetchUser());
        setStatus("signed-in");
      },
      signOut: async () => {
        try {
          await client.logout();
        } catch {
          // logout clears the held session in a finally block. A network error
          // must not trap the user on the account screen after that local exit.
          await client.signOutLocally();
        }
      },
    }),
    [client, newRecoveryToken, restoreError, status, user],
  );

  return <ZeropsSessionContext value={value}>{children}</ZeropsSessionContext>;
}

export function useZeropsSession(): ZeropsSessionValue {
  const value = useContext(ZeropsSessionContext);
  if (!value) throw new Error("useZeropsSession must be used inside a ZeropsSessionProvider.");
  return value;
}
