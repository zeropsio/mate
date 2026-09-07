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
  ZEROPS_SESSION_STORAGE_KEY,
  withRecipeStoreMock,
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
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { browserZeropsStorage } from "./storage";

export type ZeropsSessionStatus =
  | "loading"
  | "unavailable"
  | "signed-out"
  | "totp-required"
  | "signed-in";
export type ZeropsOrganizationStatus = "idle" | "loading" | "needs-selection" | "selected";

export interface ZeropsSessionValue {
  readonly client: ZeropsApiClient;
  readonly status: ZeropsSessionStatus;
  readonly user: ZeropsUser | null;
  readonly organizations: ReadonlyArray<ZeropsOrganization>;
  /** Exact active clientUser scope, matching the Zerops GUI. */
  readonly activeOrganization: ZeropsOrganization | null;
  readonly organizationStatus: ZeropsOrganizationStatus;
  readonly updateVerifiedMemberships: (verified: ZeropsUser) => void;
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

import { ZeropsSessionContext } from "./sessionContext";
export { useZeropsSession, useZeropsSessionOptional } from "./sessionContext";

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

  const lifetimeGeneration = useRef(0);
  const acceptUser = useCallback((verified: ZeropsUser) => {
    openAccountLifetime(verified.id);
    setUser(verified);
    setStatus("signed-in");
  }, []);

  const client = useMemo(
    () =>
      new ZeropsApiClient({
        // The recipe endpoint mock passes all other traffic to the platform.
        fetch: withRecipeStoreMock(globalThis.fetch.bind(globalThis)),
        onSessionChange: (session: ZeropsSession | null) => {
          if (session === null) {
            // The client clears itself when a refresh fails mid-flight, so a
            // session that dies between renders cannot leave an
            // authorized-looking UI behind.
            lifetimeGeneration.current += 1;
            closeAccountLifetime();
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
    const generation = lifetimeGeneration.current;
    void (async () => {
      const session = await loadZeropsSession(storage);
      if (cancelled || generation !== lifetimeGeneration.current) return;
      if (!session) {
        setStatus("signed-out");
        return;
      }
      client.restoreSession(session);
      try {
        const restored = await client.fetchUser();
        if (cancelled || generation !== lifetimeGeneration.current) return;
        acceptUser(restored);
      } catch {
        // A stored session that no longer works reads as signed out; the
        // client has already cleared it if the API said so.
        if (cancelled || generation !== lifetimeGeneration.current) return;
        setStatus(client.session ? "unavailable" : "signed-out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [acceptUser, client, storage]);

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

  // Identity is shared across tabs; organization and navigation are not.
  // A full renderer reload also drops stale route loaders and module stores.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ZEROPS_SESSION_STORAGE_KEY && event.key !== null) return;
      if (event.oldValue === event.newValue && event.key !== null) return;
      lifetimeGeneration.current += 1;
      closeAccountLifetime();
      setUser(null);
      setStatus("loading");
      window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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

  const updateVerifiedMemberships = useCallback((verified: ZeropsUser) => {
    setUser((previous) => {
      if (!previous || previous.id !== verified.id) return previous;
      return JSON.stringify(zeropsClientsFromUser(previous)) ===
        JSON.stringify(zeropsClientsFromUser(verified))
        ? previous
        : verified;
    });
  }, []);

  const value = useMemo<ZeropsSessionValue>(
    () => ({
      client,
      status,
      user,
      organizations,
      activeOrganization,
      organizationStatus,
      selectOrganization,
      updateVerifiedMemberships,
      adoptHandover: async ({ token, clientId, zcpClaimed }) => {
        const generation = lifetimeGeneration.current;
        preferredClientIdRef.current = clientId;
        try {
          const session = await client.adoptPersonalToken(token);
          const adopted = await client.fetchUser();
          if (generation !== lifetimeGeneration.current)
            throw new Error("This sign-in was cancelled.");
          acceptUser(adopted);
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
        const generation = lifetimeGeneration.current;
        const response = await client.login(email, password);
        if (generation !== lifetimeGeneration.current)
          throw new Error("This sign-in was cancelled.");
        if (requiresZeropsTwoFactor(response.auth)) {
          setStatus("totp-required");
          return;
        }
        const verified = response.user ?? (await client.fetchUser());
        if (generation !== lifetimeGeneration.current)
          throw new Error("This sign-in was cancelled.");
        acceptUser(verified);
      },
      register: async (input) => {
        const generation = lifetimeGeneration.current;
        const response = await client.register(input);
        preferredClientIdRef.current = response.clientId ?? null;
        const verified = response.user ?? (await client.fetchUser());
        if (generation !== lifetimeGeneration.current)
          throw new Error("This sign-in was cancelled.");
        acceptUser(verified);
        setLastRegistration(response);
        return response;
      },
      verifyTotp: async (code) => {
        const generation = lifetimeGeneration.current;
        await client.verifyTotp(code);
        const verified = await client.fetchUser();
        if (generation !== lifetimeGeneration.current)
          throw new Error("This sign-in was cancelled.");
        acceptUser(verified);
      },
      signOut: async () => {
        setLastRegistration(null);
        await client.logout();
      },
      lastRegistration,
      clearLastRegistration: () => {
        setLastRegistration(null);
      },
    }),
    [
      acceptUser,
      activeOrganization,
      client,
      lastRegistration,
      organizationStatus,
      organizations,
      selectOrganization,
      updateVerifiedMemberships,
      status,
      storage,
      user,
    ],
  );

  return <ZeropsSessionContext value={value}>{children}</ZeropsSessionContext>;
}
