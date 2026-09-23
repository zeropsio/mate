/**
 * The person's Gitea sessions for one account epoch: one machine per Gitea origin
 * (`giteaSessionMachine.ts`, DESIGN §4.6), and the interpreter that runs its effects.
 *
 * Mate drives Gitea **as the person** (guide 4.4): the token is theirs, so Gitea enforces the
 * rights the broker mirrored from Zerops. It comes from the org's broker on the same proof the
 * app makes at a Mate's door (D21): a throwaway Zerops token with no rights, minted as the person
 * and deleted after the one call (`authorization/giteaBroker.ts`), under the tab's Gitea mint
 * budget and the account-window wait (`doorThrowaway.ts`).
 *
 * ## One epoch, then nothing
 *
 * A token acts as the person who signed in, so it lives in this object's memory only — never a
 * storage key, a log line or a fixture — and {@link GiteaSessions.close} ends the object with the
 * account: every token is forgotten, timers stop, the broker requests in flight are aborted and
 * none is sent afterwards, and an answer that lands afterwards is dropped without a word. The next
 * account gets its own.
 *
 * ## Requests as the person
 *
 * {@link GiteaSessions.clientFor} hands out a client whose every request carries the token held
 * when it is sent. A 401 is reported with the token that request carried, so a late 401 for a
 * token already replaced never ends the new one; the request then waits up to
 * {@link REQUEST_QUEUE_MS} for the reacquired token and is sent once more.
 */
import { acquireGiteaPersonToken, MateCredentialError } from "../../authorization/giteaBroker.ts";
import type { ZeropsThrowawayPlatform } from "../../authorization/zeropsThrowaway.ts";
import { ZeropsApiError } from "../api.ts";
import type { Instant } from "../data/access/grant.ts";
import { createGiteaClient, GiteaApiError, type GiteaClient } from "../giteaClient.ts";
import {
  GITEA_SIGNED_OUT,
  giteaSessionAwaitsToken,
  giteaSessionReadable,
  giteaSessionToken,
  giteaSessionView,
  initialGiteaSession,
  transitionGiteaSession,
  type GiteaAcquireFailure,
  type GiteaSessionEvent,
  type GiteaSessionMachine,
  type GiteaSessionView,
} from "./giteaSessionMachine.ts";

/** One `POST /person/token` answers within this, from the moment it is sent. */
export const BROKER_DEADLINE_MS = 15_000;
/** One credential-less liveness request to the broker answers within this. */
export const LIVENESS_DEADLINE_MS = 8_000;
/** A request waits this long for a token being acquired, then gives up. */
export const REQUEST_QUEUE_MS = 10_000;

export const NOT_A_MEMBER = "You are not a member of this organization's Gitea.";
export const ZEROPS_REFUSED_SIGN_IN = "Zerops did not accept the sign-in. Sign in to Mate again.";

export interface GiteaSessionsPorts {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => Instant;
  /** Whether the tab is visible now; a refusal is asked again only while it is. */
  readonly visible: () => boolean;
  readonly random: () => number;
  /** Tells one throwaway apart from another minted in the same second. */
  readonly nonce: () => string;
  /** Arms a timer; the returned function disarms it. */
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
}

/** A surface that reads one Gitea as the person, and what signing in there takes. */
export interface GiteaSessionDemand {
  readonly giteaOrigin: string;
  readonly brokerOrigin: string;
  /** The org that owns the Gitea — where the throwaway is minted. */
  readonly clientId: string;
  readonly platform: ZeropsThrowawayPlatform;
}

export interface GiteaSessions {
  /** Wants that Gitea signed in until the returned release; the latest demand's inputs are used. */
  readonly demand: (input: GiteaSessionDemand) => () => void;
  /** What surfaces show; the same object until something they show changes. */
  readonly view: (giteaOrigin: string) => GiteaSessionView;
  /** Tells the listener whenever any session's view changes. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * A client that acts as the person there, or `null` while no token is held or on its way after
   * a 401 — also while what was read still stands without one.
   */
  readonly clientFor: (giteaOrigin: string) => GiteaClient | null;
  /** §6.4's visible wake: waits for Gitea or the broker are tried again now. */
  readonly wake: () => void;
  /** The tab is visible again after a short hide: what came due while it was hidden runs now. */
  readonly resume: () => void;
  readonly online: () => void;
  /** The person's "Try now". */
  readonly retry: (giteaOrigin: string) => void;
  /** The account closed: everything is forgotten and nothing runs again. */
  readonly close: () => void;
}

interface Entry {
  machine: GiteaSessionMachine;
  view: GiteaSessionView;
  demand: GiteaSessionDemand | null;
  leases: number;
  disarm: (() => void) | null;
  /** Requests waiting for a token, told on every transition. */
  readonly waiters: Set<() => void>;
}

