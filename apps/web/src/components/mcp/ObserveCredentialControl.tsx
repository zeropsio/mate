/** Status of the Zerops Control Plane observation access, and Authorize where it has none. */
import type { EnvironmentId } from "@t3tools/contracts";
import { offersObserveAuthorize, type ObserveCredentialRead } from "@t3tools/client-runtime/data";
import { useObserveCredential } from "~/zerops/useObserveCredential";
import { useAuthorizeObserve, type ObserveAuthorizePress } from "~/zerops/useObserveAuthorization";
import { useEnvironmentProjectRef } from "~/zerops/useZeropsFeeds";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { useHqPersonNames, useHqProjectPerson } from "~/zerops/useZeropsMateOwners";
import { Button } from "../ui/button";

export function ObserveCredentialControl({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const project = useEnvironmentProjectRef(environmentId);
  const projectId = project?.projectId ?? null;
  const control = useObserveCredential(projectId);
  const orgId = useAccountOrgId();
  const personName = useHqPersonNames(orgId ?? undefined);
  const mayWrite = useHqProjectPerson(projectId ?? "")?.mayWrite;
  const { authorize, press } = useAuthorizeObserve(projectId);
  if (project === null) return null;
  const offered = offersObserveAuthorize({ mayWrite, metadata: control.state.metadata });
  return (
    <ObserveCredentialControlBody
      {...control}
      personName={personName}
      authorize={offered ? authorize : null}
      press={press}
    />
  );
}
export function ObserveCredentialControlBody(props: {
  readonly state: ObserveCredentialRead;
  readonly available: boolean;
  readonly again: () => void;
  readonly personName: (userId: string) => string | undefined;
  /** Offered to a viewer who may operate the Mate while it reads not authorized; else `null`. */
  readonly authorize: (() => void) | null;
  readonly press: ObserveAuthorizePress | null;
}) {
  const { metadata } = props.state;
  const known = metadata.state === "known" ? metadata : null;
  const reading = metadata.state === "reading" || metadata.state === "unread";
  return (
    <section
      aria-label="Observe authorization"
      className="mt-4 flex flex-col gap-2 border-t border-border pt-4"
      data-observe-credential
    >
      <h3 className="text-sm font-medium">Zerops Control Plane observation</h3>
      <p className="text-xs leading-4.5 text-muted-foreground">
        Observation uses the Zerops permissions of the person who set up this Mate’s Zerops Control
        Plane.
      </p>
      {!props.available ? (
        <p className="text-xs text-muted-foreground">Observe authorization is unavailable.</p>
      ) : known !== null ? (
        <>
          <p className="text-xs">
            {known.value.authorized ? "Authorized" : "Not authorized"}
            {known.stale ? " · Last known state" : ""}
          </p>
          {known.value.authorized ? (
            <p className="text-xs text-muted-foreground">
              Authorized by{" "}
              {known.value.userId === null
                ? "Unknown person"
                : (props.personName(known.value.userId) ?? known.value.userId)}
              {known.value.expiresAt === null
                ? ""
                : ` · Expires ${new Date(known.value.expiresAt).toLocaleString()}`}
            </p>
          ) : null}
        </>
      ) : reading ? (
        <p className="text-xs text-muted-foreground" role="status">
          Reading authorization…
        </p>
      ) : (
        <p className="text-xs text-destructive-foreground" role="alert">
          {metadata.state === "failed" ? metadata.words : "You cannot read this authorization."}
        </p>
      )}
      {props.press?.state === "refused" ? (
        <p className="text-xs text-destructive-foreground" role="alert">
          {props.press.words}
        </p>
      ) : null}
      {props.available ? (
        <div className="flex gap-2">
          {props.authorize === null ? null : (
            <Button
              disabled={props.press?.state === "working"}
              onClick={props.authorize}
              size="sm"
              variant="primary"
            >
              Authorize
            </Button>
          )}
          <Button disabled={reading} onClick={props.again} size="sm" variant="ghost">
            Refresh
          </Button>
        </div>
      ) : null}
    </section>
  );
}
