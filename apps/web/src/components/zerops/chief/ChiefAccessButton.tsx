/**
 * The person's access their Chief reads with, beside *Overview* in every header their Chief wears:
 * what HQ keeps for it (`chiefAccessView`), that it reads with the person's own access, why the
 * last ask failed, and the presses (`askChiefAccess`) — *Add access* or *Replace* has HQ make and
 * keep a new token with the person's sign-in, *Forget* has HQ keep none; HQ deletes the one it lets
 * go of. Nothing is drawn while they have no Chief or HQ does not say.
 */
import { KeyRoundIcon } from "lucide-react";

import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { askChiefAccess, useChiefAccess, type ChiefAccessAsk } from "~/zerops/chiefAccess";
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
  const { pending, error } = useChiefAccess();
  if (typeof own !== "string" || token === undefined) return null;
  const view = chiefAccessView(token);
  const ready = operations !== null && orgId !== null && pending === null;

  const ask = (kind: ChiefAccessAsk) => {
    if (operations === null || orgId === null) return;
    void askChiefAccess({ ask: kind, operations, orgId, projectId: own });
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
            view.attention || error !== null
              ? "size-3.5 shrink-0 text-warning-foreground"
              : "size-3.5 shrink-0"
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
                onClick={() => ask("forget")}
                size="sm"
                variant="destructive-ghost"
              >
                {pending === "forget" ? "Forgetting…" : "Forget"}
              </Button>
            ) : null}
            <Button
              disabled={!ready}
              onClick={() => ask("keep")}
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
