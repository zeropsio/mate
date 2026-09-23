/**
 * Capabilities (DESIGN §4.3): whether a class of command may run now — `allowed`, or `no` with a
 * typed reason and whether waiting may change it. A capability is derived, never stored: it is
 * read from the access grant at the instant it is asked, on both clocks, so a deadline a frozen
 * or throttled tab slept through is honoured the moment anything asks.
 *
 * Losing a capability disables verbs. It never unmounts anything and never cancels other work.
 */
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { DEFAULT_ZEROPS_GRANT_POLICY } from "../policy.ts";
import type { ZeropsProjectId } from "../types.ts";
import type { ZeropsAccessGrant } from "./grantDriver.ts";
import {
  grantPlatformRead,
  grantPlatformWrite,
  type GrantCapability,
  type GrantContext,
  type GrantMachine,
} from "./grant.ts";

/** What a command asks of the grant. */
export type CapabilityAsk =
  | { readonly kind: "platformWrite"; readonly project: ZeropsProjectId }
  | { readonly kind: "platformRead"; readonly project: ZeropsProjectId }
  | { readonly kind: "identityMint" };

/**
 * Door and Gitea throwaway mints (spec-mate C6, D6(b)): once the epoch's first grant was admitted,
 * whatever the window. A throwaway carries no rights, so no organization or project role is
 * checked — the door and the broker decide roles. A mint that grants a project is a
 * `platformWrite` of that project instead.
 */
export const identityMint = (machine: GrantMachine): GrantCapability => {
  switch (machine.phase.phase) {
    case "closed":
      return { allowed: false, reason: "epoch-closed", waitable: false };
    case "unverified":
    case "verifying":
    case "unverified-failed":
      return { allowed: false, reason: "access-unverified", waitable: true };
    case "granted":
    case "lapsed":
      return { allowed: true };
  }
};

const answer = (ask: CapabilityAsk, machine: GrantMachine, ctx: GrantContext): GrantCapability => {
  switch (ask.kind) {
    case "platformWrite":
      return grantPlatformWrite(machine, ask.project, ctx);
    case "platformRead":
      return grantPlatformRead(machine, ask.project, ctx);
    case "identityMint":
      return identityMint(machine);
  }
};

/**
 * A capability of any class (§4.3): the grant's refusals, and those of a Mate's connection and a
 * Gitea session.
 */
export type Capability =
  | GrantCapability
  | {
      readonly allowed: false;
      readonly reason: "mate-not-connected" | "gitea-session";
      readonly waitable: boolean;
    };

/** One Mate environment as `mate(env)` weighs it. */
export interface MateCapabilityInput {
  /** The epoch's post-grant stage runs. */
  readonly postGrant: boolean;
  readonly credential: "held" | "none";
  /** `reconnecting` covers every link state the supervisor leaves on its own. */
  readonly link: "connected" | "reconnecting" | "blocked";
  /** `platformRead` of the environment's project. */
  readonly project: GrantCapability;
}

/**
 * Mate commands (§4.3): the post-grant stage runs, a credential is held and the link connected,
 * and the environment's project is readable. Only a reconnecting link may still connect on its own.
 */
export const mate = (input: MateCapabilityInput): Capability => {
  if (!input.postGrant) return { allowed: false, reason: "access-unverified", waitable: true };
  if (!input.project.allowed) return input.project;
  if (input.credential === "held" && input.link === "connected") return { allowed: true };
  return { allowed: false, reason: "mate-not-connected", waitable: input.link === "reconnecting" };
};

/** The phase of one Gitea session (`forge/giteaSessionMachine.ts`), as `forge(origin)` weighs it. */
export type GiteaSessionKind =
  | "idle"
  | "acquiring"
  | "signed-in"
  | "reacquiring"
  | "pending"
  | "unavailable"
  | "waiting"
  | "refused"
  | "closed";

/**
 * Forge commands on one Gitea origin (§4.3): its session is signed in. A session getting a token
 * or waiting for Gitea to finish setting up may still bring one; any other has none coming.
 */
