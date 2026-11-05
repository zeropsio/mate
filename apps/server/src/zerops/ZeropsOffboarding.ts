/**
 * ZeropsOffboarding — a person this project no longer opens for is signed out
 * of every login they signed in here (X4), and so is everyone but the new
 * owner once the project changes hands.
 *
 * Whenever the access list reports, and whenever a sign-in is
 * recorded, it reads who signed each login in (`ZeropsProjectSigners`, an
 * agent's own login and any beyond the two) and asks, for each signer, the
 * answer that keeps a session open (`hasProjectAccess`, X3). An access list
 * that only aged changes nobody's answer: past its expiry the answer cannot
 * say, and signs nobody out. An observed removal from the list is still a
 * definite loss, even when the read it builds on has expired. A login whose
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
import * as Stream from "effect/Stream";

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
  /** Take removals observed since the last pass and check each against the current list. */
  readonly takeRemovals?: Effect.Effect<(userId: string) => Effect.Effect<boolean>>;
}) =>
  Effect.gen(function* () {
    const lastOwners = yield* Ref.make<ReadonlyArray<string> | undefined>(undefined);
    const takeRemovals =
      options.takeRemovals ?? Effect.succeed((_userId: string) => Effect.succeed(false));
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
        const wasRemoved = yield* takeRemovals;
        const newOwners = yield* ownersMoved;
        let signedOut = 0;
        for (const [key, signer] of Object.entries(yield* options.signers)) {
          if (signer.length === 0) continue;
          const handedOver = newOwners !== undefined && !newOwners.includes(signer);
          if (!handedOver) {
            const access = yield* options.hasProjectAccess(signer);
            if (access !== false && (access !== undefined || !(yield* wasRemoved(signer)))) {
              continue;
            }
          }
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
 * While this is a Zerops project, one pass whenever the access list reports a read or frame, and
 * whenever a sign-in is recorded. Comparing reports retains an observed removal even if the read
 * the frame builds on has expired; a successful unchanged read also gets a pass.
 */
export const layer = Layer.effect(
  ZeropsOffboarding,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const signers = yield* ZeropsProjectSigners;
    const accessList = yield* ZeropsMateAccessList;
    // Retain changes between reports until a pass can act on them.
    const observed = yield* Ref.make<{
      readonly openers: ReadonlySet<string> | undefined;
      readonly removed: ReadonlySet<string>;
    }>({ openers: undefined, removed: new Set() });
    const service = yield* make({
      signers: signers.signers,
      hasProjectAccess: signers.hasProjectAccess,
      owners: Effect.map(accessList.current, (list) => Option.getOrUndefined(list)?.owners),
      signOut: (yield* ZeropsSignOut).signOut,
      takeRemovals: Effect.gen(function* () {
        const removed = yield* Ref.modify(observed, (state) => [
          state.removed,
          { ...state, removed: new Set<string>() },
        ]);
        return (userId: string) =>
          removed.has(userId)
            ? Effect.map(
                accessList.current,
                (list) =>
                  Option.isSome(list) &&
                  !list.value.members.some(
                    (member) => member.userId === userId && member.visibility === "open",
                  ),
              )
            : Effect.succeed(false);
      }),
    });
    if (config.zerops !== undefined) {
      // A report is the only transition evidence available once its underlying read has expired.
      const reports = accessList.reports.pipe(
        Stream.mapEffect((report) =>
          Ref.update(observed, ({ openers, removed }) => {
            const next = new Set(report.openers);
            const pending = new Set(removed);
            for (const userId of openers ?? []) if (!next.has(userId)) pending.add(userId);
            for (const userId of next) pending.delete(userId);
            return { openers: next, removed: pending };
          }),
        ),
      );
      const moved = yield* subscribeChanges([reports, signers.changes]);
      yield* Effect.forkScoped(Effect.forever(Effect.andThen(moved, service.checkNow)));
    }
    return service;
  }),
);
