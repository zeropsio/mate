/**
 * The Zerops account session (DESIGN §4.1): one pure machine,
 * `transitionZeropsSession(state, event, ctx) → { state, effects }`, and the
 * driver that runs its effects over a tab's ports.
 *
 * - A tab opens the account only on a principal the platform named
 *   (`user/info`), never on one read from storage.
 * - The owner record `{userId, loginGeneration}` sits beside the session key.
 *   A tab's own sign-in writes it with a new generation; a tab that verified a
 *   stored session creates it once, under the refresh lock, only while it is
 *   missing. A refresh never changes it.
 * - A session another tab stores is adopted only after a probe with that
 *   session names this tab's principal and the owner record still carries
 *   this tab's generation (or none, for a session an older build stored).
 *   Anything else closes the account before the new session renders a frame.
 * - Every wait has an exit: an unreachable platform leaves `unavailable` and
 *   `adopting` on the retry ladder, on `online` and on a visible wake.
 *
 * UI-free and platform-free: storage, locks, timers and the network are ports.
 */
import {
  ZeropsApiClient,
  ZeropsApiError,
  type FetchImplementation,
  type ZeropsUser,
} from "../api.ts";
import {
  INITIAL_BACKOFF,
  backoffOn,
  scheduleRetry,
  type Backoff,
  type RetryTrigger,
} from "../knowledge/retryPolicy.ts";
import type { ZeropsSession } from "../session.ts";

export const ZEROPS_SESSION_OWNER_STORAGE_KEY = "zerops-mate.zerops-session-owner.v1";

/** The Web Lock every renewal and every owner-record creation runs under (DESIGN §6.7). */
export const ZEROPS_REFRESH_LOCK = "mate:zerops-refresh";

/** The login a stored session belongs to: the cross-tab epoch. */
export interface ZeropsSessionOwner {
  readonly userId: string;
  readonly loginGeneration: string;
}

export function parseZeropsSessionOwner(raw: string | null): ZeropsSessionOwner | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { userId, loginGeneration } = parsed as Partial<ZeropsSessionOwner>;
    if (typeof userId !== "string" || !userId) return null;
    if (typeof loginGeneration !== "string" || !loginGeneration) return null;
    return { userId, loginGeneration };
  } catch {
    return null;
  }
}

/** What `user/info` said about a session. */
export type ZeropsPrincipalVerdict =
  | { readonly kind: "user"; readonly user: ZeropsUser }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable" };

/** The held token of an open account: current, or a stored one being verified. */
export type ZeropsTokenState =
  | { readonly status: "current" }
  | {
      readonly status: "adopting";
      readonly next: ZeropsSession;
      readonly backoff: Backoff;
      /** When the next probe is due after one failed; `null` while one is in flight. */
      readonly retryAt: number | null;
    };

export type ZeropsSessionState =
  | { readonly status: "booting" }
  | { readonly status: "signed-out" }
  /** This tab's own sign-in waits for its second factor. */
  | { readonly status: "second-factor" }
  | {
      readonly status: "verifying";
      readonly session: ZeropsSession;
      readonly backoff: Backoff;
    }
  | {
      readonly status: "unavailable";
      readonly session: ZeropsSession;
      readonly backoff: Backoff;
      readonly retryAt: number;
    }
  | {
      readonly status: "signed-in";
      readonly user: ZeropsUser;
      /** `null` until the owner record gives this tab one. */
      readonly generation: string | null;
      readonly token: ZeropsTokenState;
    };

/** What sends a waiting session back to work. */
export type ZeropsSessionWake = "tick" | "online" | "visible";

export type ZeropsSessionEvent =
  | { readonly type: "LOADED"; readonly session: ZeropsSession | null }
  | {
      readonly type: "VERIFIED";
      readonly session: ZeropsSession;
      readonly verdict: ZeropsPrincipalVerdict;
    }
  | {
      readonly type: "PROBED";
      readonly session: ZeropsSession;
      readonly verdict: ZeropsPrincipalVerdict;
      /** The owner record as it stood when the probe answered. */
      readonly owner: ZeropsSessionOwner | null;
    }
  | { readonly type: "OWNER_CLAIMED"; readonly owner: ZeropsSessionOwner }
  | { readonly type: "OWNER_CHANGED"; readonly owner: ZeropsSessionOwner | null }
  /** Another tab wrote the session key; `held` when this tab's client already holds `next`. */
  | {
      readonly type: "STORAGE_CHANGED";
      readonly next: ZeropsSession | null;
      readonly held: boolean;
    }
  /** This tab's own sign-in, 2FA, hand-over or registration completed. */
  | { readonly type: "SIGNED_IN"; readonly user: ZeropsUser; readonly generation: string }
  | { readonly type: "SECOND_FACTOR_REQUIRED" }
  /** A fresh read of the same person, with its memberships. */
  | { readonly type: "USER_UPDATED"; readonly user: ZeropsUser }
  /** This tab's client dropped its session: sign-out, or a refresh that failed. */
  | { readonly type: "SESSION_ENDED" }
  | { readonly type: "WAKE"; readonly trigger: ZeropsSessionWake };

