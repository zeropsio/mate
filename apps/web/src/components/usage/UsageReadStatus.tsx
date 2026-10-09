import type { AgentUsageRead } from "@t3tools/client-runtime/data";
import { InlineButton } from "../ui/button";

/** The displayed section names its own source read and uses the existing retry owner. */
export function UsageReadStatus({
  read,
  label,
  onRetry,
}: {
  readonly read: AgentUsageRead;
  readonly label: string;
  readonly onRetry: () => void;
}) {
  if (read.kind === "read" && !read.stale) return null;
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {read.kind === "reading"
        ? `Reading ${label}…`
        : read.kind === "unavailable"
          ? `${label[0]!.toUpperCase()}${label.slice(1)} could not be read.`
          : `Showing last known ${label}.`}
      {read.kind === "reading" ? null : (
        <>
          {" "}
          <InlineButton onClick={onRetry}>Try again</InlineButton>
        </>
      )}
    </p>
  );
}
