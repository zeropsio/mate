/**
 * The route gate's input and every link into an environment (DESIGN §4.4, §4.8), read off the
 * account runtime's machine per Mate target through `selectReachability`, the one verdict: a
 * route and the links into it agree on which environments are worth opening. An environment no
 * machine names is looked up in the descriptor index, then in HQ's index of the Mates the reader
 * observes (`hqProjectAtom`, A9). The route's environment is the runtime's too: it exchanges the
 * route's target first. Cached descriptors do not start discovery reads of other projects.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { Instant } from "@t3tools/client-runtime/zerops/environments";
import {
  environmentLinkable,
  mateLink,
  resolveEnvironment,
  selectConversation,
  type ConversationAccess,
  type ConversationView,
  selectReachability,
  type DescriptorIndex,
  type EnvironmentMachine,
  type MateLink,
  type Reachability,
  type RouteContent,
  type RouteTarget,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useContext, useEffect, useMemo, useReducer } from "react";

import { useEnvironments } from "../state/environments";
import { environmentShell } from "../state/shell";
import { hqProjectAtom } from "../state/zerops";
import { useZeropsMate } from "../zerops/useZeropsMates";
import {
  hqNamedTarget,
  useAccountEnvironments,
  useDescriptorIndex,
  useEnvironmentMachines,
} from "../zerops/accountEnvironments";
import { conversationAccess, InventoryContext } from "../zerops/inventoryContext";
import { useZeropsSession, type ZeropsOrganizationStatus } from "../zerops/ZeropsSessionProvider";

const NO_SHELL = Atom.make<EnvironmentShellState>({
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
}).pipe(Atom.withLabel("route-gate:no-environment"));
const NO_PROJECT = Atom.make<string | null>(null).pipe(Atom.withLabel("route-gate:no-project"));

export type Machines = ReadonlyMap<TargetKey, EnvironmentMachine>;

export type RouteOrganization = "chosen" | "choosing" | "not-chosen";

/**
 * The gate joins HQ, cached descriptor and installed credentials by id. An unknown route waits
 * for active-organization navigation, then offers a definite unavailable state or org picker.
 */
export function routeTarget(input: {
  readonly machines: Machines;
  readonly index: DescriptorIndex;
  readonly environmentId: EnvironmentId;
  /** The listed Mate HQ names for the environment (`hqNamedTarget`), where no machine does. */
  readonly hqNamed?: { readonly machine: EnvironmentMachine } | undefined;
  /** The inventory is read under verified access, not loading or failing. */
  readonly inventoryKnown: boolean;
  readonly organization: RouteOrganization;
  readonly content: RouteContent;
}): RouteTarget {
  const found = resolveEnvironment(input.machines, input.index, input.environmentId);
  if (found !== undefined) {
    return { kind: "resolved", reachability: found.reachability, content: input.content };
  }
  if (input.hqNamed !== undefined) {
    // As the descriptor index's own find: a machine holding another environment's credential
    // speaks for that one, and the route waits for its descriptor.
    const { machine } = input.hqNamed;
    return {
      kind: "resolved",
      reachability:
        machine.credential.kind === "held"
          ? { kind: "connecting", waitingOn: "descriptor" }
          : selectReachability(machine, input.environmentId),
      content: input.content,
    };
  }
  const discovering = input.organization === "choosing" || !input.inventoryKnown;
  if (discovering) return { kind: "unresolved", discovery: "pending" };
  return {
    kind: "unresolved",
    discovery: input.organization === "not-chosen" ? "no-organization" : "settled",
  };
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
  readonly serviceId?: string | undefined;
}

const AUTHORIZED: ConversationAccess = { kind: "authorized" };

const tabNow = (): Instant => ({ wall: Date.now(), mono: performance.now() });

/**
 * `selectConversation` on the tab's clocks, judged again the moment its bound ends: a
 * conversation shown on a dropped link is hidden then, whatever else renders.
 */
export function useConversationView(
  access: ConversationAccess,
  machine: Pick<EnvironmentMachine, "link" | "linkLostAt"> | undefined,
): ConversationView {
  const [, judgeAgain] = useReducer((count: number) => count + 1, 0);
  const view = selectConversation({ access, machine, now: tabNow() });
  const until = view.kind === "shown" ? view.until : null;
  const untilWall = until?.wall ?? null;
  const untilMono = until?.mono ?? null;
  useEffect(() => {
    if (untilWall === null || untilMono === null) return;
    const now = tabNow();
    const timer = setTimeout(
      judgeAgain,
      Math.max(0, Math.min(untilWall - now.wall, untilMono - now.mono)),
    );
    return () => clearTimeout(timer);
  }, [untilWall, untilMono]);
  return view;
}