export type ZeropsSessionEffect =
  /** Hold `session` in the client and read `user/info` with it, refreshing on a 401. */
  | { readonly kind: "verify"; readonly session: ZeropsSession }
  /** One `user/info` with `session`, nothing else; its answer is never rendered. */
  | { readonly kind: "probe"; readonly session: ZeropsSession }
  /** Hold `session` in place of the current token, for the same login. */
  | { readonly kind: "adopt"; readonly session: ZeropsSession }
  /** The client drops the session another tab removed. */
  | { readonly kind: "forget-session" }
  | { readonly kind: "open-account"; readonly user: ZeropsUser }
  | { readonly kind: "close-account" }
  /** Under the refresh lock: take the record for `userId`, or create it when missing. */
  | { readonly kind: "claim-owner"; readonly userId: string }
  | { readonly kind: "write-owner"; readonly owner: ZeropsSessionOwner }
  | { readonly kind: "schedule"; readonly at: number }
  | { readonly kind: "cancel-schedule" };

export interface ZeropsSessionContext {
  readonly nowMs: number;
  readonly random: () => number;
}

export interface ZeropsSessionTransition {
  readonly state: ZeropsSessionState;
  readonly effects: ReadonlyArray<ZeropsSessionEffect>;
}

const RETRY_TRIGGER: Record<ZeropsSessionWake, RetryTrigger> = {
  tick: "retry-at-reached",
  online: "online",
  visible: "visible-wake",
};

const stay = (state: ZeropsSessionState): ZeropsSessionTransition => ({ state, effects: [] });

/** A retry timer is armed while the state waits for one. */
function waitsForRetry(state: ZeropsSessionState): boolean {
  return (
    state.status === "unavailable" ||
    (state.status === "signed-in" &&
      state.token.status === "adopting" &&
      state.token.retryAt !== null)
  );
}

/** The effects that leave `state`: its retry timer and its open account. */
function leaving(
  state: ZeropsSessionState,
  options: { readonly closeAccount: boolean },
): ZeropsSessionEffect[] {
  return [
    ...(waitsForRetry(state) ? [{ kind: "cancel-schedule" } as const] : []),
    ...(options.closeAccount && state.status === "signed-in"
      ? [{ kind: "close-account" } as const]
      : []),
  ];
}

function verify(
  from: ZeropsSessionState,
  session: ZeropsSession,
  backoff: Backoff = INITIAL_BACKOFF,
): ZeropsSessionTransition {
  return {
    state: { status: "verifying", session, backoff },
    effects: [...leaving(from, { closeAccount: true }), { kind: "verify", session }],
  };
}

function signedIn(user: ZeropsUser, generation: string | null): ZeropsSessionState {
  return { status: "signed-in", user, generation, token: { status: "current" } };
}

/** A retry that is due now, or the timer that waits for it. */
function onWake(
  retryAt: number,
  trigger: ZeropsSessionWake,
  ctx: ZeropsSessionContext,
): "now" | "later" {
  return trigger !== "tick" || ctx.nowMs >= retryAt ? "now" : "later";
}

function onStorageChanged(
  state: ZeropsSessionState,
  next: ZeropsSession | null,
  held: boolean,
): ZeropsSessionTransition {
  if (next === null) {
    switch (state.status) {
      case "booting":
        return { state: { status: "signed-out" }, effects: [] };
      case "verifying":
      case "unavailable":
      case "signed-in":
        return {
          state: { status: "signed-out" },
          effects: [...leaving(state, { closeAccount: true }), { kind: "forget-session" }],
        };
      default:
        return stay(state);
    }
  }
  switch (state.status) {
    case "booting":
    case "signed-out":
    case "second-factor":
    case "unavailable":
      return verify(state, next);
    case "verifying":
      return held || next.accessToken === state.session.accessToken
        ? stay(state)
        : verify(state, next);
    case "signed-in":
      if (held) return stay(state);
      return {
        state: {
          ...state,
          token: { status: "adopting", next, backoff: INITIAL_BACKOFF, retryAt: null },
        },
        effects: [...leaving(state, { closeAccount: false }), { kind: "probe", session: next }],
      };
  }
}