function normalize(origin: string): string {
  return origin.trim().replace(/\/+$/u, "");
}

/** What a failed acquisition means for the session. */
export function classifyAcquireFailure(cause: unknown): GiteaAcquireFailure {
  if (cause instanceof MateCredentialError) {
    const status = cause.status;
    if (status === 502 || status === 503) return { kind: "setting-up" };
    if (status !== undefined && status >= 500) return { kind: "unreachable", source: "broker" };
    if (status === 403) return { kind: "refused", reason: NOT_A_MEMBER };
    if (status === 401) return { kind: "refused", reason: ZEROPS_REFUSED_SIGN_IN };
    return { kind: "refused", reason: cause.message };
  }
  if (cause instanceof ZeropsApiError) {
    if (cause.kind === "access-unverified") return { kind: "access-unverified" };
    if (cause.kind === "expired-session" || cause.status === 401) return { kind: "zerops-session" };
    if (cause.kind === "network" || cause.kind === "server" || cause.kind === "uncertain") {
      return { kind: "unreachable", source: "zerops" };
    }
    return { kind: "refused", reason: cause.message };
  }
  // fetch's own failure, or this module's deadline: the broker did not answer at all.
  if (cause instanceof TypeError) return { kind: "unreachable", source: "broker" };
  if (
    cause instanceof DOMException &&
    (cause.name === "AbortError" || cause.name === "TimeoutError")
  ) {
    return { kind: "unreachable", source: "broker" };
  }
  return {
    kind: "refused",
    reason: cause instanceof Error ? cause.message : "Gitea sign-in did not go through.",
  };
}

function withBearer(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  return { ...init, headers };
}

