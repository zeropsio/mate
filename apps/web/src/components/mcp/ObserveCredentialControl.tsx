/**
 * Whose Zerops permissions the built-in Zerops tools observe stage and production with, said in
 * the Zerops row's facts: "Reads them as Aleš · until 4 Dec · Renew". Renew (Authorize, where
 * none is held) is offered to a person who may operate the Mate; HQ's refusal is said in its words.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import {
  offersObserveAuthorize,
  projectOperator,
  type ObserveCredentialRead,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useObserveCredential } from "~/zerops/useObserveCredential";
import { useAuthorizeObserve, type ObserveAuthorizePress } from "~/zerops/useObserveAuthorization";
import { useEnvironmentProjectRef } from "~/zerops/useZeropsFeeds";
import { useAccountOrgId, useProjection } from "~/zerops/ZeropsAccountData";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { InlineButton } from "../ui/button";

const UNDECIDED = Atom.make<boolean | undefined>(undefined);

export function ObserveLine({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const project = useEnvironmentProjectRef(environmentId);
  const projectId = project?.projectId ?? null;
  const control = useObserveCredential(projectId);
  const orgId = useAccountOrgId();
  const personName = useHqPersonNames(orgId ?? undefined);
  const operates = useProjection(
    projectOperator,
    orgId === null || projectId === null ? null : { orgId, projectId },
    UNDECIDED,
  );
  const { authorize, press } = useAuthorizeObserve(projectId);
  if (project === null) return null;
  const offered = offersObserveAuthorize({
    operates: operates === true,
    metadata: control.state.metadata,
  });
  return (
    <ObserveLineBody
      authorize={offered ? authorize : null}
      available={control.available}
      personName={personName}
      press={press}
      state={control.state}
    />
  );
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function ObserveLineBody(props: {
  readonly state: ObserveCredentialRead;
  readonly available: boolean;
  readonly personName: (userId: string) => string | undefined;
  /** Offered to a viewer who may operate the Mate; else `null`. */
  readonly authorize: (() => void) | null;
  readonly press: ObserveAuthorizePress | null;
}) {
  const { metadata } = props.state;
  const working = props.press?.state === "working";
  const action = (words: string) =>
    props.authorize === null ? null : (
      <>
        {" · "}
        <InlineButton disabled={working} onClick={props.authorize}>
          {words}
        </InlineButton>
      </>
    );
  const refused =
    props.press?.state === "refused" ? (
      <span className="block text-destructive-foreground" role="alert">
        {props.press.words}
      </span>
    ) : null;
  if (!props.available) return <span className="text-muted-foreground">Unavailable here</span>;
  if (metadata.state === "known") {
    const { value, stale } = metadata;
    if (!value.authorized) {
      return (
        <span data-observe-credential="none">
          Not authorized{stale ? " · last known" : ""}
          {action("Authorize")}
          {refused}
        </span>
      );
    }
    const who =
      value.userId === null ? "someone" : (props.personName(value.userId) ?? value.userId);
    return (
      <span data-observe-credential="authorized">
        Reads them as {who}
        {value.expiresAt === null ? "" : ` · until ${day(value.expiresAt)}`}
        {stale ? " · last known" : ""}
        {action("Renew")}
        {refused}
      </span>
    );
  }
  if (metadata.state === "reading" || metadata.state === "unread") {
    return (
      <span className="text-muted-foreground" role="status">
        Reading…
      </span>
    );
  }
  return (
    <span className="text-destructive-foreground" role="alert">
      {metadata.state === "failed" ? metadata.words : "You can't read whose permissions these are."}
    </span>
  );
}
