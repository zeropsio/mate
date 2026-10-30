/** Read-only status for the installed Zerops Control Plane observation access. */
import type { EnvironmentId } from "@t3tools/contracts";
import type { ObserveCredentialRead } from "@t3tools/client-runtime/data";
import { useObserveCredential } from "~/zerops/useObserveCredential";
import { useEnvironmentProjectRef } from "~/zerops/useZeropsFeeds";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { Button } from "../ui/button";

export function ObserveCredentialControl({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const project = useEnvironmentProjectRef(environmentId);
  const control = useObserveCredential(project?.projectId ?? null);
  const orgId = useAccountOrgId();
  const personName = useHqPersonNames(orgId ?? undefined);
  if (project === null) return null;
  return <ObserveCredentialControlBody {...control} personName={personName} />;
}
export function ObserveCredentialControlBody(props: {
  readonly state: ObserveCredentialRead;
  readonly available: boolean;
  readonly again: () => void;
  readonly personName: (userId: string) => string | undefined;
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
      {props.available ? (
        <div>
          <Button disabled={reading} onClick={props.again} size="sm" variant="ghost">
            Refresh
          </Button>
        </div>
      ) : null}
    </section>
  );
}
