/** Issuance has no durable request-id lookup: uncertain issuance never sends a second key. */
import * as Effect from "effect/Effect";
import type { GitCredential } from "@t3tools/shared/hqGit";
import { HqError, type HqApi } from "../../../zerops/hq/client.ts";
import type { OperationExecutor } from "../coordinator.ts";
export function makeGitCredentialExecutor(options: {
  readonly api: Pick<HqApi, "issueGitCredential" | "revokeGitCredential">;
  readonly current: () => boolean;
  readonly revealed: (requestId: string, credential: GitCredential) => void;
}): OperationExecutor {
  return {
    isCurrent: options.current,
    submit: (requestId, intent) =>
      Effect.gen(function* () {
        if (
          !options.current() ||
          (intent.kind !== "issue-git-credential" && intent.kind !== "revoke-git-credential")
        )
          return yield* Effect.fail({
            outcome: "definitive-refusal",
            message: "This credential action is unavailable.",
          } as const);
        const credential = yield* Effect.tryPromise({
          try: () =>
            intent.kind === "issue-git-credential"
              ? options.api.issueGitCredential(intent.appId)
              : options.api.revokeGitCredential(intent.appId, intent.id).then(() => null),
          catch: (cause) =>
            cause instanceof HqError && cause.kind === "refused"
              ? { outcome: "definitive-refusal" as const, message: cause.message }
              : {
                  outcome: "uncertain-acceptance" as const,
                  message:
                    "HQ may have taken the action. Read the password list before creating another password.",
                },
        });
        if (!options.current())
          return yield* Effect.fail({
            outcome: "uncertain-acceptance",
            message: "The account changed before HQ answered.",
          } as const);
        if (credential !== null) options.revealed(requestId, credential);
        const result =
          credential === null
            ? undefined
            : {
                id: credential.id,
                appId: credential.appId,
                createdAt: credential.createdAt,
                expiresAt: credential.expiresAt,
              };
        return {
          requestId,
          operationId: requestId,
          executor: "hq",
          handles: result === undefined ? [] : [result.id],
          affected: [],
          acceptance: { kind: "accepted", ...(result === undefined ? {} : { result }) },
          outcome: { kind: "succeeded", evidence: "HQ answered this credential action." },
        };
      }),
  };
}
