/**
 * The create dialogs' one line on the credit wall, before Create: Zerops makes a new organization's
 * first project free and refuses any after it until its first top-up, which HQ takes. A forecast —
 * Create stays, and Zerops decides on the press — said only where the organization's record and
 * its projects say it; nothing while either is unread or failed.
 */
import { hqCreditUrl } from "~/zerops/hqCredit";
import { useCreditForecast } from "~/zerops/useCreditForecast";

import { InlineButton } from "../ui/button";

export const CREDIT_FORECAST_LINE =
  "Zerops needs credit on this organization before it makes another project.";

export function ZeropsCreditForecast({ organizationId }: { readonly organizationId: string }) {
  if (!useCreditForecast(organizationId)) return null;
  return (
    <p className="text-sm text-muted-foreground" data-zerops-credit-forecast="">
      {CREDIT_FORECAST_LINE}{" "}
      <InlineButton
        render={<a href={hqCreditUrl(organizationId)} rel="noreferrer" target="_blank" />}
      >
        Add credit in HQ
      </InlineButton>
    </p>
  );
}
