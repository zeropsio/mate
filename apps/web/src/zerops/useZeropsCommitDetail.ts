/**
 * What one commit changed, read only once somebody opens it.
 *
 * The one read in the client that goes below a commit's subject. Without it a
 * history could say a change had landed and never say what was in it, which is
 * the question a diff answers and a list of subjects cannot.
 */
import type { GiteaCommitDetail } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback } from "react";

import { giteaClientFor } from "./giteaSession";

export type ZeropsCommitDetailResult =
  | { readonly kind: "read"; readonly detail: GiteaCommitDetail }
  | { readonly kind: "none" }
  | { readonly kind: "failed"; readonly reason: string };

/** Reads one commit on demand; the caller holds which one is open. */
export function useZeropsCommitDetailReader(input: {
  readonly giteaOrigin: string | undefined;
  readonly owner: string | undefined;
  readonly repo: string | undefined;
}): (sha: string) => Promise<ZeropsCommitDetailResult> {
  const { giteaOrigin, owner, repo } = input;
  return useCallback(
    async (sha: string) => {
      if (giteaOrigin === undefined || owner === undefined || repo === undefined) {
        return { kind: "none" } as const;
      }
      const client = giteaClientFor(giteaOrigin);
      if (client === null) return { kind: "none" } as const;
      try {
        const detail = await client.commitDetail(owner, repo, sha);
        return detail === undefined
          ? ({ kind: "none" } as const)
          : ({ kind: "read", detail } as const);
      } catch (error: unknown) {
        return { kind: "failed", reason: zeropsErrorMessage(error) } as const;
      }
    },
    [giteaOrigin, owner, repo],
  );
}
