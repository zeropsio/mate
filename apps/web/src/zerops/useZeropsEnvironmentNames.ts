/**
 * The read side of `zeropsEnvironmentNamesAtom`: the Zerops project's name
 * per environment, as the last candidate load left it, or null while the
 * list is unread (before its first read, and after a sign-out). Imports nothing that loads — `useZeropsCandidates` is
 * the writer, wherever it is mounted.
 */
import { useAtomValue } from "@effect/atom-react";

import type { EnvironmentId } from "@t3tools/contracts";

import { zeropsEnvironmentNamesAtom } from "../state/zerops";

export function useZeropsEnvironmentNames(): ReadonlyMap<EnvironmentId, string> | null {
  return useAtomValue(zeropsEnvironmentNamesAtom);
}