export function makeGiteaSessions(ports: GiteaSessionsPorts): GiteaSessions {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const closing = new AbortController();

  /**
   * A signal that ends at `ms` from now or when the sessions close, whichever is first — at once
   * if they already have.
   */
  const deadline = (ms: number): { readonly signal: AbortSignal; readonly done: () => void } => {
    const controller = new AbortController();
    const end = () => controller.abort(closing.signal.reason);
    if (closing.signal.aborted) end();
    else closing.signal.addEventListener("abort", end, { once: true });
    const disarm = ports.setTimer(ms, () =>
      controller.abort(new DOMException("The broker did not answer in time.", "TimeoutError")),
    );
    return {
      signal: controller.signal,
      done: () => {
        disarm();
        closing.signal.removeEventListener("abort", end);
      },
    };
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const dispatch = (origin: string, event: GiteaSessionEvent): void => {
    const entry = entries.get(origin);
    if (entry === undefined) return;
    const { state, effects } = transitionGiteaSession(entry.machine, event, {
      now: ports.now(),
      visible: ports.visible(),
      random: ports.random,
    });
    entry.machine = state;
    for (const effect of effects) {
      switch (effect.kind) {
        case "run":
          run(origin, effect.attempt, effect.op);
          break;
        case "schedule": {
          entry.disarm?.();
          const now = ports.now();
          const delayMs = Math.max(
            0,
            Math.min(effect.at.wall - now.wall, effect.at.mono - now.mono),
          );
          entry.disarm = ports.setTimer(delayMs, () => {
            entry.disarm = null;
            dispatch(origin, { type: "TICK" });
          });
          break;
        }
        case "cancel":
          entry.disarm?.();
          entry.disarm = null;
          break;
      }
    }
    for (const waiter of entry.waiters) waiter();
    const view = giteaSessionView(state);
    if (
      view.signedIn !== entry.view.signedIn ||
      view.login !== entry.view.login ||
      view.trouble !== entry.view.trouble
    ) {
      entry.view = view;
      notify();
    }
  };

  const run = (origin: string, attempt: number, op: "liveness" | "acquire"): void => {
    const demand = entries.get(origin)?.demand;
    if (demand === null || demand === undefined) return;
    if (op === "liveness") {
      // Any HTTP answer from the broker's origin means it is up; `no-cors` needs no CORS answer
      // from it and sends no credentials.
      const { signal, done } = deadline(LIVENESS_DEADLINE_MS);
      void ports
        .fetch(`${normalize(demand.brokerOrigin)}/`, {
          method: "GET",
          mode: "no-cors",
          credentials: "omit",
          cache: "no-store",
          signal,
        })
        .then(
          (response) => {
            void response.body?.cancel().catch(() => undefined);
            return true;
          },
          () => false,
        )
        .then((up) => {
          done();
          dispatch(origin, { type: "LIVENESS", attempt, up });
        });
      return;
    }
    void acquireGiteaPersonToken({
      brokerUrl: demand.brokerOrigin,
      giteaUrl: origin,
      clientId: demand.clientId,
      nonce: ports.nonce(),
      platform: demand.platform,
      // The deadline starts when the broker call is sent, after the mint's own waits.
      fetch: async (input, init) => {
        const { signal, done } = deadline(BROKER_DEADLINE_MS);
        try {
          // A throwaway minted after the account closed is never shown to the broker.
          signal.throwIfAborted();
          return await ports.fetch(input, { ...init, signal });
        } finally {
          done();
        }
      },
    }).then(
      (answer) =>
        dispatch(origin, {
          type: "ACQUIRED",
          attempt,
          token: answer.token,
          login: answer.login,
          expiresInMs: answer.expiresInMs,
        }),
      (cause: unknown) =>
        dispatch(origin, {
          type: "ACQUIRE_FAILED",
          attempt,
          failure: classifyAcquireFailure(cause),
        }),
    );
  };

  /** The token to send now, waiting up to {@link REQUEST_QUEUE_MS} for one being acquired. */
  const tokenFor = (origin: string): Promise<string | undefined> => {
    const entry = entries.get(origin);
    if (entry === undefined) return Promise.resolve(undefined);
    const held = giteaSessionToken(entry.machine);
    if (held !== undefined || !giteaSessionAwaitsToken(entry.machine)) {
      return Promise.resolve(held);
    }
    return new Promise((resolve) => {
      const finish = (token: string | undefined) => {
        entry.waiters.delete(check);
        disarm();
        resolve(token);
      };
      const check = () => {
        if (!entries.has(origin)) return finish(undefined);
        const token = giteaSessionToken(entry.machine);
        if (token !== undefined || !giteaSessionAwaitsToken(entry.machine)) finish(token);
      };
      const disarm = ports.setTimer(REQUEST_QUEUE_MS, () => finish(undefined));
      entry.waiters.add(check);
    });
  };

  const fetchAsPerson =
    (origin: string): typeof globalThis.fetch =>
    async (input, init) => {
      const sent = await tokenFor(origin);
      if (sent === undefined) {
        throw new GiteaApiError("You are not signed in to Gitea.", 401);
      }
      const response = await ports.fetch(input, withBearer(init, sent));
      if (response.status !== 401) return response;
      dispatch(origin, { type: "UNAUTHORIZED", token: sent });
      const next = await tokenFor(origin);
      if (next === undefined || next === sent) return response;
      void response.body?.cancel().catch(() => undefined);
      return ports.fetch(input, withBearer(init, next));
    };

  const entryFor = (origin: string): Entry => {
    const existing = entries.get(origin);
    if (existing !== undefined) return existing;
    const entry: Entry = {
      machine: initialGiteaSession,
      view: GITEA_SIGNED_OUT,
      demand: null,
      leases: 0,
      disarm: null,
      waiters: new Set(),
    };
    entries.set(origin, entry);
    return entry;
  };

  const toEvery = (event: GiteaSessionEvent) => {
    for (const origin of entries.keys()) dispatch(origin, event);
  };

  return {
    demand: (input) => {
      if (closing.signal.aborted) return () => undefined;
      const origin = normalize(input.giteaOrigin);
      const entry = entryFor(origin);
      entry.demand = input;
      entry.leases += 1;
      if (entry.leases === 1) dispatch(origin, { type: "DEMAND", demanded: true });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.leases -= 1;
        if (entry.leases === 0) dispatch(origin, { type: "DEMAND", demanded: false });
      };
    },
    view: (giteaOrigin) => entries.get(normalize(giteaOrigin))?.view ?? GITEA_SIGNED_OUT,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clientFor: (giteaOrigin) => {
      const origin = normalize(giteaOrigin);
      const entry = entries.get(origin);
      if (entry === undefined || !giteaSessionReadable(entry.machine)) return null;
      return createGiteaClient({
        origin,
        // Replaced per request by the token `fetchAsPerson` waited for.
        token: () => giteaSessionToken(entry.machine) ?? "",
        fetch: fetchAsPerson(origin),
      });
    },
    wake: () => toEvery({ type: "WAKE" }),
    resume: () => toEvery({ type: "TICK" }),
    online: () => toEvery({ type: "ONLINE" }),
    retry: (giteaOrigin) => dispatch(normalize(giteaOrigin), { type: "USER_RETRY" }),
    close: () => {
      if (closing.signal.aborted) return;
      // Each machine forgets its token, disarms its timer and releases its waiting requests.
      toEvery({ type: "CLOSE" });
      entries.clear();
      closing.abort(new DOMException("The account closed.", "AbortError"));
    },
  };
}
