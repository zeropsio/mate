/**
 * ZeropsOffboarding — a person this project no longer opens for is signed out
 * of every login they signed in here (X4).
 *
 * Every role recheck it reads who signed each login in (`ZeropsProjectSigners`,
 * an agent's own login and any beyond the two) and asks, for each signer, the
 * answer that keeps a session open (`hasProjectAccess`, X3). A login whose
 * signer it says no for is signed out by the one sign-out a person can ask for
 * (`ZeropsSignOut`): its login session cancelled, its live provider sessions
 * stopped, its CLI logged out, its credential gone, an agent's flag cleared.
 * A read that cannot say signs nobody out — a platform blip never logs a
 * room out — and a sign-out that stumbles is logged, the rest go on.
 *
 * @module ZeropsOffboarding
 */
import type { ZeropsAgentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import * as ServerConfig from "../config.ts";
import { KNOWN_AGENT_IDS } from "./ZeropsAgentAuth.ts";
import { type ProjectSigners, ZeropsProjectSigners } from "./ZeropsProjectSigners.ts";
import { type SignOutTarget, ZeropsSignOut } from "./ZeropsSignOut.ts";

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

export const make = (options: {
  readonly signers: Effect.Effect<ProjectSigners>;
  readonly hasProjectAccess: ZeropsProjectSigners["Service"]["hasProjectAccess"];
  readonly signOut: ZeropsSignOut["Service"]["signOut"];
}) =>
  Effect.succeed(
    ZeropsOffboarding.of({
      checkNow: Effect.gen(function* () {
        let signedOut = 0;
        for (const [key, signer] of Object.entries(yield* options.signers)) {
          if (signer.length === 0) continue;
          if ((yield* options.hasProjectAccess(signer)) !== false) continue;
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
    }),
  );

/** One pass every role recheck, while this is a Zerops project. */
export const layer = Layer.effect(
  ZeropsOffboarding,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const signers = yield* ZeropsProjectSigners;
    const service = yield* make({
      signers: signers.signers,
      hasProjectAccess: signers.hasProjectAccess,
      signOut: (yield* ZeropsSignOut).signOut,
    });
    if (config.zerops !== undefined) {
      yield* Effect.forkScoped(
        service.checkNow.pipe(Effect.repeat(Schedule.spaced(config.zerops.roleRecheckInterval))),
      );
    }
    return service;
  }),
);
