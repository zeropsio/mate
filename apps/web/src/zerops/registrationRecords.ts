/**
 * The account's registration records (DESIGN §2.C C1), as the account runtime's post-grant stage
 * holds them: none before the epoch's first grant and after sign-out.
 */
import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import type { RegistrationRecord } from "@t3tools/client-runtime/zerops/environments";
import { useMemo } from "react";

import { useAccountEnvironmentsSnapshot } from "./accountEnvironments";

const NO_RECORDS: ReadonlyArray<RegistrationRecord> = [];
const recordsOf = (environments: AccountEnvironments) => environments.records();

/** The records, re-read when they change. */
export function useRegistrationRecords(): ReadonlyArray<RegistrationRecord> {
  return useAccountEnvironmentsSnapshot(recordsOf, NO_RECORDS);
}

/** The record of the target that registered this environment. */
export function useRegistrationRecord(
  environmentId: string | null | undefined,
): RegistrationRecord | undefined {
  const current = useRegistrationRecords();
  return useMemo(
    () => current.find((record) => record.environmentId === environmentId),
    [current, environmentId],
  );
}
