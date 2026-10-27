import { writeBrowserStorage } from "../lib/storage";
import { browserTransportFetch } from "@t3tools/client-runtime/data";
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
  type ZeropsApiClient,
  clearZeropsSession,
  loadZeropsSelection,
  loadZeropsSession,
  parseZeropsSession,
  resolveActiveZeropsOrganization,
  saveZeropsSelection,
  saveZeropsSession,
  zeropsClientsFromUser,
  type ZeropsOrganization,
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
  type ZeropsSessionDriver,
  type ZeropsSessionOwner,
  type ZeropsSessionState,
} from "@t3tools/client-runtime/zerops/account";
import {
  makeZeropsSessionCalls,
  probeZeropsPrincipal,
  unavailableVerdict,
} from "@t3tools/client-runtime/data";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { rememberBootFrame } from "./bootFrame";
// Its account hooks hold the account open and end its kept sessions: loaded before any account opens.
import { endKeptSessionsOf } from "./keptSessions";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { appBasePathHref } from "../basePath";
import { randomUUID } from "../lib/utils";
import { browserZeropsReauth } from "./reauth";
import { installDevHooks } from "./devHooks";
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
  /**
   * Adopts the bearer the sign-in hand-over delivered after the user signed in
   * on the Zerops app. It is proven before persistence, so an invalid token
   * cannot leave this client looking signed in.
   */
  readonly adoptHandover: (input: {
    /** The personal access token handed over. */
    readonly token: string;
    /** True when the account just claimed a pool project, so the picker is skipped. */
    readonly zcpClaimed: boolean;
  }) => Promise<void>;
  /**
   * Adopts the session a device login collected (`deviceLogin.ts`): proven before it is stored,
   * like a hand-over's.
   */
  readonly adoptDeviceLogin: (session: ZeropsSession) => Promise<void>;
  /**
   * The bearer a sudo device login is asked with: the held session's, renewed first when it
   * expires within fifteen minutes. A renewal during the approval would revoke the token the
   * request is bound to, so it happens before the request, never during.
   */
  readonly sudoBearer: () => Promise<string>;
  readonly signOut: () => Promise<void>;
  readonly verifyAgain?: () => void;
  /** A background retry of a failed check is running: the failure stays, saying it tries again. */
  readonly retrying?: boolean;
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

/**
 * A person's own sign-out ends on the sign-in at the app's root: the address they were on belongs
 * to the account they left. The router follows the history it hears about through `popstate`.
 */
function leaveForSignIn(): void {
  const root = appBasePathHref();
  const { pathname, search, hash } = window.location;
  if (pathname === root && search === "" && hash === "") return;
  window.history.replaceState(null, "", root);
  window.dispatchEvent(new Event("popstate"));
}

/** A sudo request asked of a session about to expire would die with it: it renews first. */
const SUDO_RENEWAL_MARGIN_MS = 15 * 60_000;

