/**
 * What a door into a Mate opens (DESIGN §4.4, §4.8): the target its row stands for, the
 * environment its conversation opens in, and what its machine says of it — one reading for every
 * door (its row in the menu, the jump box, an ask) and for the Mate's own view, which waits there
 * while its link is made or made again.
 *
 * A listing row presents a Mate; its machine is what links to it. A row names its target by its
 * key, except while its project's services are not read — before their first read, or once the
 * project's inventory lease was released and its services query with it: the row then stands for
 * the whole project (`projectCandidates`, the project's id for its key), and the target that key
 * names is nobody's Mate. Its Mate is then the target of that project a machine holds a credential
 * for, else one whose machine remembers an environment (a session kept for it names one).
 *
 * Pure.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import { resolveEnvironment, type DescriptorIndex } from "./descriptorIndex.ts";
import type { EnvironmentMachine } from "./environmentMachine.ts";
import type { TargetKey } from "./exchange.ts";
import { environmentLinkable, selectReachability, type Reachability } from "./reachability.ts";
import { targetProject } from "./targets.ts";

/** The Mate target a listing row stands for; undefined while nothing names one. */
export function rowTarget(input: {
  /** The row's key: a target, or its project's id while the project's services are not read. */
  readonly key: string;
  readonly projectId: string;
  readonly machines: ReadonlyMap<TargetKey, EnvironmentMachine>;
}): TargetKey | undefined {
  const { key, projectId } = input;
  if (key !== projectId) return key;
  const own = [...input.machines].filter(
    ([target]) => target !== projectId && targetProject(target) === projectId,
  );
  const [holding] = own.find(([, machine]) => machine.credential.kind === "held") ?? [];
  if (holding !== undefined) return holding;
  const [remembering] = own.find(([, machine]) => machine.record !== null) ?? [];
  return remembering;
}

export interface MateLink {
  /** The Mate's target; undefined while nothing names one. */
  readonly key: TargetKey | undefined;
  /**
   * The environment its conversation opens in: the one its machine holds or remembers,
   * registered in this tab, and neither gone nor replaced.
   */
  readonly environmentId: EnvironmentId | undefined;
  /** Its machine's verdict (§4.4) for that environment; null while no machine names the Mate. */
  readonly reachability: Reachability | null;
  /** Its link's failures since it last connected (`EnvironmentMachine.failuresSinceConnect`). */
  readonly failuresSinceConnect: number;
  /** Of those, the ones its server answered (`EnvironmentMachine.errorsSinceConnect`). */
  readonly errorsSinceConnect: number;
  /**
   * Its Mate has answered on this page: its link is connected or was, or its probe found it ready
   * while nothing wants its link — one no lease holds. A link wanted after a ready probe
   * answers by connecting: until then its Mate
   * is still on its way. Once answered, it is no longer arriving, whatever it waits for now.
   */
  readonly answered: boolean;
}

export function mateLink(input: {
  readonly key: string;
  readonly projectId: string;
  readonly machines: ReadonlyMap<TargetKey, EnvironmentMachine>;
  readonly index: DescriptorIndex;
  /** The environments the connection catalog holds. */
  readonly registered: ReadonlySet<EnvironmentId>;
}): MateLink {
  const key = rowTarget(input);
  const machine = key === undefined ? undefined : input.machines.get(key);
  if (machine === undefined) {
    return {
      key,
      environmentId: undefined,
      reachability: null,
      failuresSinceConnect: 0,
      errorsSinceConnect: 0,
      answered: false,
    };
  }
  // A restarting Mate has no origin in the inventory; its target key still finds it.
  const named =
    machine.credential.kind === "held" ? machine.credential.environmentId : machine.record;
  const resolved =
    named === null ? undefined : resolveEnvironment(input.machines, input.index, named);
  const reachability = resolved?.reachability ?? selectReachability(machine, named);
  const opens =
    named !== null &&
    input.registered.has(named) &&
    resolved !== undefined &&
    environmentLinkable(resolved.reachability);
  return {
    key,
    environmentId: opens ? named : undefined,
    reachability,
    failuresSinceConnect: machine.failuresSinceConnect,
    errorsSinceConnect: machine.errorsSinceConnect,
    answered:
      machine.link.phase === "connected" ||
      machine.linkLostAt !== null ||
      (machine.readySeen && !machine.guards.want),
  };
}
