/**
 * Today's shell read as the environment machine's regions (`interimRouteTarget`, the 0.9c
 * interim): the one source the route gate and every link producer read, so a route and the links
 * into it agree on which environments are worth opening. Replaced by the exchange driver's
 * machines once the web app runs them.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  environmentLinkable,
  interimCandidateEnvironment,
  interimReachability,
  interimRouteTarget,
  type InterimTargetInput,
  type RouteTarget,
} from "@t3tools/client-runtime/zerops/environments";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useContext, useMemo } from "react";

import { useEnvironments } from "../state/environments";
import { environmentShell } from "../state/shell";
import { InventoryContext, inventoryCandidates } from "../zerops/inventoryContext";
import {
  hasPendingEnvironmentIdentityExchange,
  readRememberedEnvironments,
  useEnvironmentIdentityVersion,
} from "../zerops/rememberedEnvironments";
import { useEnvironmentRestorePending } from "../zerops/ZeropsEnvironmentLifetime";
import { useZeropsSession, type ZeropsOrganizationStatus } from "../zerops/ZeropsSessionProvider";

const NO_SHELL = Atom.make<EnvironmentShellState>({
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
}).pipe(Atom.withLabel("route-gate:no-environment"));

const ORGANIZATION: Record<ZeropsOrganizationStatus, "chosen" | "choosing" | "not-chosen"> = {
  selected: "chosen",
  "needs-selection": "not-chosen",
  idle: "choosing",
  loading: "choosing",
};

/** Today's shell as the interim target input of one environment. */
function useTargetInput(): (environmentId: EnvironmentId) => InterimTargetInput {
  const { environments } = useEnvironments();
  const inventory = useContext(InventoryContext);
  // Remembered records and exchanges in flight are read at call time; this re-renders on both.
  const identityVersion = useEnvironmentIdentityVersion();
  const candidates = useMemo(
    () =>
      inventory === null || inventory.isLoading || inventory.error !== null
        ? null
        : inventoryCandidates(inventory),
    [inventory],
  );
  return useCallback(
    (environmentId: EnvironmentId): InterimTargetInput => {
      const environment = environments.find((entry) => entry.environmentId === environmentId);
      const record = readRememberedEnvironments().find(
        (entry) => entry.environmentId === environmentId,
      );
      return {
        environmentId,
        registration:
          environment === undefined
            ? null
            : { origin: environment.displayUrl, connection: environment.connection.phase },
        recordKey: record?.key ?? null,
        candidates,
        exchangePending: hasPendingEnvironmentIdentityExchange,
      };
    },
    [candidates, environments, identityVersion],
  );
}

export interface RouteGateInputs {
  /** Null on a route that targets no environment (RG1). */
  readonly target: RouteTarget | null;
  /** The route's Zerops project, when a remembered record names it. */
  readonly projectId: string | null;
  readonly mateName: string;
}

/** What the route gate reads for the route's environment. */
export function useRouteGateInputs(environmentId: EnvironmentId | null): RouteGateInputs {
  const inputFor = useTargetInput();
  const { environments } = useEnvironments();
  const restoring = useEnvironmentRestorePending();
  const { organizationStatus } = useZeropsSession();
  const content = useAtomValue(
    environmentId === null ? NO_SHELL : environmentShell.stateValueAtom(environmentId),
  ).status;
  if (environmentId === null) return { target: null, projectId: null, mateName: "This Mate" };
  const input = inputFor(environmentId);
  return {
    target: interimRouteTarget({
      ...input,
      restoring,
      organization: ORGANIZATION[organizationStatus],
      content,
    }),
    projectId: input.recordKey?.split(":")[0] ?? null,
    mateName:
      environments.find((entry) => entry.environmentId === environmentId)?.label ?? "This Mate",
  };
}

export interface EnvironmentLinks {
  /** Whether a link into the environment is worth offering: everything but gone and replaced. */
  readonly linkable: (environmentId: EnvironmentId) => boolean;
  /** The registered environment a candidate's Mate opens in, when a link into it is worth offering. */
  readonly linkTarget: (candidate: ZeropsCandidate) => EnvironmentId | undefined;
}

/** The shared `environmentLinkable` rule for every producer of a link into an environment. */
export function useEnvironmentLinks(): EnvironmentLinks {
  const inputFor = useTargetInput();
  const { environments } = useEnvironments();
  const linkable = useCallback(
    (environmentId: EnvironmentId) => {
      const reachability = interimReachability(inputFor(environmentId));
      return reachability !== null && environmentLinkable(reachability);
    },
    [inputFor],
  );
  const registered = useMemo(
    () =>
      environments.map((entry) => ({
        environmentId: entry.environmentId,
        origin: entry.displayUrl,
      })),
    [environments],
  );
  const linkTarget = useCallback(
    (candidate: ZeropsCandidate) => {
      const environmentId = interimCandidateEnvironment(
        candidate,
        registered,
        readRememberedEnvironments(),
      );
      return environmentId !== undefined && linkable(environmentId) ? environmentId : undefined;
    },
    [linkable, registered],
  );
  return useMemo(() => ({ linkable, linkTarget }), [linkable, linkTarget]);
}
