/** The open review holds only access demand. The account grant owns each read and its outcome. */
import { useAtomValue } from "@effect/atom-react";
import {
  type GrantFailure,
  type RuntimeInterestDescriptor,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useEffect, useMemo, useState } from "react";

import { hqPlacementsAtom } from "../state/zerops";
import { useZeropsSessionOptional } from "./sessionContext";
import { useChangeOffers, type ZeropsChangeOffers } from "./useChangeOffers";
import { useZeropsData } from "./zeropsDataContext";

function failureWords(failure: GrantFailure): string {
  switch (failure.kind) {
    case "server":
      return `Zerops returned ${String(failure.status)}.`;
    case "transport":
    case "malformed":
      return failure.detail;
    case "offline":
      return "You are offline.";
    case "timeout":
      return "Zerops did not answer in time.";
    case "throttled":
      return "Zerops refused the read because too many requests were sent.";
  }
}

export function useChangeReviewOffers(
  appId: string,
  repository: string,
): ZeropsChangeOffers | undefined {
  const data = useZeropsData();
  const placements = useAtomValue(hqPlacementsAtom);
  const session = useZeropsSessionOptional();
  const organizationId = session?.activeOrganization?.id;
  const grant = useAtomValue(data.runtime.access.view);
  const phase = grant.machine.phase;
  const evidence =
    phase.phase === "granted" ? phase.evidence : phase.phase === "lapsed" ? phase.last : null;
  const descriptors = useMemo<ReadonlyArray<RuntimeInterestDescriptor>>(
    () =>
      organizationId === undefined || placements === null
        ? []
        : [...placements]
            .filter(([, placed]) => placed.appId === appId)
            .map(([id]) => ({
              kind: "project-access",
              project: data.projectRef(organizationId, id),
            })),
    [appId, data, organizationId, placements],
  );
  const [attempt, setAttempt] = useState(0);
  const [admission, setAdmission] = useState<{
    readonly descriptors: ReadonlyArray<RuntimeInterestDescriptor>;
    readonly attempt: number;
    readonly message: string;
  }>();
  const admissionFailure =
    admission?.descriptors === descriptors && admission.attempt === attempt
      ? admission.message
      : undefined;
  useEffect(() => {
    const controller = new AbortController();
    void Effect.runPromise(
      Effect.scoped(
        data.runtime.acquireMany(descriptors).pipe(
          Effect.flatMap((leases) => {
            const refusal = leases.find(Result.isFailure);
            if (refusal !== undefined && !controller.signal.aborted)
              setAdmission({ descriptors, attempt, message: refusal.failure.message });
            return Effect.never;
          }),
        ),
      ),
      { signal: controller.signal },
    ).catch((cause: unknown) => {
      if (!controller.signal.aborted)
        setAdmission({
          descriptors,
          attempt,
          message: cause instanceof Error ? cause.message : "The access read failed.",
        });
    });
    return () => controller.abort();
  }, [data.runtime, descriptors, attempt]);

  const verified = useMemo(
    () =>
      [...(evidence?.projects ?? [])]
        .filter(([, { access }]) => access.project.organization.organizationId === organizationId)
        .map(([id, { access }]) => ({ id, userRoles: access.userRoles })),
    [evidence, organizationId],
  );
  const offersOf = useChangeOffers(verified);
  const offers = offersOf(appId, repository);
  if (offers === undefined || offers.merge) return offers;
  const projects = descriptors.flatMap((descriptor) =>
    "project" in descriptor ? [descriptor.project] : [],
  );
  const failures = projects.flatMap((project) => {
    const unverified = evidence?.unverified.get(project.projectId);
    const closed = evidence?.closedProjects.get(project.projectId);
    const failure =
      unverified?.failure ??
      (closed?.confirmation.status === "due" ? closed.confirmation.failure : null);
    return failure === null || failure === undefined ? [] : [failureWords(failure)];
  });
  const failure = admissionFailure ?? failures[0];
  if (failure !== undefined)
    return {
      ...offers,
      reason: `Project access could not be verified: ${failure}`,
      again: () => {
        if (admissionFailure !== undefined) setAttempt((value) => value + 1);
        else void Effect.runPromise(data.runtime.access.signal({ type: "USER_RETRY" }));
      },
    };
  const pending = projects.some(
    (project) =>
      !evidence?.projects.has(project.projectId) &&
      evidence?.closedProjects.get(project.projectId)?.confirmation.status !== "confirmed",
  );
  return pending ? { ...offers, reason: "Checking project access…" } : offers;
}
