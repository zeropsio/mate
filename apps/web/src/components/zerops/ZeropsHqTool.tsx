/**
 * The organization's HQ on the Tools row (SPEC §3.1, §4): healthy; serving while it cannot check
 * Zerops right now, which is no outage; or unavailable since when — the rest of the page still
 * drawn from what was read last. Nothing before HQ's stream first says. Read off HQ's stream
 * (`hqStandingAtom`), never polled. An owner or an admin is offered its update beside it when the
 * Core it runs, as its stream or its health names it, is older than this app carries
 * (`ZeropsHqUpdate`).
 */
import { useAtomValue } from "@effect/atom-react";
import { canWriteRegistry } from "@t3tools/client-runtime/zerops";

import { hqStandingAtom } from "~/state/zerops";
import { useAccountHq, useCarriedCoreBuild } from "~/zerops/accountHq";
import { sessionOfferViewer } from "~/zerops/offerViewer";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { ZeropsHqUpdate } from "./ZeropsHqUpdate";
import { offersHqUpdate } from "./ZeropsHqUpdate.logic";

export function ZeropsHqTool() {
  const { activeOrganization, user } = useZeropsSession();
  const accountHq = useAccountHq(activeOrganization?.id);
  const standing = useAtomValue(hqStandingAtom);
  const carried = useCarriedCoreBuild();
  const update =
    accountHq.hq.kind === "official" &&
    carried !== undefined &&
    offersHqUpdate({
      admin: canWriteRegistry(sessionOfferViewer(user, activeOrganization ?? null)),
      standing,
      carried,
    }) ? (
      <ZeropsHqUpdate carried={carried} projectId={accountHq.hq.projectId} />
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
