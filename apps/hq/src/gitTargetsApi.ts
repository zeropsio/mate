/** Thin Git transport dispatch. Domain authorization and receipts stay with each owner. */
import type { HqGitTargetIntent } from "@t3tools/shared/hqGitTargets";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import { Remotes } from "./repoRemotes.ts";
import { Structure } from "./structure.ts";
import { Releases } from "./releases.ts";
import { Deploys } from "./deploys.ts";

export const gitTargetWrite = (
  userId: string,
  requestId: string,
  intent: HqGitTargetIntent,
  candidate?: Redacted.Redacted,
) =>
  Effect.gen(function* () {
    switch (intent.kind) {
      case "probe-git-remote":
      case "connect-git-remote":
      case "replace-git-remote-token":
      case "update-git-remote-address":
      case "disconnect-git-remote":
        return yield* (yield* Remotes).write(userId, requestId, intent, candidate);
      case "preview-git-environment":
      case "add-git-environment":
      case "remove-git-environment":
        return yield* (yield* Structure).gitTargetWrite(userId, requestId, intent);
      case "preflight-git-release":
        return yield* (yield* Releases).gitReview(userId, requestId, intent);
      case "run-git-again":
        return yield* (yield* Deploys).runGitAgain(userId, requestId, intent);
    }
  });
export const gitTargetReceipt = (userId: string, requestId: string, intent: HqGitTargetIntent) =>
  Effect.gen(function* () {
    switch (intent.kind) {
      case "probe-git-remote":
      case "connect-git-remote":
      case "replace-git-remote-token":
      case "update-git-remote-address":
      case "disconnect-git-remote":
        return yield* (yield* Remotes).receipt(userId, requestId, intent);
      case "preview-git-environment":
      case "add-git-environment":
      case "remove-git-environment":
        return yield* (yield* Structure).gitTargetReceipt(userId, requestId, intent);
      case "preflight-git-release":
        return yield* (yield* Releases).gitReceipt(userId, requestId, intent);
      case "run-git-again":
        return yield* (yield* Deploys).gitReceipt(userId, requestId, intent);
    }
  });
