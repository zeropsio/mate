/**
 * The organization's HQ on the Tools row (SPEC §3.1, §4): healthy; serving while it cannot check
 * Zerops right now, which is no outage; or unavailable since when — the rest of the page still
 * drawn from what was read last. Nothing before its health is first read. An owner or an admin sees
 * beside it its update when its health names an older Core than this app carries, else that it is
 * up to date, and opens either (`ZeropsHqUpdate`).
 */
import { canWriteRegistry } from "@t3tools/client-runtime/zerops";

import { useAccountHq, useCarriedCoreBuild, useHqStanding } from "~/zerops/accountHq";
import { sessionOfferViewer } from "~/zerops/offerViewer";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { ZeropsHqUpdate } from "./ZeropsHqUpdate";
import { hqUpdateTrigger } from "./ZeropsHqUpdate.logic";

export function ZeropsHqTool() {
  const { activeOrganization, user } = useZeropsSession();
  const accountHq = useAccountHq(activeOrganization?.id);
  const standing = useHqStanding(
    accountHq.hq.kind === "official" ? accountHq.hq.address : undefined,
  );
  const carried = useCarriedCoreBuild();
  const trigger = hqUpdateTrigger({
    admin: canWriteRegistry(sessionOfferViewer(user, activeOrganization ?? null)),
    standing,
    carried,
  });
  // Mounted while HQ answers at all, so a dialog left open sees an update through to HQ answering.
  const update =
    accountHq.hq.kind === "official" &&
    carried !== undefined &&
    trigger !== null &&
    (standing.kind === "healthy" || standing.kind === "unchecked") ? (
      <ZeropsHqUpdate
        answering={standing.build}
        carried={carried}
        projectId={accountHq.hq.projectId}
        trigger={trigger}
      />
    ) : null;

  switch (standing.kind) {
    case "unknown":
      return <span data-zerops-surface="hq-tool">HQ</span>;
    case "healthy":
      return (
        <span data-zerops-surface="hq-tool">
          HQ <span className="text-muted-foreground">· Healthy</span>
          {update}
        </span>
      );
    case "unchecked":
      return (
        <span data-zerops-surface="hq-tool" role="status">
          HQ <span className="text-muted-foreground">· Can't check Zerops right now</span>
          {update}
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
