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
  ZeropsApiClient,
  clearZeropsSession,
  loadZeropsSelection,
  loadZeropsSession,
  parseZeropsSession,
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
import {
  ZEROPS_REFRESH_LOCK,
  ZEROPS_SESSION_OWNER_STORAGE_KEY,
  makeZeropsSessionDriver,
  parseZeropsSessionOwner,
  probeZeropsPrincipal,
  type ZeropsSessionDriver,
  type ZeropsSessionOwner,
  type ZeropsSessionState,
} from "@t3tools/client-runtime/zerops/account";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { rememberBootFrame } from "./bootFrame";
import { endEveryKeptSession } from "./keptSessions";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { randomUUID } from "../lib/utils";
import { browserZeropsStorage } from "./storage";
import { tokenWrites } from "./tokenWriteLock";

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
   * Adopts the bearer the sign-in hand-over delivered after the user signed in
   * on the Zerops app. It is proven before persistence, so an invalid token
   * cannot leave this client looking signed in.
   */
  readonly adoptHandover: (input: {
    /** The session access token (or, TRANSITION, personal token) handed over. */
    readonly token: string;
    /** True when the account just claimed a pool project, so the picker is skipped. */
    readonly zcpClaimed: boolean;
  }) => Promise<void>;
  readonly register: (input: ZeropsRegistrationInput) => Promise<ZeropsRegistrationResponse>;
  readonly verifyTotp: (code: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly verifyAgain?: () => void;
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

/** What a page reads of the session machine's state. */
function statusOf(state: ZeropsSessionState): ZeropsSessionStatus {
  switch (state.status) {
    case "booting":
    case "verifying":
      return "loading";
    case "signed-in":
      return state.token.status === "unavailable" ? "unavailable" : "signed-in";
    case "second-factor":
      return "totp-required";
    default:
      return state.status;
  }
}

/**
 * The owner record in the origin's shared `localStorage`, beside the session
 * key. Where storage is blocked, even reaching `localStorage` throws, and the
 * tab adopts by principal alone.
 */
function ownerRecordIn(browser: Window) {
  return {
    read: (): ZeropsSessionOwner | null => {
      try {
        return parseZeropsSessionOwner(
          browser.localStorage.getItem(ZEROPS_SESSION_OWNER_STORAGE_KEY),
        );
      } catch {
        return null;
      }
    },
    write: (owner: ZeropsSessionOwner) => {
      try {
        browser.localStorage.setItem(ZEROPS_SESSION_OWNER_STORAGE_KEY, JSON.stringify(owner));
      } catch {
        /* A storage policy can make this login memory-only. */
      }
    },
  };
}

/**
 * The tab's Zerops client and the session machine over it. The window, its
 * lock manager and its timers are this tab's, taken once: the client and the
 * machine keep them for the page's lifetime.
 */
function makeSession(storage: ZeropsStorageAdapter) {
  // The recipe endpoint mock passes all other traffic to the platform.
  const fetch = globalThis.fetch.bind(globalThis);
  const browser = window;
  // Web Locks exist only in a secure context; without them each tab renews alone.
  const locks: LockManager | undefined = browser.navigator.locks;
  let driver!: ZeropsSessionDriver;
  const client = new ZeropsApiClient({
    // The client's own token writes hold the same locks as every other writer in this browser.
    holdToken: tokenWrites,
    fetch,
    onSessionChange: (session: ZeropsSession | null) => {
      if (session === null) {
        // The client clears itself when a refresh fails mid-flight, so a
        // session that dies between renders cannot leave an
        // authorized-looking UI behind.
        driver.send({ type: "SESSION_ENDED" });
        return clearZeropsSession(storage);
      }
      return saveZeropsSession(storage, session);
    },
    renewSession: (stale, refresh) => driver.renew(stale, refresh),
  });
  driver = makeZeropsSessionDriver({
    loadStored: () => loadZeropsSession(storage),
    verify: async (session) => {
      client.restoreSession(session);
      try {
        return { kind: "user", user: await client.fetchUser() };
      } catch {
        // The client has already cleared a session the API refused.
        if (client.session !== null) return { kind: "unavailable" };
        // Nobody is signed in here any more: no Mate session kept under any login outlives it.
        endEveryKeptSession();
        return { kind: "unauthorized" };
      }
    },
    probe: (session) => probeZeropsPrincipal({ fetch, baseUrl: client.baseUrl }, session),
    adopt: (session) => client.adoptRenewedSession(session),
    forgetSession: () => client.forgetSession(),
    openAccount: (user) => openAccountLifetime(user.id),
    closeAccount: closeAccountLifetime,
    owner: ownerRecordIn(browser),
    withRefreshLock: (work) =>
      locks === undefined ? Promise.resolve().then(work) : locks.request(ZEROPS_REFRESH_LOCK, work),
    newGeneration: randomUUID,
  });
  return { client, driver };
}

export function ZeropsSessionProvider({
  children,
  storage = browserZeropsStorage,
}: {
  readonly children: ReactNode;
  readonly storage?: ZeropsStorageAdapter;
}) {
  const [lastRegistration, setLastRegistration] = useState<ZeropsRegistrationResponse | null>(null);
  const [selectedMembershipId, setSelectedMembershipId] = useState<string | null>(null);
  const [organizationStatus, setOrganizationStatus] = useState<ZeropsOrganizationStatus>("idle");
  const preferredClientIdRef = useRef<string | null>(null);

  const { client, driver } = useMemo(() => makeSession(storage), [storage]);
  const machine = useSyncExternalStore(driver.subscribe, driver.state);
  const status = statusOf(machine);
  const user = machine.status === "signed-in" ? machine.user : null;

  useEffect(() => driver.start(), [driver]);
  // The next load's first frame (`bootFrame.ts`): the app's once the session is signed in, the
  // sign-in's once it is signed out. Written as the state changes, ahead of any reload it causes.
  useEffect(() => {
    const remember = () => rememberBootFrame(statusOf(driver.state()));
    remember();
    return driver.subscribe(remember);
  }, [driver]);

  // Identity is shared across tabs; organization and navigation are not. A
  // session another tab writes is verified before this tab holds it, and a
  // sign-in or sign-out there reaches this tab in any state, without a reload.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === ZEROPS_SESSION_OWNER_STORAGE_KEY) {
        driver.send({ type: "OWNER_CHANGED", owner: parseZeropsSessionOwner(event.newValue) });
        return;
      }
      if (event.key !== ZEROPS_SESSION_STORAGE_KEY && event.key !== null) return;
      const next = event.key === null ? null : parseZeropsSession(event.newValue);
      driver.send({
        type: "STORAGE_CHANGED",
        next,
        held: next !== null && next.accessToken === client.session?.accessToken,
      });
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [client, driver]);

  const organizations = useMemo(() => (user ? zeropsClientsFromUser(user) : []), [user]);
  const activeOrganization = useMemo(
    () =>
      organizations.find((organization) => organization.membershipId === selectedMembershipId) ??
      null,
    [organizations, selectedMembershipId],
  );

  // The platform GUI persists the exact clientUser membership. Restore it per
  // Zerops user, while letting a registration's clientId override stale
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

  const updateVerifiedMemberships = useCallback(
    (verified: ZeropsUser) => {
      const current = driver.state();
      if (current.status !== "signed-in" || current.user.id !== verified.id) return;
      if (
        JSON.stringify(zeropsClientsFromUser(current.user)) ===
        JSON.stringify(zeropsClientsFromUser(verified))
      )
        return;
      driver.send({ type: "USER_UPDATED", user: verified });
    },
    [driver],
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
      updateVerifiedMemberships,
      verifyAgain: () => driver.send({ type: "VERIFY_AGAIN" }),
      adoptHandover: async ({ token, zcpClaimed }) => {
        const session = await client.adoptSession({ accessToken: token });
        const adopted = await client.fetchUser();
        driver.signedIn(adopted);
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
          driver.send({ type: "SECOND_FACTOR_REQUIRED" });
          return;
        }
        driver.signedIn(response.user ?? (await client.fetchUser()));
      },
      register: async (input) => {
        const response = await client.register(input);
        preferredClientIdRef.current = response.clientId ?? null;
        driver.signedIn(response.user ?? (await client.fetchUser()));
        setLastRegistration(response);
        return response;
      },
      verifyTotp: async (code) => {
        await client.verifyTotp(code);
        driver.signedIn(await client.fetchUser());
      },
      signOut: async () => {
        setLastRegistration(null);
        // Local only: the token is the Zerops app's own session, and logging
        // it out would sign the person out there too.
        await client.signOutLocally();
      },
      lastRegistration,
      clearLastRegistration: () => {
        setLastRegistration(null);
      },
    }),
    [
      activeOrganization,
      client,
      driver,
      lastRegistration,
      organizationStatus,
      organizations,
      selectOrganization,
      updateVerifiedMemberships,
      status,
      user,
    ],
  );

  return <ZeropsSessionContext value={value}>{children}</ZeropsSessionContext>;
}
