/**
 * The organization's HQ on the Tools row (SPEC §3.1, §4): healthy; serving while it cannot check
 * Zerops right now, which is no outage; or unavailable since when — the rest of the page still
 * drawn from what was read last. Nothing before its health is first read.
 */
import { useAccountHq, useHqStanding } from "~/zerops/accountHq";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

export function ZeropsHqTool() {
  const { activeOrganization } = useZeropsSession();
  const accountHq = useAccountHq(activeOrganization?.id);
  const standing = useHqStanding(
    accountHq.hq.kind === "official" ? accountHq.hq.address : undefined,
  );

  switch (standing.kind) {
    case "unknown":
      return <span data-zerops-surface="hq-tool">HQ</span>;
    case "healthy":
      return (
        <span data-zerops-surface="hq-tool">
          HQ <span className="text-muted-foreground">· Healthy</span>
        </span>
      );
    case "unchecked":
      return (
        <span data-zerops-surface="hq-tool" role="status">
          HQ <span className="text-muted-foreground">· Can't check Zerops right now</span>
        </span>
      );
    case "unavailable":
      return (
        <span data-zerops-surface="hq-tool" role="status">
          HQ{" "}
          <span className="text-muted-foreground">
            · Unavailable since{" "}
            {new Date(standing.since).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </span>
      );
  }
}
