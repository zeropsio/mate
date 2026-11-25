import type { AgentUsageRead } from "@t3tools/client-runtime/data";
import { InlineButton } from "../ui/button";
import { Text } from "~/components/ui/text";

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
    <Text render={<p />} variant="description" role="status">
      {read.kind === "reading"
        ? (read.line ?? `Reading ${label}…`)
        : read.kind === "unavailable"
          ? `${label[0]!.toUpperCase()}${label.slice(1)} could not be read.`
          : `Showing last known ${label}.`}
      {read.kind === "reading" ? null : (
        <>
          {" "}
          <InlineButton onClick={onRetry}>Try again</InlineButton>
        </>
      )}
    </Text>
  );
}
