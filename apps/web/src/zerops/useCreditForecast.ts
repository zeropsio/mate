/** Whether a create dialog forecasts the credit wall, read through the account's data layer. */
import { useAtomValue } from "@effect/atom-react";
import {
  balanceReadGenerationAtom,
  creditForecastAtom,
  creditReadGenerationAtom,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import { useDetailDemand } from "./accountData";

const NO_FORECAST = Atom.make(false);
const NO_READ = Atom.make(0);

/**
 * Whether a new project in the organization waits for credit (`creditForecast`): its record and its
 * balance are read while the dialog asking it is open, and nothing is forecast until both reads
 * answer — never from one before the dialog opened, which a top-up or a promo grant since may have
 * overtaken.
 */
export function useCreditForecast(organizationId: string | null): boolean {
  useDetailDemand("organizationCredit", undefined, organizationId);
  useDetailDemand("organizationBalance", undefined, organizationId);
  const creditRead = useAtomValue(
    organizationId === null ? NO_READ : creditReadGenerationAtom(organizationId),
  );
  const balanceRead = useAtomValue(
    organizationId === null ? NO_READ : balanceReadGenerationAtom(organizationId),
  );
  const [opened, setOpened] = useState({ organizationId, creditRead, balanceRead });
  if (opened.organizationId !== organizationId) {
    setOpened({ organizationId, creditRead, balanceRead });
  }
  return useAtomValue(
    organizationId === null
      ? NO_FORECAST
      : creditForecastAtom(organizationId, opened.creditRead, opened.balanceRead),
  );
}
