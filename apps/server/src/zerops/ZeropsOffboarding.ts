/**
 * ZeropsOffboarding — a person this project no longer opens for is signed out
 * of every login they signed in here (X4), and so is everyone but the new
 * owner once the project changes hands.
 *
 * Whenever whom the access list opens for changes, and whenever a sign-in is
 * recorded, it reads who signed each login in (`ZeropsProjectSigners`, an
 * agent's own login and any beyond the two) and asks, for each signer, the
 * answer that keeps a session open (`hasProjectAccess`, X3). An access list
 * that only aged changes nobody's answer: past its expiry the answer cannot
 * say, and signs nobody out. A login whose
 * signer it says no for is signed out by the one sign-out a person can ask for
 * (`ZeropsSignOut`): its login session cancelled, its live provider sessions
 * stopped, its CLI logged out, its credential gone, an agent's flag cleared.
 * A read that cannot say signs nobody out — a platform blip never logs a
 * room out — and a sign-out that stumbles is logged, the rest go on.
 *
 * The same pass watches whose the project is: the owners its own row names
 * (`AccessList.owners`, its `OWNER` override), which move the access list too. When they change to someone,
 * every login whose signer is not among the new owners is signed out the same
 * way, whatever access its signer keeps through their organization role: the
 * old owner's login never runs the new owner's agent. The first owners a pass
 * reads are its baseline, and a pass that cannot read them keeps the last.
 *
 * @module ZeropsOffboarding
 */
import type { ZeropsAgentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import { KNOWN_AGENT_IDS } from "./ZeropsAgentAuth.ts";
import { ZeropsMateAccessList } from "./ZeropsMateAccessList.ts";
import { type ProjectSigners, ZeropsProjectSigners } from "./ZeropsProjectSigners.ts";
import { type SignOutTarget, ZeropsSignOut } from "./ZeropsSignOut.ts";
import { subscribeChanges } from "./zeropsChanges.ts";

export class ZeropsOffboarding extends Context.Service<
  ZeropsOffboarding,
  {
    /** Runs one pass now and answers how many logins it signed out. */
    readonly checkNow: Effect.Effect<number>;
  }
>()("t3/zerops/ZeropsOffboarding") {}

/** A signer key as a sign-out names it: an agent's own login by the agent, any other by its id. */
const targetOf = (key: string): SignOutTarget =>
  (KNOWN_AGENT_IDS as ReadonlyArray<string>).includes(key)
    ? { agentId: key as ZeropsAgentId }
    : { loginId: key };

const sameOwners = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((owner) => b.includes(owner));

export const make = (options: {
  readonly signers: Effect.Effect<ProjectSigners>;
  readonly hasProjectAccess: ZeropsProjectSigners["Service"]["hasProjectAccess"];
  /** Whose the project is as its own row names it; `undefined` while no own read says. */
  readonly owners: Effect.Effect<ReadonlyArray<string> | undefined>;
  readonly signOut: ZeropsSignOut["Service"]["signOut"];
}) =>
  Effect.gen(function* () {
    const lastOwners = yield* Ref.make<ReadonlyArray<string> | undefined>(undefined);
    /** The new owners when they changed to someone since the last pass that read them. */
    const ownersMoved = Effect.gen(function* () {
      const owners = yield* options.owners;
      if (owners === undefined) return undefined;
      const previous = yield* Ref.getAndSet(lastOwners, owners);
      return previous !== undefined && owners.length > 0 && !sameOwners(previous, owners)
        ? owners
        : undefined;
    });
    return ZeropsOffboarding.of({
      checkNow: Effect.gen(function* () {
        const newOwners = yield* ownersMoved;
        let signedOut = 0;
        for (const [key, signer] of Object.entries(yield* options.signers)) {
          if (signer.length === 0) continue;
          const handedOver = newOwners !== undefined && !newOwners.includes(signer);
          if (!handedOver && (yield* options.hasProjectAccess(signer)) !== false) continue;
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
 * While this is a Zerops project, one pass whenever the access list changes whom it opens for or
 * whose the project is (`ZeropsMateAccessList`: the Mate's own recompute or a Zerops websocket
 * frame), and whenever a sign-in is recorded (`ZeropsProjectSigners.changes`).
 */
export const layer = Layer.effect(
  ZeropsOffboarding,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const signers = yield* ZeropsProjectSigners;
    const accessList = yield* ZeropsMateAccessList;
    const service = yield* make({
      signers: signers.signers,
      hasProjectAccess: signers.hasProjectAccess,
      owners: Effect.map(accessList.current, (list) => Option.getOrUndefined(list)?.owners),
      signOut: (yield* ZeropsSignOut).signOut,
    });
    if (config.zerops !== undefined) {
      const moved = yield* subscribeChanges([accessList.changes, signers.changes]);
      yield* Effect.forkScoped(Effect.forever(Effect.andThen(moved, service.checkNow)));
    }
    return service;
  }),
);
