import { makeZeropsSessionCalls } from "@t3tools/client-runtime/data";
import {
  ZeropsApiError,
  clearZeropsSession,
  loadZeropsSession,
  saveZeropsSession,
  zeropsClientsFromUser,
  type ZeropsApiClient,
  type ZeropsOrganization,
  type ZeropsSession,
  type ZeropsUser,
} from "@t3tools/client-runtime/zerops";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { mobileZeropsStorage } from "./storage";
import { ZeropsDataProvider } from "./ZeropsDataProvider";
export { zeropsErrorMessage } from "./errors";

export type ZeropsSessionStatus = "loading" | "signed-out" | "totp-required" | "signed-in";

export interface ZeropsSessionValue {
  readonly client: ZeropsApiClient;
  readonly status: ZeropsSessionStatus;
  readonly user: ZeropsUser | null;
  readonly activeOrganization: ZeropsOrganization | null;
  readonly selectOrganization: (id: string) => void;
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
  const [selectedOrganizationId, selectOrganization] = useState<string | null>(null);
  const [user, setUser] = useState<ZeropsUser | null>(null);
  const [restoreError, setRestoreError] = useState<Error | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [newRecoveryToken, setNewRecoveryToken] = useState<string | null>(null);

  const calls = useMemo(
    () =>
      makeZeropsSessionCalls({
        onSessionChange: (session: ZeropsSession | null) => {
          if (session === null) {
            setStatus("signed-out");
            setUser(null);
            selectOrganization(null);
            setNewRecoveryToken(null);
            return clearZeropsSession(mobileZeropsStorage);
          }
          return saveZeropsSession(mobileZeropsStorage, session);
        },
      }),
    [],
  );
  const { client } = calls;

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
        calls.client.restoreSession(session);
        const restored = await calls.readUser();
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
          if (calls.client.session) await calls.client.signOutLocally();
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
  }, [calls, restoreAttempt]);

  const organizations = useMemo(() => (user ? zeropsClientsFromUser(user) : []), [user]);
  const activeOrganization =
    organizations.find(({ id }) => id === selectedOrganizationId) ??
    (organizations.length === 1 ? organizations[0]! : null);
  const value = useMemo<ZeropsSessionValue>(
    () => ({
      client,
      status,
      user,
      organizations,
      activeOrganization,
      selectOrganization,
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
        const signedIn = await calls.signIn(email, password);
        if (signedIn === null) {
          setStatus("totp-required");
          return;
        }
        setUser(signedIn);
        setStatus("signed-in");
      },
      verifyTotp: async (code) => {
        const { session, user: verified } = await calls.confirmSecondFactor(code);
        setNewRecoveryToken(session.newRecoveryToken?.trim() || null);
        setUser(verified);
        setStatus("signed-in");
      },
      signOut: calls.signOutAtPlatform,
    }),
    [
      calls,
      client,
      newRecoveryToken,
      restoreError,
      status,
      user,
      organizations,
      activeOrganization,
    ],
  );

  return (
    <ZeropsSessionContext value={value}>
      <ZeropsDataProvider
        activeOrganizationId={activeOrganization?.id ?? null}
        account={
          status === "signed-in" && user !== null
            ? { client, userId: user.id, onUser: setUser }
            : null
        }
      >
        {children}
      </ZeropsDataProvider>
    </ZeropsSessionContext>
  );
}

export function useZeropsSession(): ZeropsSessionValue {
  const value = useContext(ZeropsSessionContext);
  if (!value) throw new Error("useZeropsSession must be used inside a ZeropsSessionProvider.");
  return value;
}
