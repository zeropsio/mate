/** Whether a create dialog forecasts the credit wall, read through the account's data layer. */
import { useAtomValue } from "@effect/atom-react";
import { creditForecastAtom, creditReadGenerationAtom } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import { useDetailDemand } from "./accountData";

const NO_FORECAST = Atom.make(false);
const NO_READ = Atom.make(0);

/**
 * Whether a new project in the organization waits for credit (`creditForecast`): its record is read
 * while the dialog asking it is open, and nothing is forecast until that read answers — never from
 * one before the dialog opened, which a top-up since may have overtaken.
 */
export function useCreditForecast(organizationId: string | null): boolean {
  useDetailDemand("organizationCredit", undefined, organizationId);
  const generation = useAtomValue(
    organizationId === null ? NO_READ : creditReadGenerationAtom(organizationId),
  );
  const [opened, setOpened] = useState({ organizationId, at: generation });
  if (opened.organizationId !== organizationId) setOpened({ organizationId, at: generation });
  return useAtomValue(
    organizationId === null ? NO_FORECAST : creditForecastAtom(organizationId, opened.at),
  );
}