/** What a page reads of the session machine's state. */
function statusOf(state: ZeropsSessionState): ZeropsSessionStatus {
  switch (state.status) {
    case "booting":
      return "loading";
    case "verifying":
      // A background retry of a failed check keeps the failure shown; only a fresh check, or the
      // person's own Verify again, says it is checking.
      return state.retry === true ? "unavailable" : "loading";
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
        writeBrowserStorage(
          browser.localStorage,
          ZEROPS_SESSION_OWNER_STORAGE_KEY,
          JSON.stringify(owner),
        );
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
  const fetch = browserTransportFetch;
  const browser = window;
  // Web Locks exist only in a secure context; without them each tab renews alone.
  const locks: LockManager | undefined = browser.navigator.locks;
  let driver!: ZeropsSessionDriver;
  /** True while the person's own sign-out runs: its session end is no refusal. */
  let signingOut = false;
  const owner = ownerRecordIn(browser);
  const calls = makeZeropsSessionCalls({
    // The client's own token writes hold the same locks as every other writer in this browser.
    holdToken: tokenWrites,
    fetch,
    onSessionChange: (session: ZeropsSession | null) => {
      if (session === null) {
        // The client clears itself when a refresh fails mid-flight, so a
        // session that dies between renders cannot leave an
        // authorized-looking UI behind.
        driver.send({ type: "SESSION_ENDED", cause: signingOut ? "signed-out" : "refused" });
        return clearZeropsSession(storage);
      }
      return saveZeropsSession(storage, session);
    },
    renewSession: (stale, refresh) => driver.renew(stale, refresh),
  });
  const { client } = calls;
  driver = makeZeropsSessionDriver({
    loadStored: () => loadZeropsSession(storage),
    verify: async (session) => {
      client.restoreSession(session);
      try {
        return { kind: "user", user: await calls.readUser() };
      } catch (cause) {
        // The client has already cleared a session the API refused.
        if (client.session !== null) return unavailableVerdict(cause);
        // That login never opened its account here: the account's own kept sessions end with it.
        const refused = owner.read();
        if (refused !== null) endKeptSessionsOf(refused.userId);
        return { kind: "unauthorized" };
      }
    },
    probe: (session) => probeZeropsPrincipal({ fetch, baseUrl: client.baseUrl }, session),
    adopt: (session) => client.adoptRenewedSession(session),
    forgetSession: () => client.forgetSession(),
    openAccount: (user) => openAccountLifetime(user.id),
    closeAccount: closeAccountLifetime,
    owner,
    withRefreshLock: (work) =>
      locks === undefined ? Promise.resolve().then(work) : locks.request(ZEROPS_REFRESH_LOCK, work),
    nowMs: () => performance.now(),
    setTimer: (delayMs, fire) => {
      const timer = browser.setTimeout(fire, delayMs);
      return () => browser.clearTimeout(timer);
    },
    random: Math.random,
    awake: () => browser.document.visibilityState === "visible" && browser.navigator.onLine,
    newGeneration: randomUUID,
    reauth: browserZeropsReauth.ask,
    reauthSettled: browserZeropsReauth.settled,
  });
  /**
   * Forgets the session here at once — storage, the owner record, every tab — then ends it at the
   * platform in the background. A personal token from the hand-over cannot end itself, so it only
   * leaves here; it stays in the person's Settings › Token management until they revoke it there.
   */
  const signOutLocally = async () => {
    const held = client.session;
    signingOut = true;
    try {
      await client.signOutLocally();
    } finally {
      signingOut = false;
    }
    if (held !== null) void calls.revoke(held);
  };
  return { calls, client, driver, signOutLocally };
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

  const { calls, client, driver, signOutLocally } = useMemo(() => makeSession(storage), [storage]);
  const machine = useSyncExternalStore(driver.subscribe, driver.state);
  const status = statusOf(machine);
  const retrying = machine.status === "verifying" && machine.retry === true;
  const user = machine.status === "signed-in" ? machine.user : null;

  useEffect(() => driver.start(), [driver]);
  useEffect(
    () =>
      installDevHooks(async (session) => {
        driver.signedIn((await calls.adoptToken(session)).user);
      }),
    [calls, driver],
  );
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
    const document = window.document;
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
    // A hidden tab sends nothing: its visible wake checks once it is shown.
    const onOnline = () => {
      if (document.visibilityState === "visible") driver.send({ type: "WAKE", trigger: "online" });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") driver.send({ type: "WAKE", trigger: "visible" });
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
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
  // Zerops user. Multiple new memberships deliberately require a choice.
  useEffect(() => {
    if (!user) {
      setSelectedMembershipId(null);
      setOrganizationStatus("idle");
      return;
    }
    let cancelled = false;
    setOrganizationStatus("loading");
    void loadZeropsSelection(storage, user.id).then(async (selection) => {
      if (cancelled) return;
      const selected = resolveActiveZeropsOrganization(organizations, {
        preferredClientId: null,
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
      retrying,
      adoptHandover: async ({ token, zcpClaimed }) => {
        const { session, user: adopted } = await calls.adoptToken({ accessToken: token });
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
      sudoBearer: async () => {
        const bearer = await calls.freshBearer(SUDO_RENEWAL_MARGIN_MS, Date.now());
        if (bearer === null) throw new Error("Sign in to Zerops again.");
        return bearer;
      },
      adoptDeviceLogin: async (session) => {
        driver.signedIn((await calls.adoptToken(session)).user);
      },
      signOut: async () => {
        setLastRegistration(null);
        await signOutLocally();
        leaveForSignIn();
      },
      lastRegistration,
      clearLastRegistration: () => {
        setLastRegistration(null);
      },
    }),
    [
      activeOrganization,
      calls,
      client,
      driver,
      lastRegistration,
      organizationStatus,
      organizations,
      selectOrganization,
      signOutLocally,
      updateVerifiedMemberships,
      status,
      retrying,
      user,
    ],
  );

  return <ZeropsSessionContext value={value}>{children}</ZeropsSessionContext>;
}
