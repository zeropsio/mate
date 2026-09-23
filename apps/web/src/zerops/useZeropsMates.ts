/**
 * The read side of `zeropsMatesAtom`: who lives in each environment
 * (`mateIdentities.ts`), for the chat header, the timeline, a draft's headline
 * and the Zerops panel. Each answer is a Mate, nobody, or unknown — a Zerops
 * environment the candidate list has not reached yet — and a surface renders
 * the unknown one as a placeholder, never as nobody. An environment whose own
 * server runs outside Zerops holds nobody without waiting on the list
 * (`withEnvironmentsOutsideZerops`).
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { useServerConfigs } from "../state/entities";
import { zeropsMatesAtom } from "../state/zerops";
import {
  withEnvironmentsOutsideZerops,
  zeropsMateAt,
  type ZeropsMateAt,
  type ZeropsMateDirectory,
} from "./mateIdentities";

/** Every environment's answer, for a surface that names several (a picker). */
export function useZeropsMateDirectory(): ZeropsMateDirectory {
  const directory = useAtomValue(zeropsMatesAtom);
  const servers = useServerConfigs();
  return useMemo(() => withEnvironmentsOutsideZerops(directory, servers), [directory, servers]);
}

export function useZeropsMate(environmentId: EnvironmentId): ZeropsMateAt {
  return zeropsMateAt(useZeropsMateDirectory(), environmentId);
}

/**
 * Whether a Mate lives in `environmentId`: null while that is not known, for
 * a surface that must not guess either way meanwhile.
 */
export function useZeropsMateEnvironment(environmentId: EnvironmentId): boolean | null {
  const mate = useZeropsMate(environmentId);
  return mate.kind === "unknown" ? null : mate.kind === "mate";
}