export const forge = (session: GiteaSessionKind): Capability => {
  switch (session) {
    case "signed-in":
      return { allowed: true };
    case "closed":
      return { allowed: false, reason: "epoch-closed", waitable: false };
    case "acquiring":
    case "reacquiring":
    case "pending":
      return { allowed: false, reason: "gitea-session", waitable: true };
    case "idle":
    case "unavailable":
    case "waiting":
    case "refused":
      return { allowed: false, reason: "gitea-session", waitable: false };
  }
};

/**
 * Deleting a throwaway (§4.3, C5b): always, within the epoch that minted it — its finalizer carries
 * the minting token — or by a sweep under the same principal. It never waits and never touches the
 * session.
 */
export const throwawayCleanup = (minted: {
  readonly sameEpoch: boolean;
  readonly samePrincipal: boolean;
}): GrantCapability =>
  minted.sameEpoch || minted.samePrincipal
    ? { allowed: true }
    : { allowed: false, reason: "epoch-closed", waitable: false };

type Refusal = Extract<GrantCapability, { readonly allowed: false }>;

/** Each refusal in the cause's own words; the way on is the surface's to offer. */
const REFUSAL_COPY: Record<Refusal["reason"], string> = {
  "access-unverified": "Your Zerops access is still being checked.",
  "access-lapsed": "Your Zerops access is being checked again.",
  "project-unverified": "Your access to this project is still being checked.",
  "role-denies": "Your role in this project doesn't allow this.",
  "project-closed": "Your access to this project changed.",
  "epoch-closed": "This Zerops sign-in has ended.",
};

/** A capability that was not there: why, and whether asking again later may find it. */
export class CapabilityRefusal extends Data.TaggedError("CapabilityRefusal")<{
  readonly reason: Refusal["reason"];
  readonly waitable: boolean;
  readonly message: string;
}> {
  constructor(refusal: Refusal) {
    super({
      reason: refusal.reason,
      waitable: refusal.waitable,
      message: REFUSAL_COPY[refusal.reason],
    });
  }
}

export interface GrantCapabilities {
  /** The capability now, on the clock of whoever asks. */
  readonly check: (ask: CapabilityAsk) => Effect.Effect<GrantCapability>;
  /**
   * Waits up to `withinMs` for a waitable refusal to become allowed, before the command's own
   * deadline starts (§4.0). Fails with the refusal at once when nothing can change it, and with
   * the refusal still waitable when the wait ran out.
   */
  readonly await: (
    ask: CapabilityAsk,
    options: { readonly withinMs: number },
  ) => Effect.Effect<void, CapabilityRefusal>;
}

/** The capabilities one epoch's access grant holds. */
export const grantCapabilities = (grant: Pick<ZeropsAccessGrant, "changes">): GrantCapabilities => {
  /** The grant's machine as it is now: `changes` replays the latest view first. */
  const current = Stream.runHead(grant.changes).pipe(
    Effect.map((view) => Option.getOrThrow(view).machine),
  );
  const ctx = Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    return {
      now: {
        wall: clock.currentTimeMillisUnsafe(),
        mono: Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000,
      },
      policy: DEFAULT_ZEROPS_GRANT_POLICY,
    };
  });
  const check = (ask: CapabilityAsk) =>
    Effect.map(Effect.all([current, ctx]), ([machine, at]) => answer(ask, machine, at));
  return {
    check,
    await: (ask, { withinMs }) =>
      grant.changes.pipe(
        Stream.mapEffect((view) => Effect.map(ctx, (at) => answer(ask, view.machine, at))),
        Stream.filter((capability) => capability.allowed || !capability.waitable),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeoutOrElse({ duration: Duration.millis(withinMs), orElse: () => check(ask) }),
        Effect.flatMap((capability) =>
          capability.allowed ? Effect.void : Effect.fail(new CapabilityRefusal(capability)),
        ),
      ),
  };
};
