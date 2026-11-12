/**
 * ZeropsOffboarding — a person this project no longer opens for is signed out
 * of every login they signed in here (X4), and so is everyone but the new
 * owner once the Mate changes hands.
 *
 * Whenever HQ answers the signers' standing (`ZeropsSignerStanding`: a turn
 * start asked, or this pass asked once after a sign-in was recorded), it reads
 * who signed each login in (`ZeropsProjectSigners`, an agent's own login and
 * any beyond the two) and signs out every login whose signer HQ said `left` or
 * `no_access` for, by the one sign-out a person can ask for (`ZeropsSignOut`):
 * its login session cancelled, its live provider sessions stopped, its CLI
 * logged out, its credential gone, an agent's flag cleared. Any other answer
 * signs nobody out: `sign_in_needed` only waits for the person to open Mate
 * once, and HQ silent — unreachable, refusing, or `unknown` for a person —
 * never logs a room out. A sign-out that stumbles is logged, the rest go on.
 *
 * The same pass watches whose the Mate is: the owner HQ names
 * (`ZeropsMateOwner`), moved by a hand-over or by another person's sign-in, and
 * a pass runs each time it moves. When HQ names a person other than the last
 * one it named, every login whose signer is not the new owner is signed out
 * the same way, whatever access its signer keeps through their organization
 * role: the old owner's login never runs the new owner's agent. The first
 * person HQ names is the baseline. While HQ names nobody — before its first
 * state, or a Mate HQ records no owner of — nothing has changed hands and
 * nobody is signed out for it: each login still runs only its own signer's
 * turns (`ZeropsProjectSigners`), and access loss still signs a person out.
 *
 * @module ZeropsOffboarding
 */
import type { ZeropsAgentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { KNOWN_AGENT_IDS } from "./ZeropsAgentAuth.ts";
import { type MateOwner, ZeropsMateOwner } from "./ZeropsMateOwner.ts";
import { type ProjectSigners, ZeropsProjectSigners } from "./ZeropsProjectSigners.ts";
import { type SignerStandings, ZeropsSignerStanding } from "./ZeropsSignerStanding.ts";
import { type SignOutTarget, ZeropsSignOut } from "./ZeropsSignOut.ts";
import { subscribeChanges } from "./zeropsChanges.ts";

export class ZeropsOffboarding extends Context.Service<
  ZeropsOffboarding,
  {
    /**
     * Runs one pass now, on the standings HQ answered since the last pass and the owner it names,
     * and answers how many logins it signed out.
     */
    readonly checkNow: Effect.Effect<number>;
  }
>()("t3/zerops/ZeropsOffboarding") {}

/** A signer key as a sign-out names it: an agent's own login by the agent, any other by its id. */
const targetOf = (key: string): SignOutTarget =>
  (KNOWN_AGENT_IDS as ReadonlyArray<string>).includes(key)
    ? { agentId: key as ZeropsAgentId }
    : { loginId: key };

export const make = (options: {
  readonly signers: Effect.Effect<ProjectSigners>;
  /** Whom HQ names the Mate's owner (`ZeropsMateOwner.owner`). */
  readonly owner: Effect.Effect<MateOwner>;
  readonly signOut: ZeropsSignOut["Service"]["signOut"];
  /** Take the standings HQ answered since the last pass, the later heard winning per person. */
  readonly takeHeard?: Effect.Effect<SignerStandings>;
}) =>
  Effect.gen(function* () {
    /** The last person HQ named the owner, as the last pass read it. */
    const lastOwner = yield* Ref.make<string | undefined>(undefined);
    const takeHeard = options.takeHeard ?? Effect.succeed<SignerStandings>({});
    /** The new owner when HQ named another person since the last pass that read one. */
    const ownerMoved = Effect.gen(function* () {
      const owner = yield* options.owner;
      if (typeof owner !== "string") return undefined;
      const previous = yield* Ref.getAndSet(lastOwner, owner);
      return previous !== undefined && previous !== owner ? owner : undefined;
    });
    return ZeropsOffboarding.of({
      checkNow: Effect.gen(function* () {
        const heard = yield* takeHeard;
        const newOwner = yield* ownerMoved;
        let signedOut = 0;
        for (const [key, signer] of Object.entries(yield* options.signers)) {
          if (signer.length === 0) continue;
          const handedOver = newOwner !== undefined && signer !== newOwner;
          const standing = heard[signer];
          if (!handedOver && standing !== "left" && standing !== "no_access") continue;
          const target = targetOf(key);
          const done = yield* options.signOut(target).pipe(
            Effect.as(true),
            Effect.catch((error) =>
              Effect.as(
                Effect.logWarning("zerops offboarding: a login was not signed out", {
                  ...target,
                  error,
                }),
                false,
              ),
            ),
          );
          if (done) signedOut += 1;
        }
        return signedOut;
      }).pipe(Effect.catchCause(() => Effect.succeed(0))),
    });
  });

/**
 * While this is a Zerops project, one pass whenever HQ answers the signers' standing, whenever a
 * sign-in is recorded (after asking HQ once: its answer is heard and passed on in turn), and
 * whenever HQ names another owner.
 */
export const layer = Layer.effect(
  ZeropsOffboarding,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const signers = yield* ZeropsProjectSigners;
    const signerStanding = yield* ZeropsSignerStanding;
    const mateOwner = yield* ZeropsMateOwner;
    // Answers heard between passes, kept until a pass can act on them.
    const pending = yield* Ref.make<SignerStandings>({});
    const service = yield* make({
      signers: signers.signers,
      owner: mateOwner.owner,
      signOut: (yield* ZeropsSignOut).signOut,
      takeHeard: Ref.getAndSet(pending, {}),
    });
    if (config.zerops !== undefined) {
      const heard = signerStanding.heard.pipe(
        Stream.mapEffect((standings) => Ref.update(pending, (kept) => ({ ...kept, ...standings }))),
      );
      // HQ answers for every signer it records, whoever is asked about.
      const askedAfterSignIn = signers.changes.pipe(
        Stream.mapEffect(() =>
          Effect.flatMap(signers.signers, (current) => {
            const someone = Object.values(current).find((signer) => signer.length > 0);
            return someone === undefined ? Effect.void : signerStanding.standing(someone);
          }),
        ),
      );
      const moved = yield* subscribeChanges([heard, askedAfterSignIn, mateOwner.changes]);
      yield* Effect.forkScoped(Effect.forever(Effect.andThen(moved, service.checkNow)));
    }
    return service;
  }),
);
