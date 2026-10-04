import { selectPublicAccess } from "@t3tools/client-runtime/zerops/data";
import type { ZeropsPublicAccess } from "@t3tools/client-runtime/zerops";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { useStopPublicAccess } from "~/zerops/useStopPublicAccess";
import { Button } from "../ui/button";

/** Address failures are independent of whether the deployed version is healthy. */
export function StopPublicAccessStatus({
  shown,
  again,
}: {
  readonly shown: Shown<ZeropsPublicAccess> | undefined;
  readonly again: () => void;
}) {
  if (shown === undefined) return null;
  const access = selectPublicAccess(shown);
  const failed = access.state === "failed";
  if (access.state === "ready") return null;
  return (
    <div
      data-zerops-surface="stop-public-access-status"
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <span>{failed ? "Could not read public addresses." : "Reading public addresses…"}</span>
      {failed ? (
        <Button size="sm" variant="outline" onClick={again}>
          Again
        </Button>
      ) : null}
    </div>
  );
}

/** Runtime-only stop rows have the same address read as their complete detail page. */
export function RuntimeStopPublicAccess({ projectId }: { readonly projectId: string }) {
  const access = useStopPublicAccess(projectId);
  return <StopPublicAccessLinks shown={access.shown} again={access.again} />;
}

export function StopPublicAccessLinks({
  shown,
  again,
}: {
  readonly shown: Shown<ZeropsPublicAccess> | undefined;
  readonly again: () => void;
}) {
  if (shown === undefined) return null;
  const access = selectPublicAccess(shown);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <StopPublicAccessStatus shown={shown} again={again} />
      {access.routes.map((route) => (
        <a
          className="truncate text-xs underline underline-offset-2"
          key={route.url}
          href={route.url}
          target="_blank"
          rel="noreferrer"
        >
          {route.host}
        </a>
      ))}
    </div>
  );
}
