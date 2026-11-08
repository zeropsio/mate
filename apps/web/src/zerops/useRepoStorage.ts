/** A repository's Git storage as HQ reads it, and its cap set by whoever HQ's structure verb lets. */
import type { HqOfferState } from "@t3tools/shared/hqOffers";
import { useAccountOperationsOptional } from "./accountOperations";
import { useGitBrowse } from "./useGitBrowse";
import { useGitTargetOperations } from "./useGitTargetOperations";
import { useHqOffers } from "./useHqOffers";
import { useAccountOrgId } from "./ZeropsAccountData";

/** Read only inside a repository the person's access was verified for (`ZeropsRepositoryBrowser`). */
export function useRepoStorage(appId: string, repo: string) {
  const { view, answered } = useGitBrowse({ appId, repo, read: "storage", params: {} }, true);
  const target = useGitTargetOperations(appId);
  const offer: HqOfferState = useHqOffers().state(target.can, "structure");
  const operations = useAccountOperationsOptional();
  const orgId = useAccountOrgId();
  return {
    view,
    offer,
    /** Sets the cap; HQ's answer is the figure. Rejects with HQ's refusal in the person's words. */
    set:
      operations === null || orgId === null
        ? undefined
        : async (capGiB: number) => {
            const { storage } = await operations.run(
              { kind: "set-repo-cap", orgId, appId, repo, capGiB },
              {
                orgId,
                unobserved:
                  "HQ isn't answering. Check the repository's storage limit when it returns.",
              },
            );
            answered(storage);
          },
  };
}
