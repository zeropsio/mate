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

/** The credit forecast as a dialog holds it: what it says, and whether its reads have answered. */
export interface CreditForecastRead {
  /** A new project here waits for credit (`creditForecast`). */
  readonly forecast: boolean;
  /** Both reads made since the dialog opened have come back: the forecast says all it will. */
  readonly settled: boolean;
}

/**
 * Whether a new project in the organization waits for credit (`creditForecast`): its record and its
 * balance are read while the dialog asking it is open, and nothing is forecast until both reads
 * answer — never from one before the dialog opened, which a top-up or a promo grant since may have
 * overtaken.
 */
export function useCreditForecast(organizationId: string | null): boolean {
  return useCreditForecastRead(organizationId).forecast;
}

/** The forecast and whether it has settled, for a dialog that opens once it has (`settled`). */
export function useCreditForecastRead(organizationId: string | null): CreditForecastRead {
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
  const forecast = useAtomValue(
    organizationId === null
      ? NO_FORECAST
      : creditForecastAtom(organizationId, opened.creditRead, opened.balanceRead),
  );
  return {
    forecast,
    settled:
      organizationId === null ||
      forecast ||
      (creditRead > opened.creditRead && balanceRead > opened.balanceRead),
  };
}
