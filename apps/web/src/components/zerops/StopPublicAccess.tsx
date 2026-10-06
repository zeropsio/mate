import type { PublicAccessView } from "@t3tools/client-runtime/data";
import { useStopPublicAccess } from "~/zerops/useStopPublicAccess";
import { Button } from "../ui/button";

/** Address failures are independent of whether the deployed version is healthy. */
export function StopPublicAccessStatus({
  shown,
  again,
}: {
  readonly shown: PublicAccessView | undefined;
  readonly again: () => void;
}) {
  if (shown === undefined || shown.state === "ready") return null;
  const failed = shown.state === "failed";
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
  readonly shown: PublicAccessView | undefined;
  readonly again: () => void;
}) {
  if (shown === undefined) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <StopPublicAccessStatus shown={shown} again={again} />
      {shown.routes.map((route) => (
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