/**
 * A probed session belongs to the open account's login: the probe named this
 * tab's principal, and the owner record carries this tab's generation (or
 * none, for a session an older build stored).
 */
function isSameLogin(
  state: Extract<ZeropsSessionState, { status: "signed-in" }>,
  verdict: ZeropsPrincipalVerdict,
  owner: ZeropsSessionOwner | null,
): boolean {
  return (
    verdict.kind === "user" &&
    verdict.user.id === state.user.id &&
    (owner === null ||
      (owner.userId === state.user.id &&
        (state.generation === null || owner.loginGeneration === state.generation)))
  );
}

function onProbed(
  state: Extract<ZeropsSessionState, { status: "signed-in" }>,
  token: Extract<ZeropsTokenState, { status: "adopting" }>,
  verdict: ZeropsPrincipalVerdict,
  owner: ZeropsSessionOwner | null,
  ctx: ZeropsSessionContext,
): ZeropsSessionTransition {
  const cancel = leaving(state, { closeAccount: false });
  if (verdict.kind === "unavailable") {
    const { retryAtMs, backoff } = scheduleRetry(token.backoff, ctx.nowMs, ctx.random);
    return {
      state: { ...state, token: { ...token, backoff, retryAt: retryAtMs } },
      effects: [...cancel, { kind: "schedule", at: retryAtMs }],
    };
  }
  if (!isSameLogin(state, verdict, owner)) return verify(state, token.next);
  return {
    state: signedIn(state.user, state.generation ?? owner?.loginGeneration ?? null),
    effects: [...cancel, { kind: "adopt", session: token.next }],
  };
}

function onOwnSignIn(
  state: ZeropsSessionState,
  user: ZeropsUser,
  generation: string,
): ZeropsSessionTransition {
  const sameAccount = state.status === "signed-in" && state.user.id === user.id;
  const owner = { userId: user.id, loginGeneration: generation };
  return {
    state: signedIn(user, generation),
    effects: [
      ...leaving(state, { closeAccount: !sameAccount }),
      ...(sameAccount ? [] : [{ kind: "open-account", user } as const]),
      { kind: "write-owner", owner },
    ],
  };
}

function onWakeEvent(
  state: ZeropsSessionState,
  trigger: ZeropsSessionWake,
  ctx: ZeropsSessionContext,
): ZeropsSessionTransition {
  if (state.status === "unavailable") {
    if (onWake(state.retryAt, trigger, ctx) === "later")
      return { state, effects: [{ kind: "schedule", at: state.retryAt }] };
    const backoff = backoffOn(state.backoff, RETRY_TRIGGER[trigger]);
    return {
      state: { status: "verifying", session: state.session, backoff },
      effects: [
        ...(trigger === "tick" ? [] : [{ kind: "cancel-schedule" } as const]),
        { kind: "verify", session: state.session },
      ],
    };
  }
  if (
    state.status === "signed-in" &&
    state.token.status === "adopting" &&
    state.token.retryAt !== null
  ) {
    const { token } = state;
    if (onWake(token.retryAt!, trigger, ctx) === "later")
      return { state, effects: [{ kind: "schedule", at: token.retryAt! }] };
    return {
      state: {
        ...state,
        token: {
          ...token,
          backoff: backoffOn(token.backoff, RETRY_TRIGGER[trigger]),
          retryAt: null,
        },
      },
      effects: [
        ...(trigger === "tick" ? [] : [{ kind: "cancel-schedule" } as const]),
        { kind: "probe", session: token.next },
      ],
    };
  }
  return stay(state);
}

