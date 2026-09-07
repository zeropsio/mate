/**
 * Forgets a registered environment whose project no longer exists.
 *
 * A registration outlives its container: delete the project on the platform
 * and the client keeps a target that reconnects forever, its cached projects
 * and drafts still on disk. Nothing in the account can explain that row, and
 * a person should not have to find the Devices screen to make it stop. So
 * once the account has been read cleanly, an environment that came in through
 * the Zerops door, cannot connect, and resolves to a project the account no
 * longer has, is removed — with the project it remembered.
 *
 * It also forgets a container belonging to an account that is not the one
 * signed in. Signing in as somebody else left those registered and failing
 * their credential exchange forever, which surfaced as "Could not repair the
 * Zerops session" about a project the signed-in user has never seen.
 *
 * Deliberately narrow: only a failing socket, only after a load with no error,
 * once per session. A live environment is never touched, neither is one whose
 * project we simply have not learned, and neither is one in another
 * organization of the *same* account, whose projects were never read.
 * `shouldForgetZeropsEnvironment` holds the whole rule.
 */

import { useEffect, useRef } from "react";

import {
  forgetEnvironmentProjectRef,
  lookupEnvironmentProjectRef,
} from "@t3tools/client-runtime/zerops/environmentProjectRef";

import { environmentCatalog } from "~/connection/catalog";
import { useEnvironments } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";

import { shouldForgetZeropsEnvironment } from "./deadEnvironment";
import { connectionOriginFor } from "./firstPromptStorage";
import { browserZeropsStorage } from "./storage";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";

export function useZeropsDeadEnvironmentReaper(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidatePresentation>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly activeOrgId: string | null;
  /** Every organization the signed-in account belongs to. */
  readonly accountOrgIds: ReadonlySet<string>;
  readonly enabled: boolean;
}): void {
  const { environments } = useEnvironments();
  const remove = useAtomCommand(environmentCatalog.remove, { reportFailure: false });
  const attemptedRef = useRef(new Set<string>());
  const { accountOrgIds, activeOrgId, candidates, enabled, error, isLoading } = input;

  useEffect(() => {
    if (!enabled || isLoading || error !== null || activeOrgId === null) return;
    const knownProjectIds = new Set(candidates.map((candidate) => candidate.project.id));
    let cancelled = false;

    for (const environment of environments) {
      const id = String(environment.environmentId);
      const phase = environment.connection.phase;
      if (phase !== "reconnecting" && phase !== "error") continue;
      if (connectionOriginFor(id) !== "zerops-identity") continue;
      if (attemptedRef.current.has(id)) continue;
      attemptedRef.current.add(id);

      void lookupEnvironmentProjectRef(browserZeropsStorage, environment.environmentId).then(
        async (ref) => {
          if (cancelled) return;
          const forget = shouldForgetZeropsEnvironment({
            ref,
            activeOrgId,
            accountOrgIds,
            knownProjectIds,
          });
          if (!forget) return;
          await remove(environment.environmentId);
          await forgetEnvironmentProjectRef(browserZeropsStorage, environment.environmentId);
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [accountOrgIds, activeOrgId, candidates, enabled, environments, error, isLoading, remove]);
}
