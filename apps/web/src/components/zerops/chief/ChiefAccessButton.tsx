/**
 * The person's access their Chief reads with, beside *Overview* in every header their Chief wears:
 * what HQ keeps for it (`chiefAccessView`), that it reads with the person's own access, and the
 * presses — *Add access* or *Replace* has HQ make and keep a new token with the person's sign-in,
 * *Forget* has HQ keep none; HQ deletes the one it lets go of. No token passes through here: the
 * state comes back as the Chief's person facts. Nothing is drawn while they have no Chief or HQ does
 * not say.
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";

import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { HQ_UNFOLLOWED, useAccountOperationsOptional } from "~/zerops/accountOperations";
import { useOwnChief, useOwnChiefToken } from "~/zerops/ownChief";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Button } from "../../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../../ui/popover";
import { CHIEF_ACCESS_RISK, chiefAccessView } from "./chiefAccess.logic";

export function ChiefAccessButton() {
  const own = useOwnChief();
  const token = useOwnChiefToken();
  const operations = useAccountOperationsOptional();
  const orgId = useZeropsSession().activeOrganization?.id ?? null;
  const [pending, setPending] = useState<"keep" | "forget" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (typeof own !== "string" || token === undefined) return null;
  const view = chiefAccessView(token);
  const ready = operations !== null && orgId !== null && pending === null;

  const ask = async (kind: "keep" | "forget") => {
    if (operations === null || orgId === null || pending !== null) return;
    const current = captureAccountLifetime();
    setPending(kind);
    setError(null);
    try {
      await operations.run(
        {
          kind: kind === "keep" ? "keep-chief-token" : "forget-chief-token",
          orgId,
          projectId: own,
        },
        { orgId, unobserved: HQ_UNFOLLOWED },
      );
    } catch (cause) {
      if (current()) setError(zeropsErrorMessage(cause));
    } finally {
      if (current()) setPending(null);
    }
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={`Access: ${view.said}`}
            data-chat-header-ghost
            data-zerops-surface="chief-access"
            size="sm"
            variant="ghost"
          />
        }
      >
        <KeyRoundIcon
          className={
            view.attention ? "size-3.5 shrink-0 text-warning-foreground" : "size-3.5 shrink-0"
          }
        />
        <span className="hidden text-line @3xl/header-actions:inline">Access</span>
      </PopoverTrigger>
      <PopoverPopup align="end" width="md">
        <div className="flex flex-col gap-3 text-sm" data-zerops-surface="chief-access-popup">
          <PopoverTitle>{view.said}</PopoverTitle>
          {view.next === null ? null : <p>{view.next}</p>}
          <p className="text-muted-foreground">{CHIEF_ACCESS_RISK}</p>
          {error === null ? null : <p className="text-destructive-foreground">{error}</p>}
          <div className="flex justify-end gap-2">
            {view.forget ? (
              <Button
                disabled={!ready}
                onClick={() => void ask("forget")}
                size="sm"
                variant="destructive-ghost"
              >
                {pending === "forget" ? "Forgetting…" : "Forget"}
              </Button>
            ) : null}
            <Button
              disabled={!ready}
              onClick={() => void ask("keep")}
              size="sm"
              variant={view.attention ? "primary" : "secondary"}
            >
              {pending === "keep" ? "Asking HQ…" : view.keep}
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