export function transitionZeropsSession(
  state: ZeropsSessionState,
  event: ZeropsSessionEvent,
  ctx: ZeropsSessionContext,
): ZeropsSessionTransition {
  switch (event.type) {
    case "LOADED":
      if (state.status !== "booting") return stay(state);
      return event.session === null
        ? { state: { status: "signed-out" }, effects: [] }
        : verify(state, event.session);
    case "VERIFIED": {
      if (state.status !== "verifying" || state.session.accessToken !== event.session.accessToken)
        return stay(state);
      const { verdict } = event;
      if (verdict.kind === "user")
        return {
          state: signedIn(verdict.user, null),
          effects: [
            { kind: "open-account", user: verdict.user },
            { kind: "claim-owner", userId: verdict.user.id },
          ],
        };
      if (verdict.kind === "unauthorized") return { state: { status: "signed-out" }, effects: [] };
      const { retryAtMs, backoff } = scheduleRetry(state.backoff, ctx.nowMs, ctx.random);
      return {
        state: { status: "unavailable", session: state.session, backoff, retryAt: retryAtMs },
        effects: [{ kind: "schedule", at: retryAtMs }],
      };
    }
    case "PROBED":
      if (
        state.status !== "signed-in" ||
        state.token.status !== "adopting" ||
        state.token.next.accessToken !== event.session.accessToken
      )
        return stay(state);
      return onProbed(state, state.token, event.verdict, event.owner, ctx);
    case "OWNER_CLAIMED":
    case "OWNER_CHANGED": {
      // Only a tab that holds no generation yet takes one from the record.
      const { owner } = event;
      if (
        state.status !== "signed-in" ||
        state.generation !== null ||
        owner === null ||
        owner.userId !== state.user.id
      )
        return stay(state);
      return stay({ ...state, generation: owner.loginGeneration });
    }
    case "STORAGE_CHANGED":
      return onStorageChanged(state, event.next, event.held);
    case "SIGNED_IN":
      return onOwnSignIn(state, event.user, event.generation);
    case "SECOND_FACTOR_REQUIRED":
      return {
        state: { status: "second-factor" },
        effects: leaving(state, { closeAccount: true }),
      };
    case "USER_UPDATED":
      if (state.status !== "signed-in" || state.user.id !== event.user.id) return stay(state);
      return stay({ ...state, user: event.user });
    case "SESSION_ENDED":
      if (state.status === "signed-out") return stay(state);
      return {
        state: { status: "signed-out" },
        effects: leaving(state, { closeAccount: true }),
      };
    case "WAKE":
      return onWakeEvent(state, event.trigger, ctx);
  }
}

/** What the driver needs from a tab. */
export interface ZeropsSessionPorts {
  readonly loadStored: () => Promise<ZeropsSession | null>;
  /** The `verify` effect; it answers a verdict and never rejects. */
  readonly verify: (session: ZeropsSession) => Promise<ZeropsPrincipalVerdict>;
  /** The `probe` effect; it answers a verdict and never rejects. */
  readonly probe: (session: ZeropsSession) => Promise<ZeropsPrincipalVerdict>;
  readonly adopt: (session: ZeropsSession) => void;
  readonly forgetSession: () => void;
  readonly openAccount: (user: ZeropsUser) => void;
  readonly closeAccount: () => void;
  readonly owner: {
    readonly read: () => ZeropsSessionOwner | null;
    readonly write: (owner: ZeropsSessionOwner) => void;
  };
  /** Runs `work` holding `ZEROPS_REFRESH_LOCK`, shared by every tab of the origin. */
  readonly withRefreshLock: <T>(work: () => Promise<T>) => Promise<T>;
  readonly nowMs: () => number;
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
  readonly random: () => number;
  readonly newGeneration: () => string;
}

export interface ZeropsSessionDriver {
  readonly state: () => ZeropsSessionState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Loads the stored session and verifies it. The returned stop drops every later answer. */
  readonly start: () => () => void;
  readonly send: (event: ZeropsSessionEvent) => void;
  /** This tab's own sign-in completed: a new login generation. */
  readonly signedIn: (user: ZeropsUser) => void;
  /**
   * The client's `renewSession` hook. Under the refresh lock it re-reads the
   * stored session: while it still holds `stale`, or storage is blocked,
   * `refresh` runs; a session another tab renewed for this tab's login, as a
   * probe of it proves, is handed back instead; anything else is refused, and
   * the storage event it came with closes or re-verifies.
   */
  readonly renew: (
    stale: ZeropsSession,
    refresh: () => Promise<ZeropsSession>,
  ) => Promise<ZeropsSession>;
}

