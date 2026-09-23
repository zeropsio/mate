/**
 * The route gate's input and every link into an environment (DESIGN §4.4, §4.8), read off the
 * account runtime's machine per Mate target through `selectReachability`, the one verdict: a
 * route and the links into it agree on which environments are worth opening. An environment no
 * machine names is looked up in the descriptor index. The route's environment is the runtime's
 * too: it exchanges the route's target first, and sweeps the descriptors of every present Mate
 * that has not answered while nothing names it.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  environmentLinkable,
  resolveEnvironment,
  type DescriptorIndex,
  type EnvironmentMachine,
  type RouteContent,
  type RouteTarget,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useContext, useEffect, useMemo } from "react";

import { useEnvironments } from "../state/environments";
import { environmentShell } from "../state/shell";
import {
  useAccountEnvironments,
  useDescriptorIndex,
  useEnvironmentMachines,
} from "../zerops/accountEnvironments";
import { InventoryContext } from "../zerops/inventoryContext";
import { useRegistrationRecords } from "../zerops/registrationRecords";
import { useZeropsSession, type ZeropsOrganizationStatus } from "../zerops/ZeropsSessionProvider";

const NO_SHELL = Atom.make<EnvironmentShellState>({
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
}).pipe(Atom.withLabel("route-gate:no-environment"));

export type Machines = ReadonlyMap<TargetKey, EnvironmentMachine>;

/**
 * A credential still on its way: not yet judged, exchanging, answered but not yet installed,
 * waiting for a slot or the grant, or on a presence not read yet. A target whose presence was
 * read and is not there, that waits on its container, or backs off has no end discovery could
 * wait for.
 */
function onItsWay(machine: EnvironmentMachine): boolean {
  const credential = machine.credential;
  switch (credential.kind) {
    case "none":
    case "exchanging":
      return true;
    case "waiting":
      return (
        credential.on === "budget" ||
        credential.on === "access" ||
        (credential.on === "presence" && machine.presence.kind === "unknown")
      );
    case "held":
      return !credential.installed;
    case "backoff":
    case "refused":
    case "retired":
      return false;
  }
}

/**
 * Whether a target could still name an environment no machine names yet (§4.8 RG2, before the
 * descriptor sweep): a remembered target the driver has not taken in or whose credential is on
 * its way, or any exchange still running.
 */
export function discoveryPending(
  machines: Machines,
  remembered: ReadonlyArray<TargetKey>,
): boolean {
  return (
    remembered.some((key) => {
      const machine = machines.get(key);
      return machine === undefined || onItsWay(machine);
    }) ||
    [...machines.values()].some(
      ({ credential }) =>
        credential.kind === "exchanging" || (credential.kind === "held" && !credential.installed),
    )
  );
}

export type RouteOrganization = "chosen" | "choosing" | "not-chosen";

/** The gate's target for the route's environment. */
export function routeTarget(input: {
  readonly machines: Machines;
  readonly index: DescriptorIndex;
  readonly remembered: ReadonlyArray<TargetKey>;
  readonly environmentId: EnvironmentId;
  /** The inventory is read, not loading or failing. */
  readonly inventoryKnown: boolean;
  readonly organization: RouteOrganization;
  readonly content: RouteContent;
}): RouteTarget {
  const found = resolveEnvironment(input.machines, input.index, input.environmentId);
  if (found !== undefined) {
    return { kind: "resolved", reachability: found.reachability, content: input.content };
  }
  if (input.organization === "not-chosen") {
    return { kind: "unresolved", discovery: "no-organization" };
  }
  const discovering =
    input.organization === "choosing" ||
    !input.inventoryKnown ||
    discoveryPending(input.machines, input.remembered) ||
    input.index.unanswered.length > 0;
  return { kind: "unresolved", discovery: discovering ? "pending" : "settled" };
}

const ORGANIZATION: Record<ZeropsOrganizationStatus, RouteOrganization> = {
  selected: "chosen",
  "needs-selection": "not-chosen",
  idle: "choosing",
  loading: "choosing",
};

export interface RouteGateInputs {
  /** Null on a route that targets no environment (RG1). */
  readonly target: RouteTarget | null;
  /** The route's Zerops project, when a target names the environment. */
  readonly projectId: string | null;
  readonly mateName: string;
}

/**
 * What the route gate reads for the route's environment. The route is the account runtime's
 * demand from here: its target is exchanged first.
 */
export function useRouteGateInputs(environmentId: EnvironmentId | null): RouteGateInputs {
  const account = useAccountEnvironments();
  const machines = useEnvironmentMachines();
  const index = useDescriptorIndex();
  const { environments } = useEnvironments();
  const inventory = useContext(InventoryContext);
  const { organizationStatus } = useZeropsSession();
  const records = useRegistrationRecords();
  const content = useAtomValue(
    environmentId === null ? NO_SHELL : environmentShell.stateValueAtom(environmentId),
  ).status;
  const target =
    environmentId === null
      ? null
      : routeTarget({
          machines,
          index,
          remembered: records.map((record) => record.targetKey),
          environmentId,
          inventoryKnown: inventory !== null && !inventory.isLoading && inventory.error === null,
          organization: ORGANIZATION[organizationStatus],
          content,
        });
  useEffect(() => {
    if (account === null) return;
    account.setRoute(environmentId);
    return () => account.setRoute(null);
  }, [account, environmentId]);
  if (environmentId === null) return { target: null, projectId: null, mateName: "This Mate" };
  return {
    target,
    projectId: resolveEnvironment(machines, index, environmentId)?.key.split(":")[0] ?? null,
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
  const machines = useEnvironmentMachines();
  const index = useDescriptorIndex();
  const { environments } = useEnvironments();
  const linkable = useCallback(
    (environmentId: EnvironmentId) => {
      const found = resolveEnvironment(machines, index, environmentId);
      return found !== undefined && environmentLinkable(found.reachability);
    },
    [index, machines],
  );
  const registered = useMemo(
    () => new Set(environments.map((entry) => entry.environmentId)),
    [environments],
  );
  const linkTarget = useCallback(
    (candidate: ZeropsCandidate) => {
      const machine = machines.get(candidate.key);
      if (machine === undefined) return undefined;
      // A restarting Mate has no origin in the inventory; its target key still finds it.
      const environmentId =
        machine.credential.kind === "held" ? machine.credential.environmentId : machine.record;
      return environmentId !== null && registered.has(environmentId) && linkable(environmentId)
        ? environmentId
        : undefined;
    },
    [linkable, machines, registered],
  );
  return useMemo(() => ({ linkable, linkTarget }), [linkable, linkTarget]);
}
