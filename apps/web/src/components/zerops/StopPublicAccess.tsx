import { usePublicAccess, type PublicAccessView } from "~/zerops/usePublicAccess";
import { Button } from "../ui/button";

/**
 * Address failures are independent of whether the deployed version is healthy. An address put in
 * place that does not serve yet is said as such, never offered as a link.
 */
export function StopPublicAccessStatus({
  access,
  serviceId,
}: {
  readonly access: PublicAccessView;
  /** Omitted for a project summary; null while a service's identity is not known. */
  readonly serviceId?: string | null | undefined;
}) {
  const pending =
    serviceId === undefined
      ? access.pending
      : access.pending.filter((route) => route.serviceId === serviceId);
  if (!access.bound || (access.state === "ready" && pending.length === 0)) return null;
  const failed = access.state === "failed";
  return (
    <div
      data-zerops-surface="stop-public-access-status"
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <span>
        {failed
          ? "Could not read public addresses."
          : access.state === "reading"
            ? "Reading public addresses…"
            : `Publishing ${pending.map((route) => route.host).join(", ")}…`}
      </span>
      {failed ? (
        <Button size="sm" variant="outline" onClick={access.again}>
          Again
        </Button>
      ) : null}
    </div>
  );
}

/** Runtime-only stop rows have the same addresses as their complete detail page. */
export function RuntimeStopPublicAccess({ projectId }: { readonly projectId: string }) {
  return <StopPublicAccessLinks access={usePublicAccess(projectId)} />;
}

export function StopPublicAccessLinks({ access }: { readonly access: PublicAccessView }) {
  if (!access.bound) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <StopPublicAccessStatus access={access} />
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