export function makeZeropsSessionDriver(ports: ZeropsSessionPorts): ZeropsSessionDriver {
  const listeners = new Set<() => void>();
  let state: ZeropsSessionState = { status: "booting" };
  let run = 0;
  let live = false;
  let draining = false;
  const queue: ZeropsSessionEvent[] = [];
  let cancelTimer: (() => void) | null = null;

  const clearTimer = () => {
    cancelTimer?.();
    cancelTimer = null;
  };

  /** Delivers an async answer only while the run that asked for it is live. */
  const answer = (asked: number, event: ZeropsSessionEvent) => {
    if (asked === run) send(event);
  };

  const perform = (effect: ZeropsSessionEffect) => {
    const asked = run;
    switch (effect.kind) {
      case "verify":
        void ports
          .verify(effect.session)
          .then((verdict) => answer(asked, { type: "VERIFIED", session: effect.session, verdict }));
        return;
      case "probe":
        void ports.probe(effect.session).then((verdict) =>
          answer(asked, {
            type: "PROBED",
            session: effect.session,
            verdict,
            owner: ports.owner.read(),
          }),
        );
        return;
      case "adopt":
        ports.adopt(effect.session);
        return;
      case "forget-session":
        ports.forgetSession();
        return;
      case "open-account":
        ports.openAccount(effect.user);
        return;
      case "close-account":
        ports.closeAccount();
        return;
      case "claim-owner":
        void ports
          .withRefreshLock(async () => {
            const owner = ports.owner.read();
            if (owner !== null && owner.userId === effect.userId) return owner;
            const claimed = { userId: effect.userId, loginGeneration: ports.newGeneration() };
            ports.owner.write(claimed);
            return claimed;
          })
          .then(
            (owner) => answer(asked, { type: "OWNER_CLAIMED", owner }),
            // Without a record this tab adopts by principal alone, as for a legacy session.
            () => undefined,
          );
        return;
      case "write-owner":
        ports.owner.write(effect.owner);
        return;
      case "schedule":
        clearTimer();
        cancelTimer = ports.setTimer(Math.max(0, effect.at - ports.nowMs()), () => {
          cancelTimer = null;
          send({ type: "WAKE", trigger: "tick" });
        });
        return;
      case "cancel-schedule":
        clearTimer();
        return;
    }
  };

  // Events are serialized: one an effect raises runs after the one that raised it.
  function send(event: ZeropsSessionEvent): void {
    if (!live) return;
    queue.push(event);
    if (draining) return;
    draining = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const result = transitionZeropsSession(state, next, {
          nowMs: ports.nowMs(),
          random: ports.random,
        });
        const changed = result.state !== state;
        state = result.state;
        for (const effect of result.effects) perform(effect);
        if (changed) for (const listener of listeners) listener();
      }
    } finally {
      draining = false;
    }
  }

  const refusal = () =>
    new ZeropsApiError("Your Zerops session changed in another tab.", "expired-session", 401);

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      const started = ++run;
      live = true;
      void ports.loadStored().then(
        (session) => answer(started, { type: "LOADED", session }),
        () => answer(started, { type: "LOADED", session: null }),
      );
      return () => {
        if (started !== run) return;
        run += 1;
        live = false;
        queue.length = 0;
        clearTimer();
        state = { status: "booting" };
      };
    },
    send,
    signedIn: (user) => send({ type: "SIGNED_IN", user, generation: ports.newGeneration() }),
    renew: (stale, refresh) =>
      ports.withRefreshLock(async () => {
        const stored = await ports.loadStored();
        if (stored === null) {
          // Storage that holds no owner record either is blocked: the login is memory-only.
          if (state.status === "signed-in" && ports.owner.read() === null) return refresh();
          throw refusal();
        }
        if (stored.accessToken === stale.accessToken) return refresh();
        // Not signed in yet: the verification this renewal serves names the principal.
        if (state.status !== "signed-in") return stored;
        // A sign-in stores its session before it writes the owner record, so
        // the record alone never vouches for a session: the probe names whose it is.
        const verdict = await ports.probe(stored);
        if (verdict.kind === "unavailable")
          throw new ZeropsApiError("Network error contacting Zerops.", "network");
        const current = state;
        if (current.status === "signed-in" && isSameLogin(current, verdict, ports.owner.read()))
          return stored;
        throw refusal();
      }),
  };
}

/**
 * The `probe` port over the platform: one `user/info` with the session's
 * access token alone, so a 401 never spends the refresh token another tab
 * shares, and never touches the tab's own client.
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
      : { kind: "unavailable" };
  }
}
