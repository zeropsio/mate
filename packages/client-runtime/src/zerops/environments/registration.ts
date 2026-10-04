/**
 * Whether a Mate's environment is still to be registered: something wants it — the route, its
 * record, a Connect, auto-connect — and it holds no installed environment yet, nor has it failed.
 * A surface that waits for "every environment" counts it as on its way, so a fresh browser's Mates
 * auto-connect registers after the listing lands never read as "none" first. Pure.
 */
import type { EnvironmentMachine } from "./environmentMachine.ts";

export function registrationOnItsWay(
  machine: Pick<EnvironmentMachine, "credential"> & {
    readonly guards: Pick<EnvironmentMachine["guards"], "want">;
  },
): boolean {
  if (!machine.guards.want) return false;
  switch (machine.credential.kind) {
    case "none":
    case "waiting":
    case "exchanging":
      return true;
    case "held":
      return !machine.credential.installed;
    case "failed":
    case "refused":
    case "retired":
      return false;
  }
}
