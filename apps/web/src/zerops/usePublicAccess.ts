/**
 * A project's public face, as the account's store derives it from the organization's services and
 * routings: no read of its own. Where the organization's routings are refused to the viewer, the
 * surface drawing the project holds that project's own listing while it is drawn.
 */
import {
  PROJECT_ROUTINGS_LISTING,
  publicAccess,
  type PublicAccess,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";

import { useAccountDataOptional, useDetailDemand, useProjection } from "./ZeropsAccountData";

export interface PublicAccessView extends PublicAccess {
  /** Read from an account's store; outside one (a test, the hand-over page) nothing is read. */
  readonly bound: boolean;
  /** The person's try now, for what the account observes. */
  readonly again: () => void;
}

const NOT_READ = Atom.make<PublicAccess>({
  state: "reading",
  routes: [],
  pending: [],
  offers: [],
  readsProject: false,
});

const NOTHING_TO_TRY = () => {};

/** The project's public access; unbound, reading nothing, outside an account or without a project. */
export function usePublicAccess(projectId: string | undefined): PublicAccessView {
  const account = useAccountDataOptional();
  const orgId = account?.orgId ?? null;
  const access = useProjection(
    publicAccess,
    orgId === null || projectId === undefined ? null : { orgId, projectId },
    NOT_READ,
  );
  useDetailDemand(
    "publicRouting",
    PROJECT_ROUTINGS_LISTING,
    access.readsProject && projectId !== undefined ? projectId : null,
  );
  const bound = account !== null && orgId !== null && projectId !== undefined;
  return { ...access, bound, again: account?.retry ?? NOTHING_TO_TRY };
}
