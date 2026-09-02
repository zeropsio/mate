/**
 * ZeropsPolicy - the three things T3 does with git that a Zerops project must
 * not do, decided in one place.
 *
 * 1. **No worktrees.** The isolation unit on Zerops is a service, not a
 *    directory: a dev service has one `/var/www`, one process, one subdomain
 *    and one database, and a second checkout of its code is a checkout nobody
 *    serves. A parallel feature is a sibling dev service the agent provisions,
 *    or its own project. So `worktreePath` stays null and the project's
 *    default thread env mode stays `local`.
 * 2. **No second commit pipeline.** T3's stacked commit -> push -> PR action
 *    and zcp's git-push flow would be two programs pushing the same repository
 *    with different identities and different opinions about the remote. zcp
 *    owns init, identity, the PAT, commit and push; mate owns turn-level history
 *    (checkpoints, diff, restore, review).
 * 3. **No automatic upstream refresh.** A status poll triggers a background
 *    `fetch` per remote, which on Zerops is unwanted network from N services
 *    at once against a PAT-backed origin mate does not own.
 * 4. **No destructive restore.** Upstream, reverting a checkpoint runs
 *    `clean -fd` because the tree is a checkout on a laptop. On Zerops it is a
 *    *running application's* disk: uploads, sqlite files and logs the live app
 *    wrote after the checkpoint sit right there, and none of them are the
 *    agent's to delete. Restore puts tracked files back and stops.
 *
 * Each rule is *enforced* rather than defaulted - at the decider for the
 * worktree state, server-side in `GitManager` for the other two - because a
 * `.t3/project` file in a repository or a hand-written RPC can set anything a
 * mere default would allow.
 *
 * The policy reads the server config **optionally**. That keeps the decider's
 * requirement set unchanged (a pure command decider that suddenly needed a
 * config service would ripple through every caller and every existing test),
 * and it fails in the safe direction: no config in context means the upstream
 * policy, which is exactly what a unit test that provides nothing sees.
 *
 * @module ZeropsPolicy
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ServerConfig } from "../config.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";

export interface ZeropsPolicy {
  /** May a thread run in its own git worktree? */
  readonly worktreesAllowed: boolean;
  /** May T3 run its own commit -> push -> PR pipeline? */
  readonly stackedVcsActionsAllowed: boolean;
  /** May a status read fetch from the remote in the background? */
  readonly upstreamRefreshAllowed: boolean;
  /** May restoring a checkpoint delete untracked files? */
  readonly restoreRemovesUntrackedFiles: boolean;
}

/** Everywhere that is not a Zerops container: upstream behaviour, untouched. */
export const UPSTREAM_POLICY: ZeropsPolicy = {
  worktreesAllowed: true,
  stackedVcsActionsAllowed: true,
  upstreamRefreshAllowed: true,
  restoreRemovesUntrackedFiles: true,
};

/** Inside a Zerops project container. */
export const ZEROPS_POLICY: ZeropsPolicy = {
  worktreesAllowed: false,
  stackedVcsActionsAllowed: false,
  upstreamRefreshAllowed: false,
  restoreRemovesUntrackedFiles: false,
};

/** The policy in force for this server. */
export const zeropsPolicy: Effect.Effect<ZeropsPolicy> = Effect.serviceOption(ServerConfig).pipe(
  Effect.map((config) =>
    Option.isSome(config) && isZeropsEnvironment(config.value) ? ZEROPS_POLICY : UPSTREAM_POLICY,
  ),
);

/**
 * What the server tells clients about the two git pipelines.
 *
 * Hiding a control is presentation, never enforcement - both refusals live
 * server-side as well - but a button that leads to a refusal is worse than no
 * button.
 */
export const REFUSED_STACKED_ACTION_DETAIL =
  "Commit and push are zcp's on Zerops - ask the agent to run the git-push flow instead of committing from mate.";
