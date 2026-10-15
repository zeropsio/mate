/** Whether a create dialog forecasts the credit wall, read through the account's data layer. */
import { useAtomValue } from "@effect/atom-react";
import { creditForecastAtom } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";

import { useDetailDemand } from "./accountData";

const NO_FORECAST = Atom.make(false);

/**
 * Whether a new project in the organization waits for credit (`creditForecast`): its record is read
 * while the dialog asking it is open, and nothing is forecast until it answers.
 */
export function useCreditForecast(organizationId: string | null): boolean {
  useDetailDemand("organizationCredit", undefined, organizationId);
  return useAtomValue(organizationId === null ? NO_FORECAST : creditForecastAtom(organizationId));
}