/**
 * What the route gate reads for the route's environment. The route is the account runtime's
 * demand from here: its target is exchanged first.
 */
export function useRouteGateInputs(environmentId: EnvironmentId | null): RouteGateInputs {
  const account = useAccountEnvironments();
  const machines = useEnvironmentMachines();
  const index = useDescriptorIndex();
  const mate = useZeropsMate(environmentId ?? EnvironmentId.make("route-gate:no-environment"));
  const inventory = useContext(InventoryContext);
  const { organizationStatus } = useZeropsSession();
  const content = useAtomValue(
    environmentId === null ? NO_SHELL : environmentShell.stateValueAtom(environmentId),
  ).status;
  const hqProject = useAtomValue(
    environmentId === null ? NO_PROJECT : hqProjectAtom(environmentId),
  );
  const hqNamed = hqNamedTarget(machines, hqProject);
  const target =
    environmentId === null
      ? null
      : routeTarget({
          machines,
          index,
          environmentId,
          hqNamed,
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
    serviceId: (resolveEnvironment(machines, index, environmentId)?.key ?? hqNamed?.key)?.split(
      ":",
    )[1],
    projectId:
      (mate.kind === "mate" ? mate.mate.projectId : undefined) ??
      (resolveEnvironment(machines, index, environmentId)?.key ?? hqNamed?.key)?.split(":")[0] ??
      null,
    mateName: mate.kind === "mate" ? mate.mate.name : "This Mate",
  };
}

/**
 * Whether the route's conversation — a thread's, or a draft's — shows under its project's access
 * (DESIGN §9 C1b), for the environment it belongs to.
 */
export function useRouteConversation(environmentId: EnvironmentId | null): ConversationView {
  const machines = useEnvironmentMachines();
  const index = useDescriptorIndex();
  const inventory = useContext(InventoryContext);
  const found =
    environmentId === null ? undefined : resolveEnvironment(machines, index, environmentId);
  const projectId = found?.key.split(":")[0] ?? null;
  return useConversationView(
    inventory === null || projectId === null
      ? AUTHORIZED
      : conversationAccess(inventory, projectId),
    found?.machine,
  );
}

/** A Mate's row as a door names it: its key, and its project. */
export type MateRow = Pick<ZeropsCandidate, "key"> & {
  readonly project: Pick<ZeropsCandidate["project"], "id">;
};

export interface EnvironmentLinks {
  /** Whether a link into the environment is worth offering: everything but gone and replaced. */
  readonly linkable: (environmentId: EnvironmentId) => boolean;
  /** The registered environment a Mate's row opens in, when a link into it is worth offering. */
  readonly linkTarget: (row: MateRow) => EnvironmentId | undefined;
  /**
   * What a door and the Mate's own view read of it (`mateLink`): its target — found by its project
   * while its row stands for the project —, the environment its conversation opens in, and its
   * machine's verdict.
   */
  readonly mateLink: (row: MateRow) => MateLink;
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
  const linkOf = useCallback(
    (row: MateRow) =>
      mateLink({
        key: row.key,
        projectId: row.project.id,
        machines,
        index,
        registered,
      }),
    [index, machines, registered],
  );
  const linkTarget = useCallback((row: MateRow) => linkOf(row).environmentId, [linkOf]);
  return useMemo(
    () => ({ linkable, linkTarget, mateLink: linkOf }),
    [linkable, linkOf, linkTarget],
  );
}

/**
 * The link's verdict for an environment the route does not name — a draft's, whose route carries
 * only the draft — for the one voice over its conversation (`mateVoice`); null while no target
 * names it. It demands nothing: the draft's own view connects its environment.
 */
export function useEnvironmentReachability(
  environmentId: EnvironmentId | null,
): Reachability | null {
  const machines = useEnvironmentMachines();
  const index = useDescriptorIndex();
  if (environmentId === null) return null;
  return resolveEnvironment(machines, index, environmentId)?.reachability ?? null;
}
