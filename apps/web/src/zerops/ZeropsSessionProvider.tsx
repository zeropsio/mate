/**
 * The signed-in Zerops account, available to every route.
 *
 * It sits outside the router because Zerops identity is independent of T3's
 * environment auth gate: `/zerops` and `/settings/zerops` are reachable
 * through more than one branch of that gate, and the session has to outlive
 * route transitions.
 *
 * The access token lives here and in `localStorage` — never on a mate server.
 */

import {
  ZEROPS_SELECTION_STORAGE_KEY,
  ZeropsApiClient,
  clearZeropsSession,
  loadZeropsSelection,
  loadZeropsSession,
  requiresZeropsTwoFactor,
  resolveActiveZeropsOrganization,
  saveZeropsSelection,
  saveZeropsSession,
  zeropsClientsFromUser,
  type ZeropsOrganization,
  type ZeropsRegistrationInput,
  type ZeropsRegistrationResponse,
  type ZeropsSession,
  type ZeropsStorageAdapter,
  type ZeropsUser,
} from "@t3tools/client-runtime/zerops";
import { forgetAllEnvironmentProjectRefs } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { browserZeropsStorage } from "./storage";

export type ZeropsSessionStatus = "loading" | "signed-out" | "totp-required" | "signed-in";
export type ZeropsOrganizationStatus = "idle" | "loading" | "needs-selection" | "selected";

export interface ZeropsSessionValue {
  readonly client: ZeropsApiClient;
  readonly status: ZeropsSessionStatus;
  readonly user: ZeropsUser | null;
  readonly organizations: ReadonlyArray<ZeropsOrganization>;
  /** Exact active clientUser scope, matching the Zerops GUI. */
  readonly activeOrganization: ZeropsOrganization | null;
  readonly organizationStatus: ZeropsOrganizationStatus;
  readonly selectOrganization: (membershipId: string) => Promise<void>;
  readonly signIn: (email: string, password: string) => Promise<void>;
  /**
   * Adopts a revocable personal token handed back by `app.zerops.io` after the
   * user signed in there. It is proven before persistence, so an invalid token
   * cannot leave this client looking signed in.
   */
  readonly adoptHandover: (input: {
    /** A personal access token minted for this client by app.zerops.io. */
    readonly token: string;
    /** Organization selected on app.zerops.io, when the hand-over named one. */
    readonly clientId: string | null;
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
  const [selectedMembershipId, setSelectedMembershipId] = useState<string | null>(null);
  const [organizationStatus, setOrganizationStatus] = useState<ZeropsOrganizationStatus>("idle");
  const preferredClientIdRef = useRef<string | null>(null);

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

  const organizations = useMemo(() => (user ? zeropsClientsFromUser(user) : []), [user]);
  const activeOrganization = useMemo(
    () =>
      organizations.find((organization) => organization.membershipId === selectedMembershipId) ??
      null,
    [organizations, selectedMembershipId],
  );

  // The platform GUI persists the exact clientUser membership. Restore it per
  // Zerops user, while letting an explicit hand-over clientId override stale
  // local state. Multiple new memberships deliberately require a choice.
  useEffect(() => {
    if (!user) {
      setSelectedMembershipId(null);
      setOrganizationStatus("idle");
      return;
    }
    let cancelled = false;
    setOrganizationStatus("loading");
    const preferredClientId = preferredClientIdRef.current;
    preferredClientIdRef.current = null;
    void loadZeropsSelection(storage, user.id).then(async (selection) => {
      if (cancelled) return;
      const selected = resolveActiveZeropsOrganization(organizations, {
        preferredClientId,
        storedClientUserId: selection.clientUserId,
        storedClientId: selection.clientId,
      });
      setSelectedMembershipId(selected?.membershipId ?? null);
      setOrganizationStatus(selected ? "selected" : "needs-selection");
      if (selected) {
        await saveZeropsSelection(storage, {
          userId: user.id,
          clientUserId: selected.membershipId,
          clientId: selected.id,
          projectId: selection.projectId,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [organizations, storage, user]);

  // Keep tabs on one account scope. Unlike the legacy GUI we can update the
  // inactive tab in place because all scoped queries are cancellable React
  // effects, so a hard invalidation dialog is unnecessary.
  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ZEROPS_SELECTION_STORAGE_KEY) return;
      void loadZeropsSelection(storage, user.id).then((selection) => {
        const selected = resolveActiveZeropsOrganization(organizations, {
          preferredClientId: null,
          storedClientUserId: selection.clientUserId,
          storedClientId: selection.clientId,
        });
        setSelectedMembershipId(selected?.membershipId ?? null);
        setOrganizationStatus(selected ? "selected" : "needs-selection");
      });
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [organizations, storage, user]);

  const selectOrganization = useCallback(
    async (membershipId: string) => {
      if (!user) return;
      const selected = organizations.find(
        (organization) => organization.membershipId === membershipId,
      );
      if (!selected) return;
      setSelectedMembershipId(selected.membershipId);
      setOrganizationStatus("selected");
      await saveZeropsSelection(storage, {
        userId: user.id,
        clientUserId: selected.membershipId,
        clientId: selected.id,
        projectId: null,
      });
    },
    [organizations, storage, user],
  );

  const value = useMemo<ZeropsSessionValue>(
    () => ({
      client,
      status,
      user,
      organizations,
      activeOrganization,
      organizationStatus,
      selectOrganization,
      adoptHandover: async ({ token, clientId, zcpClaimed }) => {
        preferredClientIdRef.current = clientId;
        try {
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
            setLastRegistration({
              auth: session,
              user: adopted,
              ...(clientId ? { clientId } : {}),
              zcpClaimed: true,
            });
          }
        } catch (cause) {
          preferredClientIdRef.current = null;
          throw cause;
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
        preferredClientIdRef.current = response.clientId ?? null;
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
        await forgetAllEnvironmentProjectRefs(storage);
        setLastRegistration(null);
      },
      lastRegistration,
      clearLastRegistration: () => {
        setLastRegistration(null);
      },
    }),
    [
      activeOrganization,
      client,
      lastRegistration,
      organizationStatus,
      organizations,
      selectOrganization,
      status,
      storage,
      user,
    ],
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

/**
 * `useZeropsSession`, without the throw. For a component that renders in
 * contexts outside `AppRoot`'s provider tree (a render test in isolation) and
 * has to treat "no session available" as its own `idle`/off state rather than
 * crash — e.g. the operation card's `useOperationObservation`.
 */
export function useZeropsSessionOptional(): ZeropsSessionValue | null {
  return useContext(ZeropsSessionContext);
}
